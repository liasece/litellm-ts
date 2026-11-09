/**
 * PostgreSQL 连接池与语句耗时观测。
 *
 * 做法：在 Pool 实例上包一层 query/connect，并对每个新建物理连接包 client.query。
 * Drizzle 的每次查询最终都落到这两处，因此不必改动任何 Repository。
 *
 * 记录内容刻意只包含「语句类型 + 形态指纹 + 耗时」：SQL 明文中带有账务金额、
 * Token 数甚至凭据字段，直接写日志会把敏感数据带进日志系统。形态指纹把字面量与
 * 参数替换成 `?`，既能区分是哪类语句慢，又不泄内容。
 */

import type { Pool, PoolClient } from "pg";
import { performance } from "node:perf_hooks";
import { createModuleLogger } from "../core/utils/logger";
import { currentRequestTrace } from "./RequestTrace";
import {
	dbPoolConnections,
	dbPoolWait,
	dbQueriesTotal,
	dbQueryDuration,
	dbSlowQueriesTotal,
	metricsRegistry,
} from "./MetricCatalog";

const logger = createModuleLogger("Observability:Database");

/** 超过该耗时的语句计入慢语句并打日志（毫秒）。 */
const SLOW_QUERY_THRESHOLD_MS = 200;

/** 形态指纹最大长度。 */
const MAX_FINGERPRINT_LENGTH = 160;

/** 已安装抓取回调的连接池，避免重复登记。 */
const instrumentedPools = new WeakSet<object>();

/** 连接池实例数量；用于判断是否重复安装抓取回调。 */
let scrapeHookInstalled = false;

/** 当前观测的连接池；抓取时读取 totalCount/idleCount/waitingCount。 */
let observedPool: Pool | null = null;

/**
 * 从 pg 查询参数里取出 SQL 文本。
 * @param args - query() 的实参
 */
function extractSql(args: readonly unknown[]): string {
	const first = args[0];
	if (typeof first === "string") {
		return first;
	}
	if (typeof first === "object" && first !== null) {
		const text = (first as { text?: unknown }).text;
		if (typeof text === "string") {
			return text;
		}
	}
	return "";
}

/**
 * 归类语句类型，作为低基数标签。
 * @param sql - SQL 文本
 */
export function classifySqlOperation(sql: string): string {
	const match = /^\s*(?:\(|\/\*[\s\S]*?\*\/\s*)*([a-zA-Z]+)/.exec(sql);
	const keyword = match?.[1]?.toUpperCase();
	switch (keyword) {
		case "SELECT":
		case "INSERT":
		case "UPDATE":
		case "DELETE":
		case "WITH":
		case "BEGIN":
		case "COMMIT":
		case "ROLLBACK":
		case "START":
		case "SAVEPOINT":
		case "RELEASE":
		case "SET":
		case "SHOW":
		case "CREATE":
		case "ALTER":
		case "DROP":
		case "TRUNCATE":
		case "ANALYZE":
		case "VACUUM":
		case "COPY":
		case "EXPLAIN":
		case "LISTEN":
		case "NOTIFY":
			return keyword;
		default:
			return "OTHER";
	}
}

/**
 * 生成语句形态指纹：去掉字面量与参数，只保留结构与表名。
 * @param sql - SQL 文本
 */
export function sqlFingerprint(sql: string): string {
	const collapsed = sql
		.replace(/'(?:[^']|'')*'/g, "?")
		.replace(/\$\d+/g, "?")
		.replace(/\b\d+(?:\.\d+)?\b/g, "?")
		.replace(/\s+/g, " ")
		.trim();
	return collapsed.length <= MAX_FINGERPRINT_LENGTH ? collapsed : `${collapsed.slice(0, MAX_FINGERPRINT_LENGTH)}\u2026`;
}

/**
 * 记录一次语句观测。
 * @param op - 语句类型
 * @param durationMs - 耗时
 * @param ok - 是否成功
 * @param sql - SQL 文本（仅用于慢语句形态指纹）
 */
function observeQuery(op: string, durationMs: number, ok: boolean, sql: string): void {
	dbQueriesTotal.inc({ op: op, outcome: ok ? "ok" : "error" });
	// 请求内累计：回答「这个请求在调用上游之前花了几次往返」这类问题。
	const trace = currentRequestTrace();
	if (trace !== undefined) {
		trace.dbQueries += 1;
		if (!ok) {
			trace.dbErrors += 1;
		}
	}
	dbQueryDuration.observe(durationMs / 1000, { op: op });
	if (!ok || durationMs < SLOW_QUERY_THRESHOLD_MS) {
		return;
	}
	dbSlowQueriesTotal.inc({ op: op });
	logger.warn("慢语句", { op: op, durationMs: Math.round(durationMs), sql: sqlFingerprint(sql) });
}

/**
 * 包装异步或回调风格的 pg 调用。
 * @param invoke - 原始调用
 * @param args - 实参
 * @param onSettled - 结束时回调
 */
function instrumentCall(
	invoke: (...callArgs: unknown[]) => unknown,
	args: unknown[],
	onSettled: (ok: boolean) => void,
): unknown {
	const lastIndex = args.length - 1;
	const callback = lastIndex >= 0 ? args[lastIndex] : undefined;
	if (typeof callback === "function") {
		const wrapped = (...callbackArgs: unknown[]): void => {
			onSettled(callbackArgs[0] === null || callbackArgs[0] === undefined);
			(callback as (...rest: unknown[]) => void)(...callbackArgs);
		};
		args[lastIndex] = wrapped;
		return invoke(...args);
	}
	const result = invoke(...args);
	if (result instanceof Promise) {
		return result.then(
			(value: unknown) => {
				onSettled(true);
				return value;
			},
			(error: unknown) => {
				onSettled(false);
				throw error;
			},
		);
	}
	onSettled(true);
	return result;
}

/**
 * 包装单个连接的 query，使事务内的语句也能被计时。
 * @param client - 池内连接
 */
function instrumentClient(client: PoolClient): void {
	if (instrumentedPools.has(client)) {
		return;
	}
	instrumentedPools.add(client);
	const target = client as unknown as { query: (...args: unknown[]) => unknown };
	const original = target.query.bind(client) as (...args: unknown[]) => unknown;
	target.query = (...args: unknown[]): unknown => {
		const sql = extractSql(args);
		const op = classifySqlOperation(sql);
		const startedAt = performance.now();
		return instrumentCall(
			original,
			args,
			(ok: boolean) => {
				observeQuery(op, performance.now() - startedAt, ok, sql);
			},
		);
	};
}

/**
 * 写入连接池水位指标；非数值直接跳过。
 * @param value - 池指标值
 * @param state - 状态标签
 */
function setPoolGauge(value: number | undefined, state: string): void {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return;
	}
	dbPoolConnections.set(value, { state: state });
}

/** 在抓取时刷新连接池水位指标。 */
function installScrapeHook(): void {
	if (scrapeHookInstalled) {
		return;
	}
	scrapeHookInstalled = true;
	metricsRegistry.onScrape(() => {
		const pool = observedPool as Partial<Pool> | null;
		if (pool === null || pool === undefined) {
			return;
		}
		// 池实现可以是测试替身：任何字段缺失都只是少一个数，不能让抓取失败。
		setPoolGauge(pool.totalCount, "total");
		setPoolGauge(pool.idleCount, "idle");
		// waiting 持续大于 0 说明池已被打满；上限值同时暴露出来，才能判断是「配置小」还是「泄漏」。
		setPoolGauge(pool.waitingCount, "waiting");
		setPoolGauge(pool.options?.max, "max");
	});
}

/**
 * 为连接池安装观测。
 * @param pool - pg 连接池实例
 */
export function instrumentDatabasePool(pool: Pool): void {
	installScrapeHook();
	observedPool = pool;
	const target = pool as unknown as { query: (...args: unknown[]) => unknown; connect: (...args: unknown[]) => unknown };
	const originalQuery = target.query.bind(pool) as (...args: unknown[]) => unknown;
	target.query = (...args: unknown[]): unknown => {
		const sql = extractSql(args);
		const op = classifySqlOperation(sql);
		const startedAt = performance.now();
		return instrumentCall(
			originalQuery,
			args,
			(ok: boolean) => {
				observeQuery(op, performance.now() - startedAt, ok, sql);
			},
		);
	};
	const originalConnect = target.connect.bind(pool) as (...args: unknown[]) => unknown;
	target.connect = (...args: unknown[]): unknown => {
		const startedAt = performance.now();
		return instrumentCall(
			originalConnect,
			args,
			() => {
				dbPoolWait.observe((performance.now() - startedAt) / 1000);
			},
		);
	};
	if (typeof pool.on === "function") {
		pool.on("connect", (client: PoolClient) => {
			instrumentClient(client);
		});
		// 空闲连接报错时 pg 会向池 emit error；没有监听器会直接抛成未捕获异常。
		pool.on("error", (error: Error) => {
			logger.error("数据库连接池空闲连接异常", { error: error });
		});
	}
	logger.debug("数据库连接池已装载观测", { max: pool.options?.max ?? "default" });
	logger.debug("数据库连接池观测已安装");
}
