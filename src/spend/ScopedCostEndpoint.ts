/**
 * 虚拟密钥的只读成本查询。
 *
 * 生产里的公司调用方（cc-server 的公司驱动器）只持有一把普通虚拟密钥，拿不到
 * `proxy_admin`，也不能要求把管理员 master key 交给它。它需要按 request_id 或时间
 * 窗口核对本次 / 本公司的真实费用，而不是读 Dashboard 的完整日志详情。
 *
 * 这里不新造账本：数据只读 `LiteLLM_SpendLogs`，其中 `spend`、token 列、`unit_prices`
 * 与 `peak_tier` 都是请求结束时的账单事实。查询范围固定为“鉴权密钥自己”：
 * `api_key` 列存的是虚拟密钥的 token 哈希，因此同一公司的其他 key、其他公司都无法
 * 通过本接口读取。管理员要跨 key 汇总仍走既有的 `/global/spend/*` / `/team/spend/report`。
 *
 * 为什么不复用 `/spend/logs/ui`：那是 Dashboard 的详情读形状，会带 messages、
 * proxy_server_request、api_key 等排障字段，而且按 user/team 裁剪；把它当成本对账
 * 契约会把日志正文和凭证指纹暴露给调用方。为什么不只靠 `x-litellm-response-cost`：
 * 流式响应在首字节时头已经发出，费用要等流结束才算出来，头里放不进去。
 */

import { createHash } from "node:crypto";
import type { Router } from "express";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "../db/schema";
import { registerRoute } from "../core/api/registerRoute";
import { ApiError } from "../core/api/ApiError";
import { spendAggregationRepositoryFor } from "../repositories/SpendAggregationRepository";
import type { UserAPIKeyAuth } from "../types/auth";
import { hashApiKey } from "../core/utils/crypto";
import { usageDateRange } from "./UsageQuery";
import { toFiniteNumber, toIsoTimestamp, toSafeString } from "./spendManagementFormatters";

/** request_id / client_request_id 的长度上限；与日志详情批量接口保持一致。 */
const MAX_REQUEST_ID_LENGTH = 512;

/** 默认币种。CostCalculator 以美元计价，账本没有多币种字段。 */
const COST_CURRENCY = "USD";

/**
 * 读取可选字符串查询参数。
 *
 * 空串与纯空白视为未提供；数组/对象按 400 拒绝，避免 Express 的重复参数把语义
 * 变成“取第一个值”，调用方与审计都看不出实际用了哪一个。
 * @param query - Express 查询对象
 * @param name - 参数名
 * @throws {ApiError} 参数不是单个字符串时抛 400
 */
function readOptionalQueryString(query: Record<string, unknown>, name: string): string | undefined {
	const value = query[name];
	if (value === undefined) {
		return undefined;
	}
	if (typeof value !== "string") {
		throw ApiError.badRequest(`${name} must be a single string value`);
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * 校验 request_id 形态；只限制长度，不假设 UUID。
 * @param value - 原始 request_id
 * @param field - 参数名，用于错误文案
 * @throws {ApiError} 缺失或超长时抛 400
 */
function requireRequestId(value: string | undefined, field: string): string {
	if (value === undefined) {
		throw ApiError.badRequest(`${field} is required`);
	}
	if (value.length > MAX_REQUEST_ID_LENGTH) {
		throw ApiError.badRequest(`${field} is too long`);
	}
	return value;
}

/**
 * 解析「调用方自己这把 key」在 SpendLogs 里的 scope 值。
 *
 * 这里不能用 `resolveUsageScope(auth, "key")`：那个 helper 服务的是 Dashboard 的
 * 跨 key 报表，proxy_admin 不传 key 参数时按「不限 key」返回 `undefined`。本接口的
 * 范围永远是鉴权密钥自己（响应里的 `scope` 固定为 `"key"`），把 `undefined` 当成
 * 「未认证」就会把管理员角色的虚拟密钥挡在 401 上——cc-server 那把带
 * `spend_read_routes` 的 key 就属于 `default_user_id`（`proxy_admin`），登录态本身
 * 完全正常，却在处理阶段被判 Authentication required。
 *
 * master key 没有 `token`，SpendLogs 里落的是它的 SHA-256（与
 * `getAuthApiKeyForSpendLog` 的 `_protectApiKeyForDb` 一致），因此回落到对明文
 * `api_key` 取同一哈希；这也是 `resolveUsageScope` 原本的 key scope 口径。
 * @param auth - 已确认存在的鉴权上下文
 * @throws {ApiError} 鉴权上下文里既没有 token 也没有 api_key 时抛 401
 */
function callerKeyScope(auth: UserAPIKeyAuth): string {
	if (auth.token !== undefined && auth.token.length > 0) {
		return auth.token;
	}
	if (auth.api_key !== undefined && auth.api_key.length > 0) {
		return hashApiKey(auth.api_key);
	}
	throw ApiError.unauthorized("Authentication required");
}

/**
 * 读取会话标识并收敛成数据库规范键。
 *
 * 公司调用方通常只持有 Harness 的会话 UUID；同时接受已经带 `s:` 前缀的规范键，
 * 避免调用方为了拼前缀而猜数据库格式。`c:` 是 Claude Code 用户维度，不属于本接口
 * 的会话模型，直接拒绝。
 * @param value - 原始 session_id
 * @throws {ApiError} 缺失、过长或使用不支持的分组前缀时抛 400
 */
function requireSessionGroupKey(value: string | undefined): string {
	if (value === undefined) {
		throw ApiError.badRequest("session_id is required");
	}
	const trimmed = value.trim();
	if (trimmed.length === 0 || trimmed.length > 512) {
		throw ApiError.badRequest("session_id is invalid");
	}
	if (trimmed.startsWith("c:")) {
		throw ApiError.badRequest("session_id must be a session UUID, not a Claude Code user group");
	}
	return trimmed.startsWith("s:") ? trimmed : `s:${trimmed}`;
}

/**
 * 读取可选的 ISO 时间点；缺省返回 undefined。
 * @param query - Express 查询对象
 * @param name - 参数名
 * @throws {ApiError} 不是单个字符串、无法解析或超出 Date 可表示范围时抛 400
 */
function readOptionalIsoTime(query: Record<string, unknown>, name: string): Date | undefined {
	const value = readOptionalQueryString(query, name);
	if (value === undefined) {
		return undefined;
	}
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) {
		throw ApiError.badRequest(`${name} must be an ISO-8601 time`);
	}
	return parsed;
}

/**
 * 读取有界整数查询参数。
 * @param query - Express 查询对象
 * @param name - 参数名
 * @param fallback - 未提供时的默认值
 * @param max - 上限
 * @throws {ApiError} 不是 1..max 的整数时抛 400
 */
function readLimit(query: Record<string, unknown>, name: string, fallback: number, max: number): number {
	const value = readOptionalQueryString(query, name);
	if (value === undefined) {
		return fallback;
	}
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
		throw ApiError.badRequest(`${name} must be an integer between 1 and ${max}`);
	}
	return parsed;
}

/**
 * 把调用方原样提交的 x-request-id / idempotency-key 换算成 SpendLogs 里的 request_id。
 *
 * 与 `getOrCreateSpendRequestId` 的算法必须完全一致：SHA-256(authNamespace + NUL +
 * clientRequestId)，其中 authNamespace 优先虚拟密钥 token（哈希），其次明文 api_key。
 * 这是同一个请求的稳定映射，不是加密；范围由查询条件里的 api_key 哈希保证。
 * @param auth - 当前鉴权上下文
 * @param clientRequestId - 调用方请求头里的原值
 */
export function spendRequestIdForClientRequestId(auth: UserAPIKeyAuth, clientRequestId: string): string {
	const authNamespace = auth.token ?? auth.api_key ?? "anonymous";
	return createHash("sha256").update(authNamespace).update("\0").update(clientRequestId).digest("hex");
}

/**
 * 把 SpendLogs 行收敛成稳定的成本 DTO。
 *
 * 数值一律走 `toFiniteNumber`：SUM/COUNT 在 pg 驱动里可能是字符串，NaN 会直接污染
 * 调用方对账。时间统一输出带 Z 的 ISO-8601，避免无时区文本被客户端按本地时区解释。
 * @param row - 已按密钥范围过滤的行
 */
function toCostRequest(row: Record<string, unknown>): Record<string, unknown> {
	const unitPrices = row["unit_prices"];
	return {
		object: "spend.cost.request",
		currency: COST_CURRENCY,
		scope: "key",
		request_id: toSafeString(row["request_id"]),
		spend: toFiniteNumber(row["spend"]),
		total_tokens: toFiniteNumber(row["total_tokens"]),
		prompt_tokens: toFiniteNumber(row["prompt_tokens"]),
		completion_tokens: toFiniteNumber(row["completion_tokens"]),
		cache_read_input_tokens: toFiniteNumber(row["cache_read_input_tokens"]),
		cache_creation_input_tokens: toFiniteNumber(row["cache_creation_input_tokens"]),
		start_time: toIsoTimestamp(row["startTime"]),
		end_time: toIsoTimestamp(row["endTime"]),
		request_duration_ms:
			row["request_duration_ms"] === null || row["request_duration_ms"] === undefined
				? null
				: toFiniteNumber(row["request_duration_ms"]),
		call_type: toSafeString(row["call_type"]),
		model: toSafeString(row["model"]),
		model_id: toSafeString(row["model_id"]),
		model_group: toSafeString(row["model_group"]),
		custom_llm_provider: toSafeString(row["custom_llm_provider"]),
		endpoint: toSafeString(row["endpoint"]),
		status: row["status"] === null || row["status"] === undefined ? null : toSafeString(row["status"]),
		key_alias: row["key_alias"] === null || row["key_alias"] === undefined ? null : toSafeString(row["key_alias"]),
		// 单价是请求结束时冻结的事实，调用方可以据此复核“spend = 单价 × token”。
		unit_prices: unitPrices && typeof unitPrices === "object" ? unitPrices : null,
		peak_tier: row["peak_tier"] === null || row["peak_tier"] === undefined ? null : toSafeString(row["peak_tier"]),
	};
}

/**
 * 注册公司 key 的自助成本读取端点。
 * @param router - 已挂载 authMiddleware 与 spend 授权的 Router
 * @param db - Drizzle 数据库实例
 */
export function registerScopedCostEndpoints(router: Router, db: NodePgDatabase<typeof schema>): void {
	// ========== /spend/cost/request ==========
	// 单条请求是主路径：公司驱动器拿到 `x-litellm-request-id` 响应头后，用它精确回查。
	registerRoute(router, { method: "get", path: "/spend/cost/request" }, async (req) => {
		const auth = req.auth;
		if (auth === undefined) {
			throw ApiError.unauthorized("Authentication required");
		}
		const scopeKey = callerKeyScope(auth);

		const requestId = readOptionalQueryString(req.query as Record<string, unknown>, "request_id");
		const clientRequestId = readOptionalQueryString(req.query as Record<string, unknown>, "client_request_id");
		if (requestId !== undefined && clientRequestId !== undefined) {
			throw ApiError.badRequest("request_id and client_request_id are mutually exclusive");
		}
		if (requestId === undefined && clientRequestId === undefined) {
			throw ApiError.badRequest("request_id or client_request_id is required");
		}
		const effectiveRequestId =
			requestId !== undefined
				? requireRequestId(requestId, "request_id")
				: spendRequestIdForClientRequestId(auth, requireRequestId(clientRequestId, "client_request_id"));

		const row = await spendAggregationRepositoryFor(db).findCostRequest(effectiveRequestId, scopeKey);
		if (row === undefined) {
			// 不存在与不属于本 key 使用同一响应，避免通过 404/403 差异探测其他公司的 request_id。
			throw ApiError.notFound("Spend log not found");
		}
		return toCostRequest(row);
	});

	// ========== /spend/cost/sessions ==========
	// 会话列表只给账单与活跃时间，不返回 metadata / messages / api_key。
	registerRoute(router, { method: "get", path: "/spend/cost/sessions" }, async (req) => {
		const auth = req.auth;
		if (auth === undefined) {
			throw ApiError.unauthorized("Authentication required");
		}
		const scopeKey = callerKeyScope(auth);
		const startDate = readOptionalQueryString(req.query as Record<string, unknown>, "start_date");
		const endDate = readOptionalQueryString(req.query as Record<string, unknown>, "end_date");
		if (startDate === undefined || endDate === undefined) {
			throw ApiError.badRequest("start_date and end_date are required");
		}
		const range = usageDateRange({ start_date: startDate, end_date: endDate });
		const limit = readLimit(req.query as Record<string, unknown>, "limit", 200, 1000);
		const rows = await spendAggregationRepositoryFor(db).listCostSessions(scopeKey, range.start, range.end, limit);
		return {
			object: "spend.cost.sessions",
			currency: COST_CURRENCY,
			scope: "key",
			start_date: range.startDay,
			end_date: range.endDay,
			sessions: rows
				.filter((row) => typeof row["session_group_key"] === "string" && row["session_group_key"].length > 2)
				.map((row) => {
					const groupKey = String(row["session_group_key"]);
					return {
						session_id: groupKey.startsWith("s:") ? groupKey.slice(2) : null,
						session_group_key: groupKey,
						requests: toFiniteNumber(row["requests"]),
						total_spend: toFiniteNumber(row["total_spend"]),
						total_tokens: toFiniteNumber(row["total_tokens"]),
						prompt_tokens: toFiniteNumber(row["prompt_tokens"]),
						completion_tokens: toFiniteNumber(row["completion_tokens"]),
						cache_read_input_tokens: toFiniteNumber(row["cache_read_input_tokens"]),
						cache_creation_input_tokens: toFiniteNumber(row["cache_creation_input_tokens"]),
						models: Array.isArray(row["models"]) ? row["models"] : [],
						first_request_at:
							row["first_request_at"] === null || row["first_request_at"] === undefined
								? null
								: toIsoTimestamp(row["first_request_at"]),
						last_request_at:
							row["last_request_at"] === null || row["last_request_at"] === undefined
								? null
								: toIsoTimestamp(row["last_request_at"]),
					};
				}),
		};
	});

	// ========== /spend/cost/session ==========
	// 单会话对账与执行历史：请求行只含白名单账单字段，正文不离开 LiteLLM。
	registerRoute(router, { method: "get", path: "/spend/cost/session" }, async (req) => {
		const auth = req.auth;
		if (auth === undefined) {
			throw ApiError.unauthorized("Authentication required");
		}
		const scopeKey = callerKeyScope(auth);
		const sessionKey = requireSessionGroupKey(readOptionalQueryString(req.query as Record<string, unknown>, "session_id"));
		const requestedStart = readOptionalIsoTime(req.query as Record<string, unknown>, "start_time");
		const requestedEnd = readOptionalIsoTime(req.query as Record<string, unknown>, "end_time");
		if ((requestedStart === undefined) !== (requestedEnd === undefined)) {
			throw ApiError.badRequest("start_time and end_time must be provided together");
		}
		const end = requestedEnd ?? new Date();
		const start = requestedStart ?? new Date(end.getTime() - 30 * 86_400_000);
		if (end.getTime() < start.getTime() || end.getTime() - start.getTime() > 366 * 86_400_000) {
			throw ApiError.badRequest("session time range must be ordered and at most 366 days");
		}
		const limit = readLimit(req.query as Record<string, unknown>, "limit", 500, 2000);
		const repo = spendAggregationRepositoryFor(db);
		const summary = await repo.summarizeCostSession(scopeKey, sessionKey, start, end);
		const requests = await repo.listCostSessionRequests(scopeKey, sessionKey, start, end, limit);
		return {
			object: "spend.cost.session",
			currency: COST_CURRENCY,
			scope: "key",
			session_id: sessionKey.slice(2),
			session_group_key: sessionKey,
			start_time: start.toISOString(),
			end_time: end.toISOString(),
			requests: toFiniteNumber(summary?.requests),
			total_spend: toFiniteNumber(summary?.total_spend),
			total_tokens: toFiniteNumber(summary?.total_tokens),
			prompt_tokens: toFiniteNumber(summary?.prompt_tokens),
			completion_tokens: toFiniteNumber(summary?.completion_tokens),
			cache_read_input_tokens: toFiniteNumber(summary?.cache_read_input_tokens),
			cache_creation_input_tokens: toFiniteNumber(summary?.cache_creation_input_tokens),
			models: Array.isArray(summary?.models) ? summary?.models : [],
			first_request_at:
				summary?.first_request_at === null || summary?.first_request_at === undefined
					? null
					: toIsoTimestamp(summary.first_request_at),
			last_request_at:
				summary?.last_request_at === null || summary?.last_request_at === undefined
					? null
					: toIsoTimestamp(summary.last_request_at),
			request_rows: requests.map((row) => toCostRequest(row)),
		};
	});

	// ========== /spend/cost/summary ==========
	// 时间窗口汇总：只返回总数与 token 合计，不返回其他 key 的逐条明细。
	registerRoute(router, { method: "get", path: "/spend/cost/summary" }, async (req) => {
		const auth = req.auth;
		if (auth === undefined) {
			throw ApiError.unauthorized("Authentication required");
		}
		const scopeKey = callerKeyScope(auth);

		const startDate = readOptionalQueryString(req.query as Record<string, unknown>, "start_date");
		const endDate = readOptionalQueryString(req.query as Record<string, unknown>, "end_date");
		if (startDate === undefined || endDate === undefined) {
			throw ApiError.badRequest("start_date and end_date are required");
		}
		const range = usageDateRange({ start_date: startDate, end_date: endDate });
		const model = readOptionalQueryString(req.query as Record<string, unknown>, "model");
		if (model !== undefined && model.length > 512) {
			throw ApiError.badRequest("model is too long");
		}

		const row = await spendAggregationRepositoryFor(db).summarizeCost(scopeKey, range.start, range.end, model);

		return {
			object: "spend.cost.summary",
			currency: COST_CURRENCY,
			scope: "key",
			start_date: range.startDay,
			end_date: range.endDay,
			model: model ?? null,
			requests: toFiniteNumber(row?.requests),
			total_spend: toFiniteNumber(row?.total_spend),
			total_tokens: toFiniteNumber(row?.total_tokens),
			prompt_tokens: toFiniteNumber(row?.prompt_tokens),
			completion_tokens: toFiniteNumber(row?.completion_tokens),
			cache_read_input_tokens: toFiniteNumber(row?.cache_read_input_tokens),
			cache_creation_input_tokens: toFiniteNumber(row?.cache_creation_input_tokens),
			first_request_at: row?.first_start === undefined ? null : toIsoTimestamp(row.first_start),
			last_request_at: row?.last_end === undefined ? null : toIsoTimestamp(row.last_end),
		};
	});
}
