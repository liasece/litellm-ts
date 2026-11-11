#!/usr/bin/env node
"use strict";
/**
 * SpendLog 过滤列历史回填（旁路脚本）。
 *
 * 目的：`LiteLLM_SpendLogs.key_alias` / `error_code` 是为表头过滤新增的冗余列
 * （见 drizzle/0016_spend_log_filter_columns.sql）。新写入由服务进程直接填好，
 * 存量行需要用本脚本从 metadata 回填一次，之后读侧才能从 metadata 切到列上。
 *
 * 运行方式：在运行中的生产容器里用独立进程执行，不经过 HTTP 与主进程：
 *
 *     docker cp scripts/backfill-spend-log-filter-columns.cjs litellm-prod:/app/backfill-filter-columns.cjs
 *     docker exec litellm-prod node /app/backfill-filter-columns.cjs --limit 2     # 试算，不写
 *     docker exec litellm-prod node /app/backfill-filter-columns.cjs --write       # 全量回填
 *     docker exec litellm-prod node /app/backfill-filter-columns.cjs --count       # 只统计剩余
 *
 * 并发与中断：
 * - `--partition i/n` 把表按 `request_id` 哈希切成 n 份，多个进程可并行跑不同分片；
 * - `--after <request_id>` 从上次输出的 `next_cursor` 续跑，分片内游标单调递增；
 * - 每批一个短事务并校验列值差异，重复执行不会重复写。
 *
 * 语义：与读侧、写侧同一来源。`key_alias` 取 `metadata->>'user_api_key_alias'`，
 * `error_code` 取 `metadata->'error_information'->>'error_code'`；metadata 不是对象时
 * 两者都为 NULL（与 `jsonb_typeof(metadata) = 'object'` 守卫的读侧一致）。
 *
 * 对在线请求的影响控制：
 * - 独立连接（`application_name=spendlog-filter-backfill`），不经过服务进程；
 * - 批量读写 metadata 的一小段、只更新列值确实不同的行，不改 metadata 与任何大字段；
 * - 每批事务设置 `lock_timeout` / `statement_timeout`，批间可睡眠限速。
 *
 * 回填完成后用 `--count` 确认 remaining=0，再发布读侧切换。
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
		partition: null,
		skipDone: false,
	};
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--write") {
			options.write = true;
		} else if (arg === "--skip-done") {
			options.skipDone = true;
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
		} else if (arg === "--partition") {
			const match = /^(\d{1,2})\/(\d{1,2})$/.exec(String(argv[index + 1] ?? ""));
			if (!match) {
				throw new Error("--partition expects <index>/<total>, e.g. 0/6");
			}
			const partitionIndex = Number.parseInt(match[1], 10);
			const partitionTotal = Number.parseInt(match[2], 10);
			if (partitionTotal < 1 || partitionTotal > 16 || partitionIndex >= partitionTotal) {
				throw new Error("--partition must satisfy 0 <= index < total <= 16");
			}
			options.partition = { index: partitionIndex, total: partitionTotal };
			index += 1;
		} else if (arg === "--help" || arg === "-h") {
			options.help = true;
		} else {
			throw new Error(`unknown argument: ${arg}`);
		}
	}
	return options;
}

const HEX_DIGITS = "0123456789abcdef";

/**
 * 稳定分片边界：按 request_id 的首个十六进制字符切成连续区间。
 *
 * 不用哈希分片：哈希谓词会让 `ORDER BY request_id LIMIT n` 需要多扫数倍索引，
 * 规划器在中段会改选全表扫描（实测每批 1.6 GB、70 s）。连续区间保持纯索引区间扫描。
 * @param partition - 分片序号与总数
 */
function partitionBounds(partition) {
	if (!partition) {
		return { from: "", to: null };
	}
	const boundary = (index) => HEX_DIGITS[Math.floor((index * HEX_DIGITS.length) / partition.total)];
	return {
		from: partition.index === 0 ? "" : boundary(partition.index),
		to: partition.index === partition.total - 1 ? null : boundary(partition.index + 1),
	};
}

/** 分片谓词：游标 + 首字符区间，二者都让索引保持在连续范围内。 */
function partitionWhere(partition, paramIndex) {
	if (!partition) {
		return { sql: "", params: [] };
	}
	const bounds = partitionBounds(partition);
	const params = [];
	const parts = [];
	if (bounds.from) {
		params.push(bounds.from);
		parts.push(`AND request_id >= $${String(paramIndex + params.length - 1)}`);
	}
	if (bounds.to !== null) {
		params.push(bounds.to);
		parts.push(`AND request_id < $${String(paramIndex + params.length - 1)}`);
	}
	return { sql: parts.join("\n\t\t\t"), params };
}

const RESOLVED_COLUMNS = `
	SELECT
		request_id,
		CASE WHEN jsonb_typeof(metadata) = 'object' THEN metadata ->> 'user_api_key_alias' END AS key_alias,
		CASE WHEN jsonb_typeof(metadata) = 'object' THEN metadata -> 'error_information' ->> 'error_code' END AS error_code
	FROM batch`;

function batchSql(partition, skipDone) {
	const where = partitionWhere(partition, 3);
	const skipWhere = skipDone ? "AND key_alias IS NULL" : "";
	return `
	WITH batch AS MATERIALIZED (
		SELECT request_id, metadata
		FROM "LiteLLM_SpendLogs"
		WHERE request_id > $1
			${where.sql}
			${skipWhere}
		ORDER BY request_id
		LIMIT $2
	), resolved AS MATERIALIZED (${RESOLVED_COLUMNS}
	), updated AS (
		UPDATE "LiteLLM_SpendLogs" AS spend_log
		SET key_alias = resolved.key_alias,
			error_code = resolved.error_code
		FROM resolved
		WHERE spend_log.request_id = resolved.request_id
			AND (spend_log.key_alias IS DISTINCT FROM resolved.key_alias
				OR spend_log.error_code IS DISTINCT FROM resolved.error_code)
		RETURNING spend_log.request_id
	)
	SELECT
		(SELECT max(request_id) FROM batch) AS next_request_id,
		(SELECT count(*) FROM batch) AS scanned_rows,
		(SELECT count(*) FROM updated) AS updated_rows
`;
}

function dryRunSql(partition, skipDone) {
	const where = partitionWhere(partition, 3);
	const skipWhere = skipDone ? "AND key_alias IS NULL" : "";
	return `
	WITH batch AS MATERIALIZED (
		SELECT request_id, metadata
		FROM "LiteLLM_SpendLogs"
		WHERE request_id > $1
			${where.sql}
			${skipWhere}
		ORDER BY request_id
		LIMIT $2
	), resolved AS MATERIALIZED (${RESOLVED_COLUMNS}
	)
	SELECT
		(SELECT max(request_id) FROM batch) AS next_request_id,
		(SELECT count(*) FROM batch) AS scanned_rows,
		(SELECT count(*) FROM resolved WHERE key_alias IS NOT NULL OR error_code IS NOT NULL) AS updated_rows
`;
}

const LEGACY_EXPRESSION = `
	CASE WHEN jsonb_typeof(metadata) = 'object' THEN metadata ->> 'user_api_key_alias' END
`;
const LEGACY_ERROR_EXPRESSION = `
	CASE WHEN jsonb_typeof(metadata) = 'object' THEN metadata -> 'error_information' ->> 'error_code' END
`;

function countSql(partition) {
	// 只统计「列值与 metadata 推导值不一致」的行：0 表示该范围内回填完成。
	const bounds = partitionBounds(partition);
	const where = partition
		? `AND request_id >= '${bounds.from}' ${bounds.to === null ? "" : `AND request_id < '${bounds.to}'`}`
		: "";
	return `
	SELECT
		count(*)::bigint AS total,
		count(*) FILTER (
			WHERE key_alias IS DISTINCT FROM (${LEGACY_EXPRESSION})
				OR error_code IS DISTINCT FROM (${LEGACY_ERROR_EXPRESSION})
		)::bigint AS remaining
	FROM "LiteLLM_SpendLogs"
	WHERE request_id IS NOT NULL ${where}
`;
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function countRemaining(client, partition) {
	const result = await client.query(countSql(partition));
	const row = result.rows[0] ?? {};
	return { total: Number(row.total ?? 0), remaining: Number(row.remaining ?? 0) };
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	if (options.help) {
		console.log(
			[
				"用法: node backfill-spend-log-filter-columns.cjs [--count] [--write] [--after <request_id>] [--partition i/n] [--batch 500] [--sleep 200] [--limit N]",
				"  --count     只统计列值与 metadata 不一致的行数，不写入",
				"  --write     实际写入（缺省为试算：只扫描并报告将要更新的行数）",
				"  --after     从该 request_id 之后继续（断点续跑）",
				"  --partition 只处理首字符区间分片 i/n（可多进程并行）",
				"  --skip-done 跳过 key_alias 已填充的行（续跑时只处理剩余量，代价更低）",
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
		await client.query("SET application_name = 'spendlog-filter-backfill'");
		await client.query("SET statement_timeout = '300s'");

		if (options.countOnly) {
			console.log(JSON.stringify({ mode: "count", partition: options.partition, ...(await countRemaining(client, options.partition)) }));
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
			const where = partitionWhere(options.partition, 3);
			const params = [cursor, options.batchSize, ...where.params];
			let row;
			try {
				// 试算在只读事务里跑：与写入分支同一批数据，但只统计「将会更新」的行数。
				await client.query("BEGIN");
				if (!options.write) {
					await client.query("SET TRANSACTION READ ONLY");
				}
				await client.query("SET LOCAL lock_timeout = '2s'");
				await client.query("SET LOCAL statement_timeout = '300s'");
				const batchQuery = options.write
					? batchSql(options.partition, options.skipDone)
					: dryRunSql(options.partition, options.skipDone);
				const result = await client.query(batchQuery, params);
				row = result.rows[0];
				await client.query(options.write ? "COMMIT" : "ROLLBACK");
			} catch (error) {
				await client.query("ROLLBACK").catch(() => {});
				console.error(
					JSON.stringify({
						event: "batch_failed",
						cursor,
						partition: options.partition,
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
						partition: options.partition,
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
				partition: options.partition,
				batches,
				scanned,
				updated,
				next_cursor: cursor,
				elapsed_ms: Date.now() - startedAt,
			}),
		);
		if (options.write && !options.partition) {
			console.log(JSON.stringify({ event: "count_after", ...(await countRemaining(client, null)) }));
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
