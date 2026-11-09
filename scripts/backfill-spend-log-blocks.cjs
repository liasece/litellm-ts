#!/usr/bin/env node
"use strict";
/**
 * SpendLog 历史行内容寻址回填（旁路脚本）。
 *
 * 目的：把 2026-11-09 06:31 之前写入的整段内联请求体，改写成与运行时代码完全相同的
 * 引用形态（`_litellm_ref_*` / `"$messages"`），块写入 `LiteLLM_SpendLogBlocks`。
 *
 * 运行方式：在生产容器内用独立进程执行，**不复用服务进程**：
 *
 *     docker cp scripts/backfill-spend-log-blocks.cjs litellm-prod:/app/backfill.cjs
 *     docker exec litellm-prod node /app/backfill.cjs --from ... --to ...        # 试算，不写
 *     docker exec litellm-prod node /app/backfill.cjs --from ... --to ... --write
 *
 * 为什么不重新实现编码：块 id 是内容哈希，脚本必须与运行时逐字节一致地规范化 JSON，
 * 否则同一内容会存成两份块。这里直接 require 镜像里编译好的 `dist/spend/SpendLogBlocks.js`。
 *
 * 对在线请求的影响控制：
 * - 独立进程、独立连接（`application_name=spendlog-backfill`），不经过 HTTP 与主进程；
 * - 小批量（默认 50 行）+ 批间睡眠（默认 200ms），批内单个短事务；
 * - 每批事务设置 `lock_timeout` / `statement_timeout`，避免长时间持锁；
 * - 只读改写 `startTime` 早于 cutover 的行，不与在线写入争抢同一批元组；
 * - 每批写入前做「编码 → 还原 → 与原值比对」自检，不通过的行跳过而不是写坏。
 */

const { Pool } = require("pg");

const INSERT_CHUNK_SIZE = 500;

function loadBlockModule() {
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
	throw new Error("找不到 SpendLogBlocks 编译产物");
}

const blocks = loadBlockModule();

function parseArgs(argv) {
	const options = {
		from: null,
		to: null,
		batch: 50,
		sleepMs: 200,
		limit: 0,
		write: false,
		verify: true,
		verifyRate: 1,
		quiet: false,
	};
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		const next = () => {
			index += 1;
			return argv[index];
		};
		if (arg === "--from") {
			options.from = next();
		} else if (arg === "--to") {
			options.to = next();
		} else if (arg === "--batch") {
			options.batch = Number.parseInt(next(), 10);
		} else if (arg === "--sleep") {
			options.sleepMs = Number.parseInt(next(), 10);
		} else if (arg === "--limit") {
			options.limit = Number.parseInt(next(), 10);
		} else if (arg === "--write") {
			options.write = true;
		} else if (arg === "--no-verify") {
			options.verify = false;
		} else if (arg === "--verify-rate") {
			options.verifyRate = Number.parseInt(next(), 10);
			options.verify = options.verifyRate > 0;
		} else if (arg === "--quiet") {
			options.quiet = true;
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
	return options;
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 已经带引用键的行不能再次编码（编码器会剥离这些键），直接跳过。 */
function isAlreadyEncoded(row) {
	const messages = row.messages;
	if (messages !== null && typeof messages === "object" && !Array.isArray(messages)) {
		if (Array.isArray(messages[blocks.SPEND_LOG_MESSAGE_REF_KEY])) {
			return true;
		}
	}
	return false;
}

function textLength(value) {
	if (value === null || value === undefined) {
		return 0;
	}
	return Buffer.byteLength(JSON.stringify(value), "utf8");
}

/** 找出本批里「编码后有变化」的行，并附上块清单。 */
function planBatch(rows) {
	const plan = [];
	let skippedEncoded = 0;
	let skippedNoop = 0;
	for (const row of rows) {
		if (isAlreadyEncoded(row)) {
			skippedEncoded += 1;
			continue;
		}
		const encoding = blocks.collectSpendLogBlocks({
			messages: row.messages,
			proxyServerRequest: row.proxy_server_request,
		});
		if (encoding.blocks.length === 0) {
			skippedNoop += 1;
			continue;
		}
		const before = (row.messages_bytes ?? 0) + (row.psr_bytes ?? 0);
		const after = textLength(encoding.messages) + textLength(encoding.proxyServerRequest);
		plan.push({ row, encoding, before, after });
	}
	return { plan, skippedEncoded, skippedNoop };
}

async function insertBlocks(client, blockList) {
	let inserted = 0;
	for (let offset = 0; offset < blockList.length; offset += INSERT_CHUNK_SIZE) {
		const chunk = blockList.slice(offset, offset + INSERT_CHUNK_SIZE);
		const ids = chunk.map((block) => block.blockId);
		const payloads = chunk.map((block) => JSON.stringify(block.payload));
		const sizes = chunk.map((block) => block.byteSize);
		const result = await client.query(
			`INSERT INTO "LiteLLM_SpendLogBlocks" (block_id, payload, byte_size)
			 SELECT block_id, payload::jsonb, byte_size
			 FROM UNNEST($1::text[], $2::text[], $3::integer[]) AS t(block_id, payload, byte_size)
			 ON CONFLICT (block_id) DO NOTHING
			 RETURNING block_id`,
			[ids, payloads, sizes],
		);
		inserted += result.rowCount ?? 0;
	}
	return inserted;
}

async function updateRows(client, rows) {
	const ids = rows.map((entry) => entry.row.request_id);
	const messages = rows.map((entry) => JSON.stringify(entry.encoding.messages));
	const payloads = rows.map((entry) => JSON.stringify(entry.encoding.proxyServerRequest));
	await client.query(
		`UPDATE "LiteLLM_SpendLogs" AS target
		 SET messages = source.messages::jsonb,
		     proxy_server_request = source.payload::jsonb
		 FROM UNNEST($1::text[], $2::text[], $3::text[]) AS source(request_id, messages, payload)
		 WHERE target.request_id = source.request_id`,
		[ids, messages, payloads],
	);
}

/** 编码 → 还原 → 与原始值比对；返回不匹配的行（这些行不写）。 */
async function verifyBatch(client, plan, knownBlocks) {
	const mismatched = [];
	const referencedByRow = new Map();
	const missing = new Set();
	for (const entry of plan) {
		const referenced = blocks.collectReferencedBlockIds(entry.encoding.messages, entry.encoding.proxyServerRequest);
		referencedByRow.set(entry.row.request_id, referenced);
		for (const blockId of referenced) {
			if (!knownBlocks.has(blockId)) {
				missing.add(blockId);
			}
		}
	}
	const lookup = new Map();
	for (const [blockId, record] of knownBlocks) {
		lookup.set(blockId, record.payload);
	}
	if (missing.size > 0) {
		const found = await client.query(
			'SELECT block_id, payload FROM "LiteLLM_SpendLogBlocks" WHERE block_id = ANY($1::text[])',
			[[...missing]],
		);
		for (const row of found.rows) {
			lookup.set(row.block_id, row.payload);
		}
	}
	for (const entry of plan) {
		const encodedRow = {
			messages: entry.encoding.messages,
			proxy_server_request: entry.encoding.proxyServerRequest,
		};
		const restored = blocks.restoreSpendLogPayload(encodedRow, (blockId) => lookup.get(blockId));
		const ok =
			restored.missingBlockIds.length === 0 &&
			blocks.canonicalJson(restored.messages) === blocks.canonicalJson(entry.row.messages) &&
			blocks.canonicalJson(restored.proxyServerRequest) === blocks.canonicalJson(entry.row.proxy_server_request);
		if (!ok) {
			mismatched.push(entry.row.request_id);
		}
	}
	return mismatched;
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	if (!process.env.DATABASE_URL) {
		throw new Error("缺少 DATABASE_URL");
	}
	const pool = new Pool({
		connectionString: process.env.DATABASE_URL,
		max: 2,
		application_name: "spendlog-backfill",
		statement_timeout: 300_000,
	});
	const stats = {
		batches: 0,
		scanned: 0,
		written: 0,
		skippedEncoded: 0,
		skippedNoop: 0,
		skippedUnverified: 0,
		blocks: 0,
		beforeBytes: 0,
		afterBytes: 0,
	};

	let cursorTime = options.from ? new Date(options.from) : new Date("1970-01-01T00:00:00Z");
	let cursorId = "";
	let stop = false;
	let attempt = 0;
	const timing = { scan: 0, encode: 0, tx: 0 };
	process.on("SIGINT", () => {
		stop = true;
		console.log("[backfill] 收到中断信号，当前批完成后退出");
	});

	while (!stop) {
		if (options.limit > 0 && stats.written >= options.limit) {
			break;
		}
		const batchStartedAt = Date.now();
		const fromTime = cursorTime;
		const fromId = cursorId;
		const scanned = await pool.query(
			`SELECT request_id, "startTime" AS started_at, messages, proxy_server_request,
			        octet_length(messages::text) AS messages_bytes,
			        octet_length(proxy_server_request::text) AS psr_bytes
			 FROM "LiteLLM_SpendLogs"
			 WHERE ("startTime", request_id) > ($1::timestamptz, $2::text)
			   AND ($3::timestamptz IS NULL OR "startTime" < $3::timestamptz)
			 ORDER BY "startTime", request_id
			 LIMIT $4`,
			[cursorTime.toISOString(), cursorId, options.to, options.batch],
		);
		if (scanned.rows.length === 0) {
			break;
		}
		timing.scan += Date.now() - batchStartedAt;
		const last = scanned.rows[scanned.rows.length - 1];
		cursorTime = new Date(last.started_at);
		cursorId = last.request_id;
		stats.scanned += scanned.rows.length;

		const encodeStartedAt = Date.now();
		const { plan, skippedEncoded, skippedNoop } = planBatch(scanned.rows);
		timing.encode += Date.now() - encodeStartedAt;
		attempt = 0;
		stats.skippedEncoded += skippedEncoded;
		stats.skippedNoop += skippedNoop;

		const txStartedAt = Date.now();
		if (plan.length > 0) {
			const client = await pool.connect();
			try {
				await client.query("BEGIN");
				await client.query("SET LOCAL lock_timeout = '5s'");
				await client.query("SET LOCAL statement_timeout = '120s'");
				const allBlocks = new Map();
				for (const entry of plan) {
					for (const block of entry.encoding.blocks) {
						allBlocks.set(block.blockId, block);
					}
				}
				stats.blocks += await insertBlocks(client, [...allBlocks.values()]);
				const verifyThisBatch = options.verify && stats.batches % options.verifyRate === 0;
				if (verifyThisBatch) {
					const mismatched = new Set(await verifyBatch(client, plan, allBlocks));
					if (mismatched.size > 0) {
						stats.skippedUnverified += mismatched.size;
						for (const entry of plan) {
							if (mismatched.has(entry.row.request_id)) {
								entry.skip = true;
							}
						}
					}
				}
				const writable = plan.filter((entry) => !entry.skip);
				if (options.write && writable.length > 0) {
					await updateRows(client, writable);
					for (const entry of writable) {
						stats.beforeBytes += entry.before;
						stats.afterBytes += entry.after;
					}
					stats.written += writable.length;
				} else if (!options.write) {
					stats.written += writable.length;
					for (const entry of writable) {
						stats.beforeBytes += entry.before;
						stats.afterBytes += entry.after;
					}
				}
				// 试算模式只做插入与校验，随后回滚，不在块表留下无引用的垃圾。
				await client.query(options.write ? "COMMIT" : "ROLLBACK");
			} catch (error) {
				await client.query("ROLLBACK").catch(() => {});
				const code = error && typeof error === "object" ? error.code : undefined;
				const retryable = code === "40P01" || code === "40001" || code === "57014" || code === "55P03";
				if (retryable && attempt < 5) {
					attempt += 1;
					cursorTime = fromTime;
					cursorId = fromId;
					stats.scanned -= scanned.rows.length;
					console.log(`[backfill] 批次冲突(${code})，回退游标重试第 ${attempt} 次`);
					await sleep(1_500 * attempt);
					continue;
				}
				throw error;
			} finally {
				client.release();
			}
		}

		timing.tx += Date.now() - txStartedAt;
		stats.batches += 1;
		if (stats.batches % 20 === 0 && !options.quiet) {
			const elapsed = (Date.now() - batchStartedAt) / 1000;
			const ratio = stats.beforeBytes > 0 ? (100 - (100 * stats.afterBytes) / stats.beforeBytes).toFixed(1) : "0.0";
			console.log(
				`[backfill] 批次=${stats.batches} 扫描=${stats.scanned} 改写=${stats.written} 块=${stats.blocks} ` +
					`体积 ${(stats.beforeBytes / 1048576).toFixed(1)}MB -> ${(stats.afterBytes / 1048576).toFixed(1)}MB (省 ${ratio}%) ` +
					`本轮耗时=${elapsed.toFixed(2)}s 均值(扫描/编码/事务)=` +
					`${(timing.scan / stats.batches / 1000).toFixed(2)}/${(timing.encode / stats.batches / 1000).toFixed(2)}/` +
					`${(timing.tx / stats.batches / 1000).toFixed(2)}s 游标=${cursorTime.toISOString()}`,
			);
		}
		if (options.sleepMs > 0) {
			await sleep(options.sleepMs);
		}
	}

	const savedRatio = stats.beforeBytes > 0 ? (100 - (100 * stats.afterBytes) / stats.beforeBytes).toFixed(1) : "0.0";
	console.log(
		`[backfill] 结束 mode=${options.write ? "write" : "dry-run"} 扫描=${stats.scanned} 改写=${stats.written} ` +
			`跳过(已编码)=${stats.skippedEncoded} 跳过(无需处理)=${stats.skippedNoop} 跳过(校验失败)=${stats.skippedUnverified} ` +
			`块=${stats.blocks} 体积 ${(stats.beforeBytes / 1048576).toFixed(1)}MB -> ${(stats.afterBytes / 1048576).toFixed(1)}MB (省 ${savedRatio}%)`,
	);
	console.log(`[backfill] 下次续跑游标：--from ${cursorTime.toISOString()}`);
	await pool.end();
}

main().catch((error) => {
	console.error(`[backfill] 失败：${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
});
