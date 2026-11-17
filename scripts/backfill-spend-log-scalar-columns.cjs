#!/usr/bin/env node
"use strict";
/**
 * SpendLog Usage 投影列历史回填（旁路脚本）。
 *
 * 目的：`LiteLLM_SpendLogs` 的 `cache_read_input_tokens` / `cache_creation_input_tokens` /
 * `resolved_model_group` / `endpoint` 是 Usage 本地时区热路径的小列投影
 * （见 drizzle/0019_spend_log_scalar_columns.sql）。迁移会做一次全量回填；本脚本用于：
 * - 核对回填是否完成（`--count`）；
 * - 迁移后因异常中断或历史行被外部写入时补跑（`--write`）。
 *
 * 来源与写侧、日汇总保持同源：
 * - cache token：additional_usage_values 优先，usage_object 回退，仅接受非负整数；
 * - resolved_model_group：metadata 的最终模型组，缺失回退 model_group；
 * - endpoint：proxy_server_request.url 去掉 query。
 *
 * 运行方式（在运行中的生产容器里用独立进程，不经过 HTTP 与主进程）：
 *
 *     docker cp scripts/backfill-spend-log-scalar-columns.cjs litellm-prod:/app/backfill-scalar-columns.cjs
 *     docker exec litellm-prod node /app/backfill-scalar-columns.cjs --limit 2     # 试算
 *     docker exec litellm-prod node /app/backfill-scalar-columns.cjs --write       # 全量回填
 *     docker exec litellm-prod node /app/backfill-scalar-columns.cjs --count       # 只统计
 *
 * 只更新四个标量列，不重写 metadata、proxy_server_request 或任何正文。
 */

const { Pool } = require("pg");

function clampInt(raw, min, max, fallback) {
	const parsed = Number.parseInt(String(raw ?? ""), 10);
	if (!Number.isFinite(parsed)) {
		return fallback;
	}
	return Math.min(max, Math.max(min, parsed));
}

function parseArgs(argv) {
	const options = {
		after: "",
		batchSize: 500,
		sleepMs: 200,
		write: false,
		countOnly: false,
		limit: Number.POSITIVE_INFINITY,
		help: false,
	};
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--write") {
			options.write = true;
		} else if (arg === "--count") {
			options.countOnly = true;
		} else if (arg === "--after") {
			options.after = argv[index + 1] ?? "";
			index += 1;
		} else if (arg === "--batch") {
			options.batchSize = clampInt(argv[index + 1], 1, 5000, 500);
			index += 1;
		} else if (arg === "--sleep") {
			options.sleepMs = clampInt(argv[index + 1], 0, 10000, 200);
			index += 1;
		} else if (arg === "--limit") {
			options.limit = clampInt(argv[index + 1], 1, Number.MAX_SAFE_INTEGER, Number.POSITIVE_INFINITY);
			index += 1;
		} else if (arg === "--help" || arg === "-h") {
			options.help = true;
		} else {
			throw new Error(`unknown argument: ${arg}`);
		}
	}
	return options;
}

const CACHE_READ_EXPRESSION = `COALESCE(
	CASE
		WHEN (metadata -> 'additional_usage_values' ->> 'cache_read_input_tokens') ~ '^[0-9]+$'
			THEN (metadata -> 'additional_usage_values' ->> 'cache_read_input_tokens')::bigint
	END,
	CASE
		WHEN (metadata -> 'usage_object' ->> 'cache_read_input_tokens') ~ '^[0-9]+$'
			THEN (metadata -> 'usage_object' ->> 'cache_read_input_tokens')::bigint
	END,
	0
)`;

const CACHE_CREATION_EXPRESSION = `COALESCE(
	CASE
		WHEN (metadata -> 'additional_usage_values' ->> 'cache_creation_input_tokens') ~ '^[0-9]+$'
			THEN (metadata -> 'additional_usage_values' ->> 'cache_creation_input_tokens')::bigint
	END,
	CASE
		WHEN (metadata -> 'usage_object' ->> 'cache_creation_input_tokens') ~ '^[0-9]+$'
			THEN (metadata -> 'usage_object' ->> 'cache_creation_input_tokens')::bigint
	END,
	0
)`;

const RESOLVED_GROUP_EXPRESSION = `COALESCE(
	NULLIF(metadata ->> 'resolved_model_group', ''),
	NULLIF(model_group, '')
)`;

const ENDPOINT_EXPRESSION = `COALESCE(split_part(proxy_server_request ->> 'url', '?', 1), '')`;

const RESOLVED_COLUMNS = `
	SELECT
		request_id,
		${CACHE_READ_EXPRESSION} AS cache_read_input_tokens,
		${CACHE_CREATION_EXPRESSION} AS cache_creation_input_tokens,
		${RESOLVED_GROUP_EXPRESSION} AS resolved_model_group,
		${ENDPOINT_EXPRESSION} AS endpoint
	FROM batch`;

const BATCH_SOURCE = `
	WITH batch AS MATERIALIZED (
		SELECT request_id, metadata, proxy_server_request, model_group
		FROM "LiteLLM_SpendLogs"
		WHERE request_id > $1
		ORDER BY request_id
		LIMIT $2
	), resolved AS MATERIALIZED (${RESOLVED_COLUMNS}
	)`;

const MISMATCH_CONDITION = `
	spend_log.cache_read_input_tokens IS DISTINCT FROM resolved.cache_read_input_tokens
	OR spend_log.cache_creation_input_tokens IS DISTINCT FROM resolved.cache_creation_input_tokens
	OR spend_log.resolved_model_group IS DISTINCT FROM resolved.resolved_model_group
	OR spend_log.endpoint IS DISTINCT FROM resolved.endpoint`;

function batchSql(write) {
	const tail = write
		? `, updated AS (
		UPDATE "LiteLLM_SpendLogs" AS spend_log
		SET cache_read_input_tokens = resolved.cache_read_input_tokens,
			cache_creation_input_tokens = resolved.cache_creation_input_tokens,
			resolved_model_group = resolved.resolved_model_group,
			endpoint = resolved.endpoint
		FROM resolved
		WHERE spend_log.request_id = resolved.request_id
			AND (${MISMATCH_CONDITION})
		RETURNING spend_log.request_id
	)
	SELECT
		(SELECT max(request_id) FROM batch) AS next_request_id,
		(SELECT count(*) FROM batch) AS scanned_rows,
		(SELECT count(*) FROM updated) AS updated_rows`
		: `SELECT
		(SELECT max(request_id) FROM batch) AS next_request_id,
		(SELECT count(*) FROM batch) AS scanned_rows,
		(SELECT count(*) FROM resolved
			JOIN "LiteLLM_SpendLogs" AS spend_log ON spend_log.request_id = resolved.request_id
			WHERE ${MISMATCH_CONDITION}) AS updated_rows`;
	return `${BATCH_SOURCE}${tail}`;
}

function countSql() {
	return `
	SELECT
		count(*)::bigint AS total,
		count(*) FILTER (
			WHERE cache_read_input_tokens IS DISTINCT FROM (${CACHE_READ_EXPRESSION})
				OR cache_creation_input_tokens IS DISTINCT FROM (${CACHE_CREATION_EXPRESSION})
				OR resolved_model_group IS DISTINCT FROM (${RESOLVED_GROUP_EXPRESSION})
				OR endpoint IS DISTINCT FROM (${ENDPOINT_EXPRESSION})
		)::bigint AS remaining
	FROM "LiteLLM_SpendLogs"
	WHERE request_id IS NOT NULL
`;
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	if (options.help) {
		console.log(
			[
				"用法: node backfill-spend-log-scalar-columns.cjs [--count] [--write] [--after <request_id>] [--batch 500] [--sleep 200] [--limit N]",
				"  --count     只统计列值与来源表达式不一致的行数，不写入",
				"  --write     实际写入（缺省为试算：只扫描并报告将要更新的行数）",
				"  --after     从该 request_id 之后继续（断点续跑）",
				"  --batch     每批行数，默认 500",
				"  --sleep     批间睡眠毫秒数，默认 200",
				"  --limit     最多处理多少个批次",
			].join("\n"),
		);
		return;
	}

	const connectionString = process.env.DATABASE_URL;
	if (!connectionString) {
		throw new Error("DATABASE_URL is required");
	}
	const pool = new Pool({ connectionString, max: 1 });
	const client = await pool.connect();
	try {
		await client.query("SET application_name = 'spendlog-scalar-backfill'");
		await client.query("SET statement_timeout = '300s'");

		if (options.countOnly) {
			const result = await client.query(countSql());
			const row = result.rows[0] ?? {};
			console.log(JSON.stringify({ mode: "count", total: Number(row.total ?? 0), remaining: Number(row.remaining ?? 0) }));
			return;
		}

		const startedAt = Date.now();
		let cursor = options.after;
		let batches = 0;
		let scanned = 0;
		let updated = 0;

		for (;;) {
			if (batches >= options.limit) {
				break;
			}
			const params = [cursor, options.batchSize];
			let row;
			try {
				await client.query("BEGIN");
				if (!options.write) {
					await client.query("SET TRANSACTION READ ONLY");
				}
				await client.query("SET LOCAL lock_timeout = '2s'");
				await client.query("SET LOCAL statement_timeout = '300s'");
				const result = await client.query(batchSql(options.write), params);
				row = result.rows[0];
				await client.query(options.write ? "COMMIT" : "ROLLBACK");
			} catch (error) {
				await client.query("ROLLBACK").catch(() => {});
				console.error(
					JSON.stringify({
						event: "batch_failed",
						cursor,
						error: String(error && error.message ? error.message : error),
					}),
				);
				throw error;
			}

			const scannedRows = Number(row?.scanned_rows ?? 0);
			const updatedRows = Number(row?.updated_rows ?? 0);
			const nextCursor = row?.next_request_id ? String(row.next_request_id) : "";
			batches += 1;
			scanned += scannedRows;
			updated += updatedRows;
			if (scannedRows === 0 || !nextCursor) {
				break;
			}
			if (batches % 20 === 0) {
				console.log(
					JSON.stringify({
						event: "progress",
						batches,
						scanned,
						updated,
						next_cursor: nextCursor,
						elapsed_ms: Date.now() - startedAt,
					}),
				);
			}
			cursor = nextCursor;
			if (options.sleepMs > 0) {
				await sleep(options.sleepMs);
			}
		}

		console.log(
			JSON.stringify({
				event: "done",
				write: options.write,
				batches,
				scanned,
				updated,
				next_cursor: cursor,
				elapsed_ms: Date.now() - startedAt,
			}),
		);
		if (options.write) {
			const result = await client.query(countSql());
			const row = result.rows[0] ?? {};
			console.log(JSON.stringify({ event: "count_after", total: Number(row.total ?? 0), remaining: Number(row.remaining ?? 0) }));
		}
	} finally {
		client.release();
		await pool.end();
	}
}

main().catch((error) => {
	console.error(error && error.stack ? error.stack : String(error));
	process.exit(1);
});
