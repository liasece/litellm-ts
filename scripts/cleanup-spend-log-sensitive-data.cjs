#!/usr/bin/env node
"use strict";
/**
 * 物理清理 SpendLog / ActiveRequests 中已经没有读取入口的敏感字段。
 *
 * 背景：读取侧从 2026-11-17 起统一把认证头替换成 `[REDACTED]`，并忽略
 * `__litellm_responses_body`。但旧行仍把原值留在 TOAST 里，只有确认读取方
 * 已全部切换后，才能把这些字节真正删掉。脚本复用运行时
 * `prepareSpendLogProxyForStorage`，保证写入结果与读写两侧的规则一致。
 *
 * 运行方式（在生产容器内使用独立连接，不经过 HTTP 与主进程）：
 *
 *     docker cp scripts/cleanup-spend-log-sensitive-data.cjs litellm-prod:/app/cleanup.cjs
 *     docker exec litellm-prod node /app/cleanup.cjs                 # 只统计，不写
 *     docker exec litellm-prod node /app/cleanup.cjs --write         # 执行清理
 *     docker exec litellm-prod node /app/cleanup.cjs --write --limit 20
 *
 * 安全边界：
 * - 小批量短事务；SELECT ... FOR UPDATE SKIP LOCKED 避开在线请求正在更新的行；
 * - 只处理包含原始敏感头、或包含内部 body 字段的行，幂等，可重复执行；
 * - 只改 proxy_server_request，不动账务列、消息正文和块引用；
 * - 没有 `--write` 时不加锁、不写库。
 */

const { Pool } = require("pg");

const REDACTED = "[REDACTED]";
const INTERNAL_BODY_KEYS = ["__litellm_responses_body"];
const SENSITIVE_HEADER_NAMES = [
	"authorization",
	"proxy-authorization",
	"api-key",
	"x-api-key",
	"x-goog-api-key",
	"x-litellm-api-key",
	"cookie",
	"set-cookie",
];

const TABLES = [
	{ name: "LiteLLM_SpendLogs", id: "request_id" },
	{ name: "LiteLLM_ActiveRequests", id: "request_id" },
];

function loadModule() {
	const candidates = [
		process.env.SPEND_LOG_BLOCK_MODULE,
		"/app/dist/spend/SpendLogBlocks.js",
		`${__dirname}/../dist/spend/SpendLogBlocks.js`,
	].filter(Boolean);
	for (const candidate of candidates) {
		try {
			return require(candidate);
		} catch (error) {
			if (candidate === candidates[candidates.length - 1]) {
				throw error;
			}
		}
	}
	throw new Error("找不到 SpendLogBlocks 编译产物；请设置 SPEND_LOG_BLOCK_MODULE");
}

const { prepareSpendLogProxyForStorage } = loadModule();

function parseArgs(argv) {
	const options = { batch: 200, sleepMs: 50, limit: 0, write: false };
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		const next = () => {
			index += 1;
			return argv[index];
		};
		if (arg === "--write") {
			options.write = true;
		} else if (arg === "--batch") {
			options.batch = Number.parseInt(next(), 10);
		} else if (arg === "--sleep") {
			options.sleepMs = Number.parseInt(next(), 10);
		} else if (arg === "--limit") {
			options.limit = Number.parseInt(next(), 10);
		} else {
			throw new Error(`未知参数：${arg}`);
		}
	}
	if (!Number.isFinite(options.batch) || options.batch <= 0) {
		throw new Error("--batch 必须是正整数");
	}
	if (!Number.isFinite(options.sleepMs) || options.sleepMs < 0) {
		throw new Error("--sleep 必须是非负整数");
	}
	if (!Number.isFinite(options.limit) || options.limit < 0) {
		throw new Error("--limit 必须是非负整数");
	}
	return options;
}

function sqlLiteral(value) {
	return `'${value.replace(/'/g, "''")}'`;
}

function sqlLiteralList(values) {
	return values.map(sqlLiteral).join(", ");
}

/**
 * 只选中确实还含有原值或内部字段的行；已经 [REDACTED] 的行不会反复进入批次。
 * 头部键名用 lower() 比较，和运行时 helper 的大小写不敏感规则一致。
 */
function sensitiveCondition(column) {
	const headers = (path) => `(
		jsonb_typeof(${path}) = 'object' AND EXISTS (
			SELECT 1
			FROM jsonb_each_text(${path}) AS header(key, value)
			WHERE lower(header.key) IN (${sqlLiteralList(SENSITIVE_HEADER_NAMES)})
			  AND header.value IS DISTINCT FROM ${sqlLiteral(REDACTED)}
		)
	)`;
	const internalBody = (path, key) => `(
		jsonb_typeof(${path}) = 'object' AND ${path} ? ${sqlLiteral(key)}
	)`;
	const internalBodies = (path) => INTERNAL_BODY_KEYS.map((key) => internalBody(path, key)).join(" OR ");
	return `(
		${headers(`${column}->'headers'`)}
		OR ${headers(`${column}->'upstream_request'->'headers'`)}
		OR ${headers(`${column}->'upstream_response'->'headers'`)}
		OR ${internalBodies(`${column}->'body'`)}
		OR ${internalBodies(`${column}->'upstream_request'->'body'`)}
		OR ${internalBodies(`${column}->'upstream_response'->'body'`)}
	)`;
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function countCandidates(pool, table) {
	const result = await pool.query(
		`SELECT count(*)::int AS count FROM "${table.name}" WHERE ${sensitiveCondition("proxy_server_request")}`,
	);
	return result.rows[0]?.count ?? 0;
}

async function processTable(pool, table, options, stats) {
	const condition = sensitiveCondition("proxy_server_request");
	let remaining = options.limit > 0 ? Math.max(0, options.limit - stats.scanned) : Number.POSITIVE_INFINITY;
	// 用主键游标续扫，避免每批都从表头重新评估已处理的前缀（O(n²)）。
	let lastId = null;
	while (remaining > 0) {
		const batchSize = Math.min(options.batch, remaining);
		const client = await pool.connect();
		let rows;
		try {
			await client.query("BEGIN");
			await client.query("SET LOCAL lock_timeout = '15s'");
			await client.query("SET LOCAL statement_timeout = '120s'");
			const cursor = lastId === null ? "" : `AND "${table.id}" > $2`;
			const params = lastId === null ? [batchSize] : [batchSize, lastId];
			const result = await client.query(
				`SELECT "${table.id}" AS id, proxy_server_request
				 FROM "${table.name}"
				 WHERE ${condition} ${cursor}
				 ORDER BY "${table.id}"
				 LIMIT $1
				 FOR UPDATE SKIP LOCKED`,
				params,
			);
			rows = result.rows;
			if (rows.length === 0) {
				await client.query("COMMIT");
				break;
			}

			const ids = [];
			const payloads = [];
			for (const row of rows) {
				const prepared = prepareSpendLogProxyForStorage(row.proxy_server_request);
				if (JSON.stringify(prepared) === JSON.stringify(row.proxy_server_request)) {
					// 条件与 helper 的敏感字段列表不一致时，宁可报错也不要空转。
					throw new Error(`第 ${row.id} 行命中清理条件但 helper 未产生变化，请检查敏感字段定义`);
				}
				ids.push(row.id);
				payloads.push(JSON.stringify(prepared));
			}
			await client.query(
				`UPDATE "${table.name}" AS target
				 SET proxy_server_request = source.payload::jsonb
				 FROM UNNEST($1::text[], $2::text[]) AS source(id, payload)
				 WHERE target."${table.id}" = source.id`,
				[ids, payloads],
			);
			await client.query("COMMIT");
			stats.scanned += rows.length;
			stats.changed += rows.length;
			stats.tables[table.name] = (stats.tables[table.name] ?? 0) + rows.length;
			remaining -= rows.length;
			lastId = rows[rows.length - 1].id;
			process.stdout.write(`\r${table.name}: 已处理 ${stats.tables[table.name]} 行`);
		} catch (error) {
			await client.query("ROLLBACK").catch(() => undefined);
			throw error;
		} finally {
			client.release();
		}
		if (rows.length < batchSize) {
			break;
		}
		await sleep(options.sleepMs);
	}
	if (stats.tables[table.name] !== undefined) {
		process.stdout.write("\n");
	}
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	if (!process.env.DATABASE_URL) {
		throw new Error("缺少 DATABASE_URL");
	}
	const pool = new Pool({
		connectionString: process.env.DATABASE_URL,
		max: 1,
		application_name: "spendlog-sensitive-cleanup",
	});
	const stats = { scanned: 0, changed: 0, tables: {} };
	try {
		if (!options.write) {
			for (const table of TABLES) {
				const count = await countCandidates(pool, table);
				console.log(`${table.name}: ${count} 行含原认证头或内部 body（只统计，未写入）`);
			}
			return;
		}
		for (const table of TABLES) {
			await processTable(pool, table, options, stats);
		}
		console.log(`完成：处理 ${stats.changed} 行；再次运行应剩余 0 行。`);
		for (const table of TABLES) {
			const count = await countCandidates(pool, table);
			console.log(`${table.name}: 剩余 ${count} 行`);
		}
	} finally {
		await pool.end();
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
