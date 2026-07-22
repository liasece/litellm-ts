/**
 * 花费追踪器
 *
 * 记录每次 API 调用的费用：
 * 1. 插入 LiteLLM_SpendLogs 表
 * 2. 更新 DailySpend 相关表（User/Team/Organization/Tag/Agent）
 * 3. 在响应中注入 x-litellm-response-cost 头
 */

import { randomUUID } from "node:crypto";
import type { Request } from "express";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "../db/schema";
import { liteLLM_SpendLogs } from "../db/schema/spendLogs";
import { liteLLM_DailyUserSpend } from "../db/schema/dailyUserSpend";
import { liteLLM_DailyTeamSpend } from "../db/schema/dailyTeamSpend";
import { liteLLM_DailyOrganizationSpend } from "../db/schema/dailyOrganizationSpend";
import { liteLLM_DailyTagSpend } from "../db/schema/dailyTagSpend";
import { liteLLM_DailyAgentSpend } from "../db/schema/dailyAgentSpend";
import { liteLLM_DailyEndUserSpend } from "../db/schema/dailyEndUserSpend";
import { sql } from "drizzle-orm";
import { dbConfigProvider } from "../core/config/DbConfigProvider";
import type { SpendLog, SpendLogBuildContext, SpendLogsMetadata } from "../types/spend";
import { CallType, SpendLogStatus } from "../types/spend";
import type { ModelResponse, ModelResponseStream, Usage } from "../types/openai";
import { costPerToken } from "../cost/CostCalculator";
import { createModuleLogger } from "../core/utils/logger";
import { hashApiKey } from "../core/utils/crypto";
import { getConfig } from "../core/config";

const logger = createModuleLogger("SpendTracker");

// ========== Master Key 保护 ==========

/**
 * GAP: PY `disable_adding_master_key_hash_to_db` — 进程级配置。
 * 持有 master key（明文）+ disable flag；写入 SpendLogs.api_key 前会检查：
 *   - 如果请求 api_key 等于 master key 明文 → 默认转写哈希；
 *     当 disable=true 时跳过写入（返回 null）。
 *   - 普通 api_key 不受影响（继续写入原值——通常调用方已传入哈希形式）。
 *
 * 用法：服务启动时调用 `configureMasterKeyProtection(masterKey, disable)`。
 */
let _masterKeyPlaintext: string | undefined;
let _disableAddingMasterKeyHashToDb = false;

/**
 * 配置 master key 保护策略。仅在服务启动时调用一次。
 * @param masterKey - master key 明文（可选；未配置时不做特殊处理）
 * @param disableAddingHash - 是否禁止把 master key 哈希写入 DB
 */
export function configureMasterKeyProtection(masterKey: string | undefined, disableAddingHash: boolean): void {
	_masterKeyPlaintext = masterKey;
	_disableAddingMasterKeyHashToDb = disableAddingHash;
}

/**
 * GAP 9: PY `disable_adding_master_key_hash_to_db=True` 时把 api_key 改为
 * `"litellm_proxy_master_key"` 别名而非 null（spend_tracking_utils.py:55-69），
 * 这样下游 SQL 查询（如 SELECT * WHERE api_key='litellm_proxy_master_key'）
 * 仍能识别 master key 行；之前 TS 用 null 写入 "" 会让 SQL 行为不一致。
 */
const MASTER_KEY_ALIAS = "litellm_proxy_master_key";

/**
 * 根据保护策略转换 api_key 字段值用于 DB 写入。
 * @param rawApiKey - SpendLog.api_key 原始值
 * @returns 应写入 DB 的值：原值 / 哈希 / master key 别名（"litellm_proxy_master_key"）
 */
function _protectApiKeyForDb(rawApiKey: string): string {
	let configMasterKey: string | undefined;
	let configDisableAddingMasterKeyHashToDb = false;
	try {
		const config = getConfig();
		configMasterKey = config.generalSettings.master_key;
		configDisableAddingMasterKeyHashToDb = config.generalSettings.disable_adding_master_key_hash_to_db === true;
	} catch {
		configMasterKey = process.env.LITELLM_MASTER_KEY;
	}
	const masterKeyPlaintext = _masterKeyPlaintext ?? configMasterKey;
	const disableAddingMasterKeyHashToDb = _disableAddingMasterKeyHashToDb || configDisableAddingMasterKeyHashToDb;
	if (masterKeyPlaintext && rawApiKey === masterKeyPlaintext) {
		if (disableAddingMasterKeyHashToDb) {
			// GAP 9: PY 用 `MASTER_KEY_ALIAS` 字符串别名（"litellm_proxy_master_key"）
			// 代替 null，让下游 SQL 查询行为一致（spend_tracking_utils.py:55-69）。
			return MASTER_KEY_ALIAS;
		}
		// 默认写入哈希而非明文（避免明文 master key 入库）
		return hashApiKey(rawApiKey);
	}
	if (rawApiKey.startsWith("sk-")) {
		return hashApiKey(rawApiKey);
	}
	return rawApiKey;
}

// ========== 辅助函数 ==========

/**
 * 从请求开始时间提取 UTC 日期（YYYY-MM-DD）。
 * @param startTime
 */
function getDailySpendDate(startTime: string): string {
	return new Date(startTime).toISOString().slice(0, 10);
}

/**
 * 从 SpendLog 的代理请求 URL 提取不含查询参数的端点。
 * @param log
 */
function getDailySpendEndpoint(log: SpendLog): string | null {
	const requestUrl = log.proxy_server_request?.["url"];
	if (typeof requestUrl !== "string" || requestUrl.length === 0) {
		return null;
	}
	return requestUrl.split("?", 1)[0] ?? null;
}

/**
 * 尝试从 model 字段中提取 provider 前缀
 * 如 "deepseek/deepseek-v4-flash/xxx" → "deepseek"
 * @param model
 */
function extractProvider(model: string): string {
	const parts = model.split("/");
	if (parts.length >= 2) {
		return parts[0]!;
	}
	return "";
}

/**
 * 更新一条每日花费汇总记录（upsert）
 * 使用 ON CONFLICT 实现 upsert 语义
 * @param db
 * @param table
 * @param keyColumn
 * @param keyValue
 * @param log
 * @param spend
 */
async function upsertDailySpend(
	db: NodePgDatabase<typeof schema>,
	table: ReturnType<typeof getDailyTable>,
	keyColumn: ReturnType<typeof getKeyColumn>,
	keyValue: string | null,
	log: SpendLog,
	spend: number,
): Promise<void> {
	if (keyValue === null || keyValue === undefined) {
		return;
	}

	const model = log.model || "";
	const successfulRequests = (log.status ?? SpendLogStatus.Success) === SpendLogStatus.Success ? 1 : 0;
	const failedRequests = successfulRequests === 1 ? 0 : 1;
	const updatedAt = new Date();
	const values: Record<string, unknown> = {
		id: randomUUID(),
		[keyColumn]: keyValue,
		date: getDailySpendDate(log.startTime),
		api_key: _protectApiKeyForDb(log.api_key),
		model: model,
		model_group: log.model_group ?? null,
		custom_llm_provider: log.custom_llm_provider ?? extractProvider(model),
		mcp_namespaced_tool_name: log.mcp_namespaced_tool_name ?? "",
		endpoint: getDailySpendEndpoint(log) ?? "",
		prompt_tokens: log.prompt_tokens,
		completion_tokens: log.completion_tokens,
		cache_read_input_tokens: log.cache_read_input_tokens ?? 0,
		cache_creation_input_tokens: log.cache_creation_input_tokens ?? 0,
		spend: spend,
		api_requests: 1,
		successful_requests: successfulRequests,
		failed_requests: failedRequests,
		updated_at: updatedAt,
	};
	if (keyColumn === "tag") {
		values["request_id"] = log.request_id;
	}

	await db
		.insert(table)
		.values(values)
		.onConflictDoUpdate({
			// GAP (DB-001): drizzle uniqueIndex 不暴露 `.unq` 属性在 table 对象上。
			// 显式构造 conflict target 列组合（对齐 PY schema.db.spend.py 的 unique constraint）。
			// 对齐 Python unique constraints：
			//   DailyUserSpend/Team/Organization/Tag/Agent: (key_id, date, api_key, model, custom_llm_provider, mcp, endpoint)
			//   DailyEndUserSpend: (end_user_id, date, api_key, model, custom_llm_provider, mcp, endpoint)
			target: [
				table[keyColumn as keyof typeof table] as never,
				table.date,
				table.api_key,
				table.model,
				table.custom_llm_provider,
				table.mcp_namespaced_tool_name,
				table.endpoint,
			] as never,
			set: {
				prompt_tokens: sql`${table.prompt_tokens} + ${log.prompt_tokens}`,
				completion_tokens: sql`${table.completion_tokens} + ${log.completion_tokens}`,
				cache_read_input_tokens: sql`${table.cache_read_input_tokens} + ${log.cache_read_input_tokens ?? 0}`,
				cache_creation_input_tokens: sql`${table.cache_creation_input_tokens} + ${log.cache_creation_input_tokens ?? 0}`,
				spend: sql`${table.spend} + ${spend}`,
				api_requests: sql`${table.api_requests} + 1`,
				successful_requests: sql`${table.successful_requests} + ${successfulRequests}`,
				failed_requests: sql`${table.failed_requests} + ${failedRequests}`,
				updated_at: updatedAt,
			},
		});
}

/**
 * 获取对应维度的每日花费表
 * @param dimension
 * @throws {Error} 当维度不合法时
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getDailyTable(dimension: string): any {
	switch (dimension) {
		case "user":
			return liteLLM_DailyUserSpend;
		case "team":
			return liteLLM_DailyTeamSpend;
		case "organization":
			return liteLLM_DailyOrganizationSpend;
		case "tag":
			return liteLLM_DailyTagSpend;
		case "agent":
			return liteLLM_DailyAgentSpend;
		case "end_user":
			return liteLLM_DailyEndUserSpend;
		default:
			throw new Error(`未知的每日花费维度: ${dimension}`);
	}
}

/**
 * 获取对应维度的键列名
 * @param dimension
 * @throws {Error} 当维度不合法时
 */
export function getKeyColumn(dimension: string): string {
	switch (dimension) {
		case "user":
			return "user_id";
		case "team":
			return "team_id";
		case "organization":
			return "organization_id";
		case "tag":
			return "tag";
		case "agent":
			return "agent_id";
		case "end_user":
			return "end_user_id";
		default:
			throw new Error(`未知的键列维度: ${dimension}`);
	}
}

/**
 * 超长字符串截断阈值（对齐 PY _get_max_string_length_prompt_in_db：
 * MAX_STRING_LENGTH_PROMPT_IN_DB env，缺省 32768）。
 */
const MAX_STRING_LENGTH_PROMPT_IN_DB = Number(process.env.MAX_STRING_LENGTH_PROMPT_IN_DB ?? 32768) || 32768;

/** PY LITELLM_TRUNCATION_DB_SAFEGUARD_NOTE 原文（litellm/constants.py:1246） */
const TRUNCATION_DB_SAFEGUARD_NOTE =
	"Truncation is a DB storage safeguard. " +
	"Full, untruncated data is logged to logging callbacks (OTEL, Datadog, etc.). " +
	"To increase the truncation limit, set `MAX_STRING_LENGTH_PROMPT_IN_DB` in your env.";

/** 需脱敏的请求头（明文凭证不入库）；仅作用于 proxy_server_request.headers 层 */
const SENSITIVE_HEADER_NAMES: ReadonlySet<string> = new Set([
	"authorization",
	"proxy-authorization",
	"x-api-key",
	"api-key",
	"x-litellm-api-key",
	"cookie",
	"set-cookie",
]);

/**
 * 判断字符串是否包含明文 LiteLLM/OpenAI 风格 API key。
 * @param value - 待检查字符串
 */
function containsPlaintextApiKey(value: string): boolean {
	return /(^|\s|["'])Bearer\s+sk-[^\s"']+/.test(value) || /(^|\s|["'])sk-[A-Za-z0-9_-]+/.test(value);
}

/**
 * 递归清理 SpendLogs JSON 负载（对齐 PY _sanitize_request_body_for_spend_logs_payload）：
 * - 不做字段名黑名单（PY 无此逻辑——user_api_key_alias/total_tokens 等标识与数值字段均明文保留）
 * - 明文 API key 检测脱敏（安全兜底，仅命中真含 sk- 明文的字符串值）
 * - 超长字符串截断：头 35% 尾 65% 保留（PY 同款，尾部通常是更重要的上下文）
 * @param value - 待写入 SpendLogs 的任意 JSON 值
 */
export function sanitizeSpendLogPayload(value: unknown): unknown {
	if (value === null || value === undefined) {
		return value;
	}
	if (typeof value === "string") {
		if (containsPlaintextApiKey(value)) {
			return "[REDACTED]";
		}
		if (value.length > MAX_STRING_LENGTH_PROMPT_IN_DB) {
			const startChars = Math.floor(MAX_STRING_LENGTH_PROMPT_IN_DB * 0.35);
			const endChars = MAX_STRING_LENGTH_PROMPT_IN_DB - startChars;
			const skippedChars = value.length - startChars - endChars;
			return `${value.slice(0, startChars)}... (litellm_truncated skipped ${skippedChars} chars. ${TRUNCATION_DB_SAFEGUARD_NOTE}) ...${value.slice(value.length - endChars)}`;
		}
		return value;
	}
	if (Array.isArray(value)) {
		return value.map((arrayValue) => sanitizeSpendLogPayload(arrayValue));
	}
	if (typeof value === "object") {
		const sourceRecord = value as Record<string, unknown>;
		const sanitizedRecord: Record<string, unknown> = {};
		for (const [fieldName, fieldValue] of Object.entries(sourceRecord)) {
			sanitizedRecord[fieldName] = sanitizeSpendLogPayload(fieldValue);
		}
		return sanitizedRecord;
	}
	return value;
}

/**
 * 清理 proxy_server_request.headers：敏感请求头值脱敏，其余透传。
 * @param headers - Express req.headers
 */
export function sanitizeSpendLogHeaders(headers: Record<string, unknown>): Record<string, unknown> {
	const sanitized: Record<string, unknown> = {};
	for (const [headerName, headerValue] of Object.entries(headers)) {
		sanitized[headerName] = SENSITIVE_HEADER_NAMES.has(headerName.toLowerCase()) ? "[REDACTED]" : sanitizeSpendLogPayload(headerValue);
	}
	return sanitized;
}

/**
 * Python 默认关闭 prompt/response/body 存储，仅显式配置或环境变量开启。
 * 配置优先级（对齐 PY spend_tracking_utils._should_store_prompts_and_responses_in_spend_logs）：
 * DB general_settings（LiteLLM_Config 表，WebUI 设置项）> yaml general_settings > env。
 */
export function shouldStorePromptsAndResponsesInSpendLogs(): boolean {
	if (process.env.STORE_PROMPTS_IN_SPEND_LOGS === "true") {
		return true;
	}
	try {
		const dbGeneral = dbConfigProvider.getParam("general_settings");
		if ("store_prompts_in_spend_logs" in dbGeneral) {
			return dbGeneral["store_prompts_in_spend_logs"] === true || dbGeneral["store_prompts_in_spend_logs"] === "true";
		}
		return getConfig().generalSettings.store_prompts_in_spend_logs === true;
	} catch {
		return false;
	}
}

/**
 * 从请求中提取 requester IP，优先代理转发头。
 * @param req - Express 请求对象
 */
export function getRequesterIpAddress(req: Request): string | undefined {
	const forwardedFor = req.headers["x-forwarded-for"];
	if (typeof forwardedFor === "string" && forwardedFor.length > 0) {
		return forwardedFor.split(",")[0]?.trim();
	}
	const realIp = req.headers["x-real-ip"];
	if (typeof realIp === "string" && realIp.length > 0) {
		return realIp;
	}
	return req.ip ?? req.socket.remoteAddress;
}

/**
 * 失败日志写入 metadata.error_information 的稳定形状。
 * @param error - 捕获到的请求错误
 */
export function getFailureErrorInformation(error: unknown): Record<string, unknown> {
	if (error instanceof Error) {
		const statusCode = (error as { statusCode?: unknown; status?: unknown }).statusCode ?? (error as { status?: unknown }).status;
		return {
			error_message: error.message,
			error_type: error.name,
			error_code: typeof statusCode === "number" || typeof statusCode === "string" ? statusCode : undefined,
		};
	}
	return {
		error_message: String(error),
		error_type: "Error",
	};
}

/**
 * session_id 对齐 Python：trace_id > litellm_trace_id > UUID。
 * @param ctx - SpendLog 构建上下文
 */
export function getSessionIdForSpendLog(ctx: SpendLogBuildContext): string {
	const requestBody = ctx.req.body as Record<string, unknown> | undefined;
	const metadata = requestBody?.metadata as Record<string, unknown> | undefined;
	const traceId = metadata?.trace_id ?? requestBody?.trace_id;
	if (typeof traceId === "string" && traceId.length > 0) {
		return traceId;
	}
	const litellmTraceId = metadata?.litellm_trace_id ?? requestBody?.litellm_trace_id;
	if (typeof litellmTraceId === "string" && litellmTraceId.length > 0) {
		return litellmTraceId;
	}
	return randomUUID();
}

/**
 * 构建 Python proxy_server_request JSON 形状。
 * @param ctx - SpendLog 构建上下文
 */
export function buildProxyServerRequest(ctx: SpendLogBuildContext): Record<string, unknown> {
	const shouldStoreBody = shouldStorePromptsAndResponsesInSpendLogs();
	const requestShape: Record<string, unknown> = {
		url: ctx.req.originalUrl ?? ctx.req.url,
		method: ctx.req.method,
		headers: sanitizeSpendLogHeaders(ctx.req.headers as Record<string, unknown>),
		body: shouldStoreBody ? sanitizeSpendLogPayload(ctx.req.body) : {},
		arrival_time: ctx.startTime.toISOString(),
	};
	return requestShape;
}

function getAuthApiKeyForSpendLog(ctx: SpendLogBuildContext): string {
	const authToken = ctx.auth?.token;
	if (authToken && authToken.length > 0) {
		return authToken;
	}
	return _protectApiKeyForDb(ctx.auth?.api_key ?? "");
}

/**
 * PY special_usage_fields（spend_tracking_utils.py:397）：这三个 token 字段已落于
 * SpendLogs 顶层列，additional_usage_values 只保留 usage 的其余扩展字段。
 */
const SPECIAL_USAGE_FIELDS: ReadonlySet<string> = new Set(["completion_tokens", "prompt_tokens", "total_tokens"]);

/**
 * 构建 metadata.additional_usage_values：usage 脱敏副本剔除
 * prompt_tokens / completion_tokens / total_tokens（对齐 PY spend_tracking_utils.py:398-404）。
 * @param usage - 原始 usage 对象
 */
export function buildAdditionalUsageValues(usage: Record<string, unknown>): Record<string, unknown> {
	const sanitizedUsage = sanitizeSpendLogPayload(usage) as Record<string, unknown>;
	const additionalValues: Record<string, unknown> = {};
	for (const [fieldName, fieldValue] of Object.entries(sanitizedUsage)) {
		if (!SPECIAL_USAGE_FIELDS.has(fieldName)) {
			additionalValues[fieldName] = fieldValue;
		}
	}
	return additionalValues;
}

/**
 * Bedrock provider 字面量（PY reconstruct_model_name 只对 bedrock 补前缀，
 * litellm/litellm_core_utils/core_helpers.py:206-209）。
 */
const BEDROCK_PROVIDER_NAME = "bedrock";

/**
 * 重建 SpendLogs.model 列的完整模型名（对齐 PY reconstruct_model_name）：
 * - 实际执行 deployment 的 litellm_params.model 含 "/" → 用它（保留原始 provider 前缀）
 * - 否则 bedrock provider 且 model 无前缀 → 补 "bedrock/" 前缀
 * - 其余原样返回请求 model
 * @param model - 客户端请求的逻辑模型名
 * @param customLlmProvider - 实际执行 deployment 的 provider
 * @param deploymentModel - 实际执行 deployment 的 litellm_params.model
 */
export function reconstructModelName(model: string, customLlmProvider: string | undefined, deploymentModel: string | undefined): string {
	if (deploymentModel && deploymentModel.includes("/")) {
		return deploymentModel;
	}
	if (customLlmProvider === BEDROCK_PROVIDER_NAME && model.length > 0 && !model.includes("/")) {
		return `${customLlmProvider}/${model}`;
	}
	return model;
}

/**
 * 构建 Python SpendLogs metadata JSON。
 * @param ctx - SpendLog 构建上下文
 */
export function buildSpendLogsMetadata(ctx: SpendLogBuildContext): SpendLogsMetadata {
	const auth = ctx.auth;
	const requestBody = ctx.req.body as Record<string, unknown> | undefined;
	const requestMetadata = requestBody?.metadata;
	const usageObject = ctx.usage;
	const failureInformation = ctx.error ? getFailureErrorInformation(ctx.error) : undefined;
	const requesterIpAddress = getRequesterIpAddress(ctx.req);
	return {
		user_api_key: getAuthApiKeyForSpendLog(ctx),
		user_api_key_alias: auth?.key_alias,
		user_api_key_team_id: auth?.team_id,
		user_api_key_team_alias: auth?.team_alias ?? null,
		user_api_key_org_id: auth?.organization_id,
		user_api_key_user_id: auth?.user_id,
		// PY SpendLogsMetadata 键集对齐：项目/guardrail/MCP/vector-store/batch 子系统
		// 未实现，键就位值恒 null（PY 同样以 None 落键）
		user_api_key_project_id: null,
		user_api_key_project_alias: null,
		spend_logs_metadata:
			typeof requestMetadata === "object" && requestMetadata !== null
				? (sanitizeSpendLogPayload(requestMetadata) as Record<string, unknown>)
				: undefined,
		requester_ip_address: requesterIpAddress,
		additional_usage_values: usageObject ? buildAdditionalUsageValues(usageObject) : undefined,
		applied_guardrails: null,
		mcp_tool_call_metadata: null,
		guardrail_information: null,
		vector_store_request_metadata: null,
		batch_models: null,
		cold_storage_object_key: null,
		// PY StandardLoggingModelInformation：model_map_key=路由模型组，model_map_value=deployment ModelInfo
		model_map_information: {
			model_map_key: ctx.modelGroup ?? ctx.model,
			model_map_value: ctx.modelId ? { id: ctx.modelId } : null,
		},
		litellm_overhead_time_ms: ctx.litellmOverheadTimeMs ?? null,
		attempted_retries: ctx.attemptedRetries ?? null,
		max_retries: ctx.maxRetries ?? null,
		// cost_breakdown 由 trackSpendLog 算完 cost 后注入（构建时 cost 尚未计算）
		cost_breakdown: null,
		status: ctx.status ?? (ctx.error ? SpendLogStatus.Failure : SpendLogStatus.Success),
		// PY spend_tracking_utils._get_spend_logs_metadata: proxy_server_request=None——
		// 完整 proxy_server_request（含大 body）仅存顶层列，不重复嵌入 metadata
		// （列表端点 metadata 全量返回，嵌入会让单行达数 MB）
		proxy_server_request: null,
		error_information: failureInformation,
		usage_object: usageObject ? (sanitizeSpendLogPayload(usageObject) as Record<string, unknown>) : undefined,
	};
}

/**
 * 用单一入口从请求上下文构造 SpendLog，减少端点手写字段漂移。
 * @param ctx - SpendLog 构建上下文
 */
export function buildSpendLogFromRequest(ctx: SpendLogBuildContext): SpendLog {
	const usage = normalizeUsageForSpend(ctx.usage);
	const status = ctx.status ?? (ctx.error ? SpendLogStatus.Failure : SpendLogStatus.Success);
	const shouldStoreBody = shouldStorePromptsAndResponsesInSpendLogs();
	const metadata = buildSpendLogsMetadata(ctx);
	const requestDurationMs = Math.max(0, ctx.endTime.getTime() - ctx.startTime.getTime());
	return {
		request_id: ctx.requestId ?? randomUUID(),
		call_type: ctx.callType,
		api_key: getAuthApiKeyForSpendLog(ctx),
		spend: 0,
		total_tokens: usage?.total_tokens ?? 0,
		prompt_tokens: usage?.prompt_tokens ?? 0,
		completion_tokens: usage?.completion_tokens ?? 0,
		startTime: ctx.startTime.toISOString(),
		endTime: ctx.endTime.toISOString(),
		completionStartTime: (ctx.completionStartTime ?? ctx.endTime).toISOString(),
		// PY reconstruct_model_name：model 列记实际执行 deployment 的完整模型名
		// （含 provider 前缀），无 deployment 信息时回退请求 model
		model: reconstructModelName(ctx.model, ctx.customLlmProvider, ctx.deploymentModel),
		model_group: ctx.modelGroup,
		model_id: ctx.modelId,
		custom_llm_provider: ctx.customLlmProvider,
		api_base: ctx.apiBase,
		user: ctx.auth?.user_id,
		team_id: ctx.auth?.team_id,
		key_alias: ctx.auth?.key_alias,
		// A4: TS 无响应缓存子系统，cache_key/cache_hit 管道就位（恒 null/false）
		cache_key: ctx.cacheKey,
		cache_hit: ctx.cacheHit ?? false,
		metadata: metadata as unknown as Record<string, unknown>,
		requester_ip_address: metadata.requester_ip_address,
		messages: shouldStoreBody ? sanitizeSpendLogPayload(ctx.messages) : {},
		response: shouldStoreBody ? sanitizeSpendLogPayload(ctx.response) : {},
		// 顶层列存完整 proxy_server_request（含 body）；metadata 内恒 null（对齐 Python），
		// 详情端点 /spend/logs/ui/:request_id 从本列读取。
		proxy_server_request: buildProxyServerRequest(ctx),
		session_id: getSessionIdForSpendLog(ctx),
		request_duration_ms: requestDurationMs,
		status: status,
		organization_id: ctx.auth?.organization_id,
		tags: ctx.requestTags,
		request_tags: ctx.requestTags,
		end_user_id: ctx.auth?.end_user_id,
		cache_creation_input_tokens: usage?.cache_creation_input_tokens,
		cache_read_input_tokens: usage?.cache_read_input_tokens,
		usage: ctx.usage,
		model_cost_map: ctx.modelCostMap,
		custom_cost_per_token: ctx.customCostPerToken,
		error_information: metadata.error_information,
	};
}

// ========== 公开 API ==========

/**
 * GAP: PY `_transform_response_api_usage_to_chat_usage` (cost_calculator.py:1147-1196)
 * 把 Anthropic/Responses API 的 `input_tokens` / `output_tokens` 字段统一转换到
 * Chat completions 的 `prompt_tokens` / `completion_tokens` 视图，并兜底 cache 字段。
 * TS 之前两端点各自转换 — 现集中到本入口，trackSpendLog / calculateAndSetCost 调用时统一。
 *
 * 接受任意 usage 形状（`prompt_tokens|input_tokens|completion_tokens|output_tokens|
 *   cache_creation_input_tokens|cache_read_input_tokens|prompt_tokens_details`）并返回
 * 归一后的字段。返回 undefined 表示无可识别字段（避免误报 0 spend）。
 * @param usage
 */
export function normalizeUsageForSpend(usage: Record<string, unknown> | undefined):
	| {
			prompt_tokens: number;
			completion_tokens: number;
			total_tokens: number;
			cache_creation_input_tokens: number;
			cache_read_input_tokens: number;
	  }
	| undefined {
	if (!usage) {
		return undefined;
	}
	// cache fields: prompt_tokens_details.cached_tokens > cache_read_input_tokens
	const promptDetails = usage["prompt_tokens_details"] as Record<string, unknown> | undefined;
	const cacheRead =
		(typeof promptDetails?.["cached_tokens"] === "number" ? (promptDetails["cached_tokens"] as number) : undefined) ??
		(typeof usage["cache_read_input_tokens"] === "number" ? (usage["cache_read_input_tokens"] as number) : 0);
	const cacheCreation =
		(typeof promptDetails?.["cache_creation_tokens"] === "number" ? (promptDetails["cache_creation_tokens"] as number) : undefined) ??
		(typeof usage["cache_creation_input_tokens"] === "number" ? (usage["cache_creation_input_tokens"] as number) : 0);
	// PY: prefer `completion_tokens`; fall back to `output_tokens`
	const completionTokens =
		(typeof usage["completion_tokens"] === "number" ? (usage["completion_tokens"] as number) : undefined) ??
		(typeof usage["output_tokens"] === "number" ? (usage["output_tokens"] as number) : 0);

	// Anthropic/Responses 风格判定：无 prompt_tokens 且有 input_tokens。
	// PY anthropic/chat/transformation.py:1588-1611 把 cache_creation + cache_read
	// 折叠计入 prompt_tokens（上游 input_tokens 不含 cache），total=prompt+completion。
	// OpenAI 风格 prompt_tokens 已含 cached_tokens（prompt_tokens_details 仅细分），不动。
	const rawPromptTokens = typeof usage["prompt_tokens"] === "number" ? (usage["prompt_tokens"] as number) : undefined;
	const isAnthropicStyle = rawPromptTokens === undefined && typeof usage["input_tokens"] === "number";
	if (isAnthropicStyle) {
		const promptTokens = ((usage["input_tokens"] as number) ?? 0) + cacheRead + cacheCreation;
		return {
			prompt_tokens: promptTokens,

			completion_tokens: completionTokens,

			total_tokens: promptTokens + completionTokens,

			cache_creation_input_tokens: cacheCreation,

			cache_read_input_tokens: cacheRead,
		};
	}
	const promptTokens = rawPromptTokens ?? 0;
	const totalTokens =
		(typeof usage["total_tokens"] === "number" ? (usage["total_tokens"] as number) : undefined) ?? promptTokens + completionTokens;

	return {
		prompt_tokens: promptTokens,

		completion_tokens: completionTokens,

		total_tokens: totalTokens,

		cache_creation_input_tokens: cacheCreation,

		cache_read_input_tokens: cacheRead,
	};
}

/**
 * 记录一条花费日志
 *
 * 写入 LiteLLM_SpendLogs 表并更新所有相关 DailySpend 表。
 * GAP: 在入口对 SpendLog 进行 usage 归一（prompt_tokens/input_tokens 等），
 * 集中处理 Anthropic vs Chat completions usage 字段差异，避免端点散落转换。
 * Python StandardLoggingPayload 是中间结构，用于派生 metadata、messages、response、
 * proxy_server_request、token/cost/session/status 等 SpendLogs 列，不作为 DB 列持久化。
 * @param db - Drizzle 数据库实例
 * @param logEntry - 花费日志条目
 */
export async function trackSpendLog(db: NodePgDatabase<typeof schema>, logEntry: SpendLog): Promise<void> {
	// GAP: 入口统一 usage 归一，对齐 PY _transform_response_api_usage_to_chat_usage
	const normalized = normalizeUsageForSpend({
		prompt_tokens: logEntry.prompt_tokens,

		completion_tokens: logEntry.completion_tokens,

		total_tokens: logEntry.total_tokens,

		cache_creation_input_tokens: logEntry.cache_creation_input_tokens,

		cache_read_input_tokens: logEntry.cache_read_input_tokens,
	});
	const promptTokens = normalized?.prompt_tokens ?? logEntry.prompt_tokens;
	const completionTokens = normalized?.completion_tokens ?? logEntry.completion_tokens;
	const totalTokens = normalized?.total_tokens ?? logEntry.total_tokens;
	const cacheCreationTokens = normalized?.cache_creation_input_tokens ?? logEntry.cache_creation_input_tokens ?? 0;
	const cacheReadTokens = normalized?.cache_read_input_tokens ?? logEntry.cache_read_input_tokens ?? 0;

	// GAP (COST-001): costPerToken 现在对未知模型返回 0,0,0 静默（对齐 PY）。
	// 不再 try/catch：spend 默认为 0，未知模型日志会由 costPerToken 内部 logger.warn 留痕。
	// DIFF-COST-01/02: 透传 model_cost_map 让 costPerToken 在 service_tier=flex/priority
	// 时联动 model_cost_map[model]?.input_cost_per_token_${tier} 字段。
	const modelCostMapEntry = logEntry.model_cost_map;
	// DIFF-003: 从 SpendLog.usage 透传 reasoning_tokens（如果存在）到 costPerToken。
	// 对齐 PY cost_calculator.py:2093-2098 — completion_tokens -= reasoning_tokens。
	const usageRecord = logEntry.usage;
	const completionDetails =
		(usageRecord?.["completion_tokens_details"] as Record<string, unknown> | undefined) ??
		logEntry.completion_tokens_details ??
		undefined;
	const reasoningTokens =
		typeof completionDetails?.["reasoning_tokens"] === "number" ? (completionDetails["reasoning_tokens"] as number) : 0;
	const {
		inputCost,
		outputCost,
		totalCost: spend,
	} = costPerToken(logEntry.model, promptTokens, completionTokens, cacheCreationTokens, cacheReadTokens, {
		// 批次 9: 实际执行 deployment 的 model_info/litellm_params 自定义价格优先于内置价格表
		customCostPerToken: logEntry.custom_cost_per_token,
		modelCostMap: modelCostMapEntry as never,
		reasoningTokens: reasoningTokens,
	});
	const requestStartTime = new Date(logEntry.startTime);
	const requestEndTime = new Date(logEntry.endTime);
	const requestDurationMs = logEntry.request_duration_ms ?? Math.max(0, requestEndTime.getTime() - requestStartTime.getTime());
	const protectedApiKey = _protectApiKeyForDb(logEntry.api_key || "");
	const sanitizedProxyServerRequest = sanitizeSpendLogPayload(logEntry.proxy_server_request ?? {}) as Record<string, unknown>;
	const sourceMetadata = logEntry.metadata ?? {};
	const sanitizedMetadata = sanitizeSpendLogPayload(sourceMetadata) as Record<string, unknown>;
	const sourceUserApiKey = sourceMetadata["user_api_key"];
	if (typeof sourceUserApiKey === "string") {
		sanitizedMetadata["user_api_key"] = _protectApiKeyForDb(sourceUserApiKey);
	}
	// PY CostBreakdown（types/utils.py:2771）：cost 计算完成后注入 metadata.cost_breakdown；
	// tool_usage_cost 无内置工具计费子系统，恒 0
	sanitizedMetadata["cost_breakdown"] = {
		input_cost: inputCost,
		output_cost: outputCost,
		total_cost: spend,
		tool_usage_cost: 0,
	};

	const insertData: typeof liteLLM_SpendLogs.$inferInsert = {
		request_id: logEntry.request_id,
		call_type: logEntry.call_type || CallType.ACompletion,
		// GAP 9: master key 保护 — 直接明文 master key 转哈希，或在 disable_adding=true 时
		// 写 `"litellm_proxy_master_key"` 别名（对齐 PY spend_tracking_utils.py:55-69）。
		api_key: protectedApiKey,
		spend: spend,
		total_tokens: totalTokens,
		prompt_tokens: promptTokens,
		completion_tokens: completionTokens,
		startTime: requestStartTime,
		endTime: requestEndTime,
		completionStartTime: logEntry.completionStartTime ? new Date(logEntry.completionStartTime) : requestEndTime,
		model: logEntry.model || "",
		model_group: logEntry.model_group || "",
		model_id: logEntry.model_id ?? null,
		custom_llm_provider: logEntry.custom_llm_provider ?? extractProvider(logEntry.model),
		api_base: logEntry.api_base ?? null,
		user: logEntry.user || "",
		team_id: logEntry.team_id ?? null,
		organization_id: logEntry.organization_id ?? null,

		end_user: logEntry.end_user_id ?? null,

		cache_key: logEntry.cache_key ?? null,

		// PY SpendLogsPayload.cache_hit = str(cache_hit)（spend_tracking_utils.py:432）——
		// Python str(bool) 首字母大写，写 "True"/"False"
		cache_hit: logEntry.cache_hit ? "True" : "False",
		requester_ip_address: logEntry.requester_ip_address ?? null,
		proxy_server_request: sanitizedProxyServerRequest,
		metadata: sanitizedMetadata,
		response: logEntry.response ?? {},
		messages: logEntry.messages ?? {},

		session_id: logEntry.session_id ?? randomUUID(),
		request_duration_ms: requestDurationMs,
		status: logEntry.status ?? SpendLogStatus.Success,
		request_tags: (logEntry.request_tags ?? logEntry.tags ?? []) as unknown as Record<string, unknown>[],

		agent_id: logEntry.agent_id ?? null,
		mcp_namespaced_tool_name: logEntry.mcp_namespaced_tool_name ?? null,
	};

	await db.insert(liteLLM_SpendLogs).values(insertData);

	// GAP: 使用归一后的字段更新每日汇总，避免 daily 表 prompt_tokens 与 SpendLogs 不一致
	const normalizedLog: SpendLog = {
		...logEntry,

		prompt_tokens: promptTokens,

		completion_tokens: completionTokens,

		total_tokens: totalTokens,

		cache_creation_input_tokens: cacheCreationTokens,

		cache_read_input_tokens: cacheReadTokens,
	};

	// 更新各维度每日汇总（PY: also updates end_user dimension, db_spend_update_writer.py:1470）
	const dailyDimensions = ["user", "team", "organization", "tag", "agent", "end_user"] as const;
	const dailyResults = await Promise.allSettled([
		upsertDailySpend(db, liteLLM_DailyUserSpend, "user_id", logEntry.user ?? null, normalizedLog, spend),
		upsertDailySpend(db, liteLLM_DailyTeamSpend, "team_id", logEntry.team_id ?? null, normalizedLog, spend),
		upsertDailySpend(db, liteLLM_DailyOrganizationSpend, "organization_id", logEntry.organization_id ?? null, normalizedLog, spend),
		upsertDailySpend(db, liteLLM_DailyTagSpend, "tag", logEntry.tags?.[0] ?? null, normalizedLog, spend),
		upsertDailySpend(db, liteLLM_DailyAgentSpend, "agent_id", logEntry.agent_id ?? null, normalizedLog, spend),
		upsertDailySpend(db, liteLLM_DailyEndUserSpend, "end_user_id", logEntry.end_user_id ?? null, normalizedLog, spend),
	]);
	for (const [index, result] of dailyResults.entries()) {
		if (result.status === "rejected") {
			logger.error(`DailySpend 聚合写入失败: dimension=${dailyDimensions[index]}`, { error: result.reason });
		}
	}

	logger.debug(`花费已记录: ${logEntry.request_id} spend=${spend}`);
}

/**
 * 计算并设置响应的花费
 *
 * 调用 costPerToken 计算费用并写入 response.usage.cost。
 * 兼容 OpenAI 和 Anthropic 两种字段命名方式。
 *
 * GAP 6: 新增 `customCostPerToken` 参数 — 对齐 PY deployment 级 per-token override。
 *   当 response 上挂载了 `_customCostPerToken`（由 Router 从 deployment.litellm_params 透传），
 *   或调用方显式传入时，costPerToken 走 custom 路径。
 * @param response - ModelResponse 或 ModelResponseStream
 * @param model - 模型名称
 * @param customCostPerToken - 可选 deployment 级 custom_cost_per_token 覆盖
 */
export function calculateAndSetCost(
	response: ModelResponse | ModelResponseStream,
	model: string,
	customCostPerToken?:
		| {
				input_cost_per_token?: number;
				output_cost_per_token?: number;
				cache_creation_input_token_cost?: number;
				cache_read_input_token_cost?: number;
		  }
		| undefined,
): void {
	const usage = (response as ModelResponse).usage as Usage | undefined;
	if (usage === undefined) {
		return;
	}

	// GAP: 用 normalizeUsageForSpend 集中处理 input_tokens / prompt_tokens 等差异，
	// 与 trackSpendLog 入口的转换路径保持一致。
	const normalized = normalizeUsageForSpend(usage as unknown as Record<string, unknown>);
	const promptTokens = normalized?.prompt_tokens ?? usage.prompt_tokens ?? 0;
	const completionTokens = normalized?.completion_tokens ?? usage.completion_tokens ?? 0;
	const cachedTokens = normalized?.cache_read_input_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? 0;
	const cacheCreationTokens =
		normalized?.cache_creation_input_tokens ??
		usage.prompt_tokens_details?.cache_creation_tokens ??
		usage.cache_creation_input_tokens ??
		0;
	// DIFF-003: 从 usage.completion_tokens_details.reasoning_tokens 透传到 costPerToken
	// 让 reasoning 模型的 output cost 正确扣除 reasoning_tokens（避免双重计费）。
	const completionDetails = (usage as unknown as Record<string, unknown>)["completion_tokens_details"] as
		| Record<string, unknown>
		| undefined;
	const reasoningTokens =
		typeof completionDetails?.["reasoning_tokens"] === "number" ? (completionDetails["reasoning_tokens"] as number) : 0;
	// GAP 6: 优先从 response._customCostPerToken 读取（Router 透传），其次用参数显式传入。
	// 批次 9: response._spendInfo.customCostPerToken（model_info/litellm_params 合并价格）
	// 介于两者之间——比 legacy _customCostPerToken（仅 litellm_params.custom_cost_per_token）更完整。
	const spendInfoCustom = (response as unknown as { _spendInfo?: { customCostPerToken?: unknown } })._spendInfo?.customCostPerToken;
	const legacyCustom = (response as unknown as { _customCostPerToken?: unknown })._customCostPerToken;
	const effectiveCustom = customCostPerToken ?? spendInfoCustom ?? legacyCustom;
	const customObj =
		typeof effectiveCustom === "object" && effectiveCustom !== null
			? (effectiveCustom as {
					input_cost_per_token?: number;
					output_cost_per_token?: number;
					cache_creation_input_token_cost?: number;
					cache_read_input_token_cost?: number;
				})
			: undefined;
	// GAP (COST-001): costPerToken 未知模型返回 0,0,0 静默（对齐 PY），无需 try/catch
	const modelCostMapEntry = (response as unknown as { _modelCostMap?: Record<string, unknown> })._modelCostMap;
	const { totalCost } = costPerToken(model, promptTokens, completionTokens, cacheCreationTokens, cachedTokens, {
		customCostPerToken: customObj,
		modelCostMap: modelCostMapEntry as never,
		// DIFF-003: 透传 reasoning_tokens
		reasoningTokens: reasoningTokens,
	});

	// 在 usage 上设置 cost
	(usage as Usage & { cost?: number }).cost = totalCost;
}

/**
 * PY: Inject x-litellm-response-cost header into the Express response (logging middleware).
 * Call this after calculateAndSetCost has set usage.cost.
 * @param res - Express Response object
 * @param cost - total cost to inject
 */
export function injectResponseCostHeader(res: import("express").Response, cost: number): void {
	if (res && !res.headersSent) {
		res.setHeader("x-litellm-response-cost", String(cost));
	}
}
