/**
 * 花费追踪器
 *
 * 记录每次 API 调用的费用：
 * 1. 插入 LiteLLM_SpendLogs 表
 * 2. 更新 DailySpend 相关表（User/Team/Organization/Tag/Agent）
 * 3. 在响应中注入 x-litellm-response-cost 头
 */

import { createHash, randomUUID } from "node:crypto";
import type { Request } from "express";
import { get_encoding } from "tiktoken";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "../db/schema";
import { liteLLM_SpendLogs } from "../db/schema/spendLogs";
import { liteLLM_DailyUserSpend } from "../db/schema/dailyUserSpend";
import { liteLLM_DailyTeamSpend } from "../db/schema/dailyTeamSpend";
import { liteLLM_DailyOrganizationSpend } from "../db/schema/dailyOrganizationSpend";
import { liteLLM_DailyTagSpend } from "../db/schema/dailyTagSpend";
import { liteLLM_DailyAgentSpend } from "../db/schema/dailyAgentSpend";
import { liteLLM_DailyEndUserSpend } from "../db/schema/dailyEndUserSpend";
import { and, eq, lte, sql } from "drizzle-orm";
import { LiteLLM_VerificationToken } from "../db/schema/verification-tokens";
import { LiteLLM_UserTable } from "../db/schema/users";
import { LiteLLM_TeamTable } from "../db/schema/teams";
import { LiteLLM_OrganizationTable } from "../db/schema/organizations";
import { LiteLLM_TeamMembership } from "../db/schema/team-memberships";
import { LiteLLM_EndUserTable } from "../db/schema/end-users";
import { liteLLM_AgentsTable } from "../db/schema/agents";
import { LiteLLM_ProjectTable } from "../db/schema/projects";
import { liteLLM_SpendReservations } from "../db/schema/spendReservations";
import { liteLLM_ActiveRequests } from "../db/schema/activeRequests";
import { ApiError } from "../core/api/ApiError";
import { dbConfigProvider } from "../core/config/DbConfigProvider";
import type {
	SpendLog,
	SpendLogBuildContext,
	SpendLogsMetadata,
	SpendLogTrackResult,
	SpendReservationInput,
	SpendReservationResult,
	SpendReservationScope,
} from "../types/spend";
import { CallType, SpendLogStatus } from "../types/spend";
import type { ModelResponse, ModelResponseStream, Usage } from "../types/openai";
import { costPerToken } from "../cost/CostCalculator";
import { createModuleLogger } from "../core/utils/logger";
import { hashApiKey } from "../core/utils/crypto";
import { getConfig } from "../core/config";
import type { UserAPIKeyAuth } from "../types/auth";
import type { CustomCostPerToken } from "../cost/CostCalculator";

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
				spend: sql`COALESCE(${table.spend}, 0) + ${spend}`,
				api_requests: sql`${table.api_requests} + 1`,
				successful_requests: sql`${table.successful_requests} + ${successfulRequests}`,
				failed_requests: sql`${table.failed_requests} + ${failedRequests}`,
				updated_at: updatedAt,
			},
		});
}

/**
 * 首次 SpendLog 插入后，在同一事务中累计所有主体账务并刷新 key 活跃时间。
 * @param db
 * @param log
 * @param spend
 */
async function updateSpendSubjects(db: NodePgDatabase<typeof schema>, log: SpendLog, spend: number): Promise<void> {
	const spendIncrement = sql`${spend}`;
	const now = new Date();
	await db
		.update(LiteLLM_VerificationToken)
		.set({ spend: sql`COALESCE(${LiteLLM_VerificationToken.spend}, 0) + ${spendIncrement}`, lastActive: now })
		.where(eq(LiteLLM_VerificationToken.token, _protectApiKeyForDb(log.api_key)));
	if (log.user) {
		await db
			.update(LiteLLM_UserTable)
			.set({ spend: sql`COALESCE(${LiteLLM_UserTable.spend}, 0) + ${spendIncrement}` })
			.where(eq(LiteLLM_UserTable.userId, log.user));
	}
	if (log.team_id) {
		await db
			.update(LiteLLM_TeamTable)
			.set({ spend: sql`COALESCE(${LiteLLM_TeamTable.spend}, 0) + ${spendIncrement}` })
			.where(eq(LiteLLM_TeamTable.teamId, log.team_id));
	}
	if (log.organization_id) {
		await db
			.update(LiteLLM_OrganizationTable)
			.set({ spend: sql`COALESCE(${LiteLLM_OrganizationTable.spend}, 0) + ${spendIncrement}` })
			.where(eq(LiteLLM_OrganizationTable.organizationId, log.organization_id));
	}
	const metadataProjectId = log.metadata?.["user_api_key_project_id"];
	const projectId = log.project_id ?? (typeof metadataProjectId === "string" ? metadataProjectId : undefined);
	if (projectId) {
		await db
			.update(LiteLLM_ProjectTable)
			.set({ spend: sql`COALESCE(${LiteLLM_ProjectTable.spend}, 0) + ${spendIncrement}` })
			.where(eq(LiteLLM_ProjectTable.projectId, projectId));
	}
	if (log.user && log.team_id) {
		await db
			.update(LiteLLM_TeamMembership)
			.set({ spend: sql`COALESCE(${LiteLLM_TeamMembership.spend}, 0) + ${spendIncrement}` })
			.where(and(eq(LiteLLM_TeamMembership.userId, log.user), eq(LiteLLM_TeamMembership.teamId, log.team_id)));
	}
	if (log.end_user_id) {
		await db
			.update(LiteLLM_EndUserTable)
			.set({ spend: sql`COALESCE(${LiteLLM_EndUserTable.spend}, 0) + ${spendIncrement}` })
			.where(eq(LiteLLM_EndUserTable.userId, log.end_user_id));
	}
	if (log.agent_id) {
		await db
			.update(liteLLM_AgentsTable)
			.set({ spend: sql`COALESCE(${liteLLM_AgentsTable.spend}, 0) + ${spendIncrement}` })
			.where(eq(liteLLM_AgentsTable.agentId, log.agent_id));
	}
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

/**
 * 图片响应需要保留完整 base64 才能在 Logs 中重放。它们不适用普通 prompt
 * 的 32KB 限制，但仍设置独立上限，避免异常 provider 响应无限放大单行 JSONB。
 */
const MAX_IMAGE_RESPONSE_BASE64_LENGTH_IN_DB =
	Number(process.env.MAX_IMAGE_RESPONSE_BASE64_LENGTH_IN_DB ?? 20 * 1024 * 1024) || 20 * 1024 * 1024;

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

/** 仅识别 provider 响应中的标准图片数据字段，其他长字符串继续执行普通截断。 */
function isImageResponseString(fieldName: string, value: unknown, parent: Record<string, unknown>): boolean {
	if (typeof value !== "string" || value.length > MAX_IMAGE_RESPONSE_BASE64_LENGTH_IN_DB) return false;
	if (containsPlaintextApiKey(value)) return false;
	if (fieldName === "b64_json") return true;
	if (fieldName === "result" && parent["type"] === "image_generation_call") return true;
	if (
		fieldName === "data" &&
		typeof (parent["mimeType"] ?? parent["mime_type"]) === "string" &&
		String(parent["mimeType"] ?? parent["mime_type"]).startsWith("image/")
	) {
		return true;
	}
	return value.startsWith("data:image/");
}

/**
 * 递归清理 SpendLogs JSON 负载（对齐 PY _sanitize_request_body_for_spend_logs_payload）：
 * - 不做字段名黑名单（PY 无此逻辑——user_api_key_alias/total_tokens 等标识与数值字段均明文保留）
 * - 明文 API key 检测脱敏（安全兜底，仅命中真含 sk- 明文的字符串值）
 * - 超长字符串截断：头 35% 尾 65% 保留（PY 同款，尾部通常是更重要的上下文）
 * @param value - 待写入 SpendLogs 的任意 JSON 值
 */
function sanitizeSpendLogPayloadValue(value: unknown, preserveImageStrings: boolean): unknown {
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
		return value.map((arrayValue) => sanitizeSpendLogPayloadValue(arrayValue, preserveImageStrings));
	}
	if (typeof value === "object") {
		const sourceRecord = value as Record<string, unknown>;
		const sanitizedRecord: Record<string, unknown> = {};
		for (const [fieldName, fieldValue] of Object.entries(sourceRecord)) {
			sanitizedRecord[fieldName] =
				preserveImageStrings && isImageResponseString(fieldName, fieldValue, sourceRecord)
					? fieldValue
					: sanitizeSpendLogPayloadValue(fieldValue, preserveImageStrings);
		}
		return sanitizedRecord;
	}
	return value;
}

export function sanitizeSpendLogPayload(value: unknown): unknown {
	return sanitizeSpendLogPayloadValue(value, false);
}

/** 清理响应负载，但为可重放的图片输出保留完整 base64。 */
export function sanitizeSpendLogResponsePayload(value: unknown): unknown {
	return sanitizeSpendLogPayloadValue(value, true);
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
export async function shouldStorePromptsAndResponsesInSpendLogs(): Promise<boolean> {
	if (process.env.STORE_PROMPTS_IN_SPEND_LOGS === "true") {
		return true;
	}
	try {
		const dbGeneral = await dbConfigProvider.getParam("general_settings");
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
 * 为活跃记录与最终 SpendLog 返回同一个请求级 session_id。
 * @param req
 */
function getOrCreateSpendSessionId(req: Request): string {
	if (req.spendSessionId) {
		return req.spendSessionId;
	}
	const requestBody = req.body as Record<string, unknown> | undefined;
	const metadata = requestBody?.metadata as Record<string, unknown> | undefined;
	const traceId = metadata?.trace_id ?? requestBody?.trace_id;
	if (typeof traceId === "string" && traceId.length > 0) {
		req.spendSessionId = traceId;
		return req.spendSessionId;
	}
	const litellmTraceId = metadata?.litellm_trace_id ?? requestBody?.litellm_trace_id;
	if (typeof litellmTraceId === "string" && litellmTraceId.length > 0) {
		req.spendSessionId = litellmTraceId;
		return req.spendSessionId;
	}
	req.spendSessionId = randomUUID();
	return req.spendSessionId;
}

const SESSION_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * OpenAI Responses/Codex 把稳定任务 ID 放在 client_metadata，而顶层
 * SpendLog session_id 仍是请求级 UUID。这里仅提取合法 UUID，并保持
 * thread_id > client session_id > prompt_cache_key 的优先级。
 */
function getCanonicalSessionGroupKey(req: Request): string | undefined {
	const requestBody =
		req.body !== null && typeof req.body === "object" && !Array.isArray(req.body)
			? (req.body as Record<string, unknown>)
			: undefined;
	const clientMetadata =
		requestBody?.client_metadata !== null &&
		typeof requestBody?.client_metadata === "object" &&
		!Array.isArray(requestBody.client_metadata)
			? (requestBody.client_metadata as Record<string, unknown>)
			: undefined;
	const candidates = [clientMetadata?.thread_id, clientMetadata?.session_id, requestBody?.prompt_cache_key];
	for (const candidate of candidates) {
		if (typeof candidate !== "string") continue;
		const normalized = candidate.trim();
		if (SESSION_UUID_PATTERN.test(normalized)) return `s:${normalized}`;
	}
	return undefined;
}

/**
 * session_id 对齐 Python：trace_id > litellm_trace_id > UUID。
 * @param ctx - SpendLog 构建上下文
 */
export function getSessionIdForSpendLog(ctx: SpendLogBuildContext): string {
	return getOrCreateSpendSessionId(ctx.req);
}

/**
 * 构建 Python proxy_server_request JSON 形状。
 * @param ctx - SpendLog 构建上下文
 */
export async function buildProxyServerRequest(ctx: SpendLogBuildContext): Promise<Record<string, unknown>> {
	const shouldStoreBody = await shouldStorePromptsAndResponsesInSpendLogs();
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
 * - 发生 fallback 时，即使 deployment model 不含 "/" 也必须用实际 deployment；
 *   否则会把最终请求错误归因并计费到原始 model group
 * - 否则 bedrock provider 且 model 无前缀 → 补 "bedrock/" 前缀
 * - 其余原样返回请求 model
 * @param model - 客户端请求的逻辑模型名
 * @param customLlmProvider - 实际执行 deployment 的 provider
 * @param deploymentModel - 实际执行 deployment 的 litellm_params.model
 * @param fallbackOccurred - 是否已经从原请求模型 fallback 到其他模型
 */
export function reconstructModelName(
	model: string,
	customLlmProvider: string | undefined,
	deploymentModel: string | undefined,
	fallbackOccurred = false,
): string {
	if (deploymentModel && (deploymentModel.includes("/") || fallbackOccurred)) {
		return deploymentModel;
	}
	if (customLlmProvider === BEDROCK_PROVIDER_NAME && model.length > 0 && !model.includes("/")) {
		return `${customLlmProvider}/${model}`;
	}
	return model;
}

function normalizeModelResolutionChain(ctx: SpendLogBuildContext): SpendLogsMetadata["model_resolution_chain"] {
	try {
		const entries = ctx.modelResolutionChain;
		if (!Array.isArray(entries)) {
			return null;
		}
		const normalized = entries.flatMap((entry) => {
			if (
				!entry ||
				!Number.isInteger(entry.fallback_index) ||
				entry.fallback_index < 0 ||
				typeof entry.input_model !== "string" ||
				typeof entry.resolved_model !== "string" ||
				!Array.isArray(entry.resolution_path) ||
				entry.resolution_path.length <= 1 ||
				!entry.resolution_path.every((node: unknown) => typeof node === "string")
			) {
				return [];
			}
			return [{ ...entry, resolution_path: [...entry.resolution_path] }];
		});
		return normalized.length > 0 ? normalized : null;
	} catch {
		return null;
	}
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
		session_group_key: getCanonicalSessionGroupKey(ctx.req),
		user_api_key: getAuthApiKeyForSpendLog(ctx),
		user_api_key_alias: auth?.key_alias,
		user_api_key_team_id: auth?.team_id,
		user_api_key_team_alias: auth?.team_alias ?? null,
		user_api_key_org_id: auth?.organization_id,
		user_api_key_user_id: auth?.user_id,
		// PY SpendLogsMetadata 键集对齐：项目/guardrail/MCP/vector-store/batch 子系统
		// 未实现，键就位值恒 null（PY 同样以 None 落键）
		user_api_key_project_id: auth?.project_id ?? null,
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
		fallback_models: ctx.fallbackModels ?? null,
		model_resolution_chain: normalizeModelResolutionChain(ctx),
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
export async function buildSpendLogFromRequest(ctx: SpendLogBuildContext): Promise<SpendLog> {
	const usage = normalizeUsageForSpend(ctx.usage);
	const status = ctx.status ?? (ctx.error ? SpendLogStatus.Failure : SpendLogStatus.Success);
	const shouldStoreBody = await shouldStorePromptsAndResponsesInSpendLogs();
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
		model: reconstructModelName(ctx.model, ctx.customLlmProvider, ctx.deploymentModel, (ctx.attemptedRetries ?? 0) > 0),
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
		response: shouldStoreBody ? sanitizeSpendLogResponsePayload(ctx.response) : {},
		// 顶层列存完整 proxy_server_request（含 body）；metadata 内恒 null（对齐 Python），
		// 详情端点 /spend/logs/ui/:request_id 从本列读取。
		proxy_server_request: await buildProxyServerRequest(ctx),
		session_id: getSessionIdForSpendLog(ctx),
		request_duration_ms: requestDurationMs,
		status: status,
		organization_id: ctx.auth?.organization_id,
		project_id: ctx.auth?.project_id,
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

const DEFAULT_RESERVATION_COMPLETION_TOKENS = 4096;
let reservationTokenizer: ReturnType<typeof get_encoding> | undefined;

/**
 * 获取请求级稳定账务 ID；客户端幂等键始终按认证 key 命名空间隔离。
 * @param req
 */
export function getOrCreateSpendRequestId(req: Request): string {
	if (req.spendRequestId) {
		return req.spendRequestId;
	}
	const headerValue = req.headers["x-request-id"] ?? req.headers["idempotency-key"];
	const stableHeader = Array.isArray(headerValue) ? headerValue[0] : headerValue;
	if (typeof stableHeader === "string" && stableHeader.length > 0) {
		const authNamespace = req.auth?.token ?? req.auth?.api_key ?? "anonymous";
		req.spendRequestId = createHash("sha256").update(authNamespace).update("\0").update(stableHeader).digest("hex");
	} else {
		req.spendRequestId = randomUUID();
	}
	return req.spendRequestId;
}

const ACTIVE_REQUEST_LEASE_MS = 15 * 60 * 1_000;

/** 创建活跃请求列表行所需的轻量上下文。 */
export interface ActiveRequestInput {
	/** 当前 Express 请求。 */
	readonly req: Request;
	/** 与最终 SpendLog 共用的请求 ID。 */
	readonly requestId: string;
	/** 客户端请求的逻辑模型名。 */
	readonly model: string;
	/** LiteLLM 调用类型。 */
	readonly callType: CallType;
	/** 请求开始时间；缺省为登记时间。 */
	readonly startTime?: Date;
}

/**
 * 在调用 Provider 前登记活跃请求。request_id 同时与最终 SpendLogs 保持全局幂等。
 * @param db
 * @param input
 */
export async function registerActiveRequest(db: NodePgDatabase<typeof schema>, input: ActiveRequestInput): Promise<void> {
	const auth = input.req.auth;
	if (!auth) {
		return;
	}
	const now = new Date();
	try {
		await db.transaction(async (tx) => {
			const completed = await tx
				.select({ requestId: liteLLM_SpendLogs.request_id })
				.from(liteLLM_SpendLogs)
				.where(eq(liteLLM_SpendLogs.request_id, input.requestId))
				.limit(1);
			if (completed.length > 0) {
				throw ApiError.conflict(`重复的 request_id: ${input.requestId}`);
			}
			await tx
				.delete(liteLLM_ActiveRequests)
				.where(and(eq(liteLLM_ActiveRequests.request_id, input.requestId), lte(liteLLM_ActiveRequests.expires_at, now)));
			const inserted = await tx
				.insert(liteLLM_ActiveRequests)
				.values({
					request_id: input.requestId,
					call_type: input.callType,
					api_key: auth.token ?? _protectApiKeyForDb(auth.api_key || ""),
					startTime: input.startTime ?? now,
					model: input.model,
					model_group: input.model,
					user: auth.user_id ?? "",
					team_id: auth.team_id ?? null,
					organization_id: auth.organization_id ?? null,
					end_user: auth.end_user_id ?? null,
					requester_ip_address: getRequesterIpAddress(input.req) ?? null,
					session_id: getOrCreateSpendSessionId(input.req),
					metadata: {
						status: "in_progress",
						user_api_key_alias: auth.key_alias ?? null,
					},
					request_tags: [],
					status: "in_progress",
					expires_at: new Date(now.getTime() + ACTIVE_REQUEST_LEASE_MS),
					updated_at: now,
				})
				.onConflictDoNothing()
				.returning({ requestId: liteLLM_ActiveRequests.request_id });
			if (inserted.length === 0) {
				throw ApiError.conflict(`重复的 request_id: ${input.requestId}`);
			}
		});
	} catch (error) {
		if (error instanceof ApiError) {
			throw error;
		}
		throw ApiError.unavailable("活跃请求记录数据库暂不可用");
	}
}

/**
 * 延长仍在执行的活跃请求租约。
 * @param db
 * @param requestId
 */
export async function renewActiveRequest(db: NodePgDatabase<typeof schema>, requestId: string): Promise<boolean> {
	const now = new Date();
	const rows = await db
		.update(liteLLM_ActiveRequests)
		.set({
			expires_at: new Date(now.getTime() + ACTIVE_REQUEST_LEASE_MS),
			updated_at: now,
		})
		.where(and(eq(liteLLM_ActiveRequests.request_id, requestId), eq(liteLLM_ActiveRequests.status, "in_progress")))
		.returning({ requestId: liteLLM_ActiveRequests.request_id });
	return rows.length > 0;
}

/**
 * 删除不再执行的活跃请求行。
 * @param db
 * @param requestId
 */
export async function removeActiveRequest(db: NodePgDatabase<typeof schema>, requestId: string): Promise<void> {
	await db.delete(liteLLM_ActiveRequests).where(eq(liteLLM_ActiveRequests.request_id, requestId));
}

/**
 * 兼容仅实现 SpendTracker 旧查询面的轻量测试/适配器；生产 Drizzle 实例始终提供 delete。
 * @param db
 * @param requestId
 */
async function removeActiveRequestIfSupported(db: NodePgDatabase<typeof schema>, requestId: string): Promise<void> {
	const deleteMethod = (db as unknown as { delete?: NodePgDatabase<typeof schema>["delete"] }).delete;
	if (typeof deleteMethod !== "function") {
		return;
	}
	await deleteMethod.call(db, liteLLM_ActiveRequests).where(eq(liteLLM_ActiveRequests.request_id, requestId));
}

/**
 * 活跃请求租约心跳；失败只影响实时展示，不阻断 Provider 请求。
 * @param db
 * @param requestId
 * @param options
 */
export function startActiveRequestHeartbeat(
	db: NodePgDatabase<typeof schema>,
	requestId: string,
	options: { intervalMs?: number } = {},
): SpendReservationHeartbeat {
	const intervalMs = options.intervalMs ?? Math.floor(ACTIVE_REQUEST_LEASE_MS / 3);
	let stopped = false;
	const renew = async (): Promise<boolean> => {
		if (stopped) {
			return false;
		}
		try {
			return await renewActiveRequest(db, requestId);
		} catch (error) {
			logger.warn("活跃请求续租失败", { error: error, requestId: requestId });
			return false;
		}
	};
	const timer = setInterval(() => void renew(), intervalMs);
	timer.unref?.();
	return {
		markProviderStarted: (): void => undefined,
		renewNow: renew,
		stop: (): void => {
			if (stopped) {
				return;
			}
			stopped = true;
			clearInterval(timer);
		},
	};
}

/**
 * 从认证上下文构造所有适用且独立核算的预算主体。
 * @param auth
 */
export function buildSpendReservationScopes(auth: UserAPIKeyAuth): SpendReservationScope[] {
	const snapshots = auth.budget_snapshots;
	if (!snapshots) {
		return [];
	}
	const scopes: SpendReservationScope[] = [];
	if (snapshots.key?.max_budget != null && Number.isFinite(snapshots.key.max_budget)) {
		scopes.push({ kind: "key", id: snapshots.key.id });
	}
	if (snapshots.user?.max_budget != null && Number.isFinite(snapshots.user.max_budget)) {
		scopes.push({ kind: "user", id: snapshots.user.id });
	}
	if (snapshots.team?.max_budget != null && Number.isFinite(snapshots.team.max_budget)) {
		scopes.push({ kind: "team", id: snapshots.team.id });
	}
	if (snapshots.organization?.max_budget != null && Number.isFinite(snapshots.organization.max_budget)) {
		scopes.push({ kind: "organization", id: snapshots.organization.id });
	}
	if (snapshots.project?.max_budget != null && Number.isFinite(snapshots.project.max_budget)) {
		scopes.push({ kind: "project", id: snapshots.project.id });
	}
	if (snapshots.team_member?.max_budget != null && Number.isFinite(snapshots.team_member.max_budget)) {
		const separator = snapshots.team_member.id.indexOf(":");
		const userId = auth.user_id ?? snapshots.team_member.id.slice(0, separator);
		const teamId = auth.team_id ?? snapshots.team_member.id.slice(separator + 1);
		if (separator > 0 && userId && teamId) {
			scopes.push({ kind: "team_member", userId: userId, teamId: teamId });
		}
	}
	if (snapshots.end_user?.max_budget != null && Number.isFinite(snapshots.end_user.max_budget)) {
		scopes.push({ kind: "end_user", id: snapshots.end_user.id });
	}
	return scopes;
}

/**
 * 估算请求最大费用；输入使用 cl100k_base tokenizer，输出使用请求声明的最大 token 数。
 * @param model
 * @param requestBody
 * @param customCost
 */
export function estimateSpendReservation(model: string, requestBody: Record<string, unknown>, customCost?: CustomCostPerToken): number {
	reservationTokenizer ??= get_encoding("cl100k_base");
	const promptTokens = reservationTokenizer.encode(JSON.stringify(requestBody)).length;
	const configuredLimits = [requestBody["max_completion_tokens"], requestBody["max_output_tokens"], requestBody["max_tokens"]].filter(
		(value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0,
	);
	const completionTokens = configuredLimits.length > 0 ? Math.ceil(Math.max(...configuredLimits)) : DEFAULT_RESERVATION_COMPLETION_TOKENS;
	const estimate = costPerToken(model, promptTokens, completionTokens, 0, 0, { customCostPerToken: customCost }).totalCost;
	return Number.isFinite(estimate) ? Math.max(0, estimate) : 0;
}

function reservationScopeKey(scope: SpendReservationScope): string {
	return scope.kind === "team_member" ? `team_member:${JSON.stringify([scope.userId, scope.teamId])}` : `${scope.kind}:${scope.id}`;
}

/**
 * 在事务内锁定并读取一个可独立计费的预算主体。
 * @param tx
 * @param scope
 */
async function lockReservationBudget(
	tx: NodePgDatabase<typeof schema>,
	scope: SpendReservationScope,
): Promise<{ maxBudget: number | null; spend: number }> {
	await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${reservationScopeKey(scope)}))`);
	let query;
	switch (scope.kind) {
		case "key":
			query = sql`SELECT max_budget, budget_id, spend FROM "LiteLLM_VerificationToken" WHERE token = ${scope.id} FOR UPDATE`;
			break;
		case "user":
			query = sql`SELECT max_budget, spend FROM "LiteLLM_UserTable" WHERE user_id = ${scope.id} FOR UPDATE`;
			break;
		case "team":
			query = sql`SELECT max_budget, spend FROM "LiteLLM_TeamTable" WHERE team_id = ${scope.id} FOR UPDATE`;
			break;
		case "organization":
			query = sql`SELECT NULL::real AS max_budget, budget_id, spend FROM "LiteLLM_OrganizationTable" WHERE organization_id = ${scope.id} FOR UPDATE`;
			break;
		case "project":
			query = sql`SELECT NULL::real AS max_budget, budget_id, spend FROM "LiteLLM_ProjectTable" WHERE project_id::text = ${scope.id} FOR UPDATE`;
			break;
		case "team_member":
			query = sql`SELECT NULL::real AS max_budget, budget_id, spend FROM "LiteLLM_TeamMembership" WHERE user_id = ${scope.userId} AND team_id = ${scope.teamId} FOR UPDATE`;
			break;
		case "end_user":
			query = sql`SELECT NULL::real AS max_budget, budget_id, spend FROM "LiteLLM_EndUserTable" WHERE user_id = ${scope.id} FOR UPDATE`;
			break;
		default:
			throw ApiError.badRequest("不支持的预算主体类型");
	}
	const result = (await tx.execute(query)) as unknown as {
		rows: Array<{ max_budget: number | null; budget_id?: string | null; spend: number | null }>;
	};
	const row = result.rows[0];
	if (!row) {
		throw ApiError.unavailable(`预算主体不存在: ${reservationScopeKey(scope)}`);
	}
	if (row.budget_id) {
		const budgetResult = (await tx.execute(
			sql`SELECT max_budget FROM "LiteLLM_BudgetTable" WHERE budget_id::text = ${row.budget_id} FOR UPDATE`,
		)) as unknown as { rows: Array<{ max_budget: number | null }> };
		row.max_budget = budgetResult.rows[0]?.max_budget ?? null;
	}
	return { maxBudget: row.max_budget, spend: row.spend ?? 0 };
}

const SPEND_RESERVATION_LEASE_MS = 15 * 60 * 1_000;

type SpendReservationRow = typeof liteLLM_SpendReservations.$inferSelect;

function reservationLeaseExpiresAt(): Date {
	return new Date(Date.now() + SPEND_RESERVATION_LEASE_MS);
}

/** 单请求 reservation 租约续期控制器；不持有跨请求共享状态。 */
export interface SpendReservationHeartbeat {
	/** 在调用 provider 前标记执行开始；若此前续租失败则同步抛出 503。 */
	markProviderStarted(): void;
	/** 显式执行一次续租，供测试和长时间 provider 前处理使用。 */
	renewNow(): Promise<boolean>;
	/** 停止定时续租。 */
	stop(): void;
}

/**
 * 原子延长仍活跃且未过期的 reservation 租约。
 * @param db
 * @param requestId
 */
export async function renewSpendReservation(db: NodePgDatabase<typeof schema>, requestId: string): Promise<SpendReservationResult> {
	if (!requestId) {
		throw ApiError.badRequest("requestId 必填");
	}
	try {
		const rows = await db
			.update(liteLLM_SpendReservations)
			.set({ expires_at: reservationLeaseExpiresAt(), updated_at: new Date() })
			.where(
				and(
					eq(liteLLM_SpendReservations.request_id, requestId),
					eq(liteLLM_SpendReservations.status, "reserved"),
					sql`${liteLLM_SpendReservations.expires_at} > now()`,
				),
			)
			.returning();
		const row = rows[0];
		if (!row) {
			throw ApiError.unavailable(`费用预留租约已失效: ${requestId}`);
		}
		return { status: "reserved", requestId: requestId, reserved: row.reserved, actual: row.actual };
	} catch (error) {
		if (error instanceof ApiError) {
			throw error;
		}
		throw ApiError.unavailable("费用预留续租数据库暂不可用");
	}
}

/**
 * 启动无共享 Map 的单请求 reservation heartbeat。
 * provider 开始前的续租失败会阻止调用；provider 执行中的失败只记录，最终由结算事务重检预算。
 * @param db
 * @param requestId
 * @param options
 */
export function startSpendReservationHeartbeat(
	db: NodePgDatabase<typeof schema>,
	requestId: string,
	options: { intervalMs?: number; renew?: () => Promise<unknown> } = {},
): SpendReservationHeartbeat {
	const intervalMs = options.intervalMs ?? Math.floor(SPEND_RESERVATION_LEASE_MS / 3);
	const renew = options.renew ?? (() => renewSpendReservation(db, requestId));
	let providerStarted = false;
	let stopped = false;
	let preProviderFailure: ApiError | undefined;
	let inFlight: Promise<boolean> | undefined;

	const runRenew = (explicit: boolean): Promise<boolean> => {
		if (stopped) {
			return Promise.resolve(false);
		}
		if (inFlight) {
			return inFlight;
		}
		inFlight = renew()
			.then(() => true)
			.catch((error: unknown) => {
				logger.error("Spend reservation 续租失败", { error: error, providerStarted: providerStarted, requestId: requestId });
				if (!providerStarted) {
					preProviderFailure = ApiError.unavailable(`费用预留续租失败: ${requestId}`);
					if (explicit) {
						throw preProviderFailure;
					}
				}
				return false;
			})
			.finally(() => {
				inFlight = undefined;
			});
		return inFlight;
	};

	const timer = setInterval(() => {
		void runRenew(false);
	}, intervalMs);
	timer.unref();

	return {
		markProviderStarted: function (): void {
			if (preProviderFailure) {
				throw preProviderFailure;
			}
			providerStarted = true;
		},
		renewNow: function (): Promise<boolean> {
			return runRenew(true);
		},
		stop: function (): void {
			stopped = true;
			clearInterval(timer);
		},
	};
}

function parseReservationScopeKey(scopeKey: string): SpendReservationScope {
	if (scopeKey.startsWith("team_member:")) {
		const pair = JSON.parse(scopeKey.slice("team_member:".length)) as unknown;
		if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== "string" || typeof pair[1] !== "string") {
			throw ApiError.unavailable(`预留预算主体损坏: ${scopeKey}`);
		}
		return { kind: "team_member", userId: pair[0], teamId: pair[1] };
	}
	const separator = scopeKey.indexOf(":");
	const kind = scopeKey.slice(0, separator);
	const id = scopeKey.slice(separator + 1);
	if (
		separator <= 0 ||
		!id ||
		!(["key", "user", "team", "organization", "project", "end_user"] as const).includes(
			kind as "key" | "user" | "team" | "organization" | "project" | "end_user",
		)
	) {
		throw ApiError.unavailable(`预留预算主体损坏: ${scopeKey}`);
	}
	return { kind: kind as "key" | "user" | "team" | "organization" | "project" | "end_user", id: id };
}

async function assertReservationFits(
	tx: NodePgDatabase<typeof schema>,
	scopes: readonly SpendReservationScope[],
	amount: number,
	excludedRequestId?: string,
): Promise<void> {
	const uniqueScopes = new Map(scopes.map((scope) => [reservationScopeKey(scope), scope]));
	for (const [scopeKey, scope] of [...uniqueScopes.entries()].sort(([left], [right]) => left.localeCompare(right))) {
		const budget = await lockReservationBudget(tx, scope);
		const active = (await tx.execute(
			excludedRequestId
				? sql`SELECT COALESCE(SUM(reserved), 0) AS reserved FROM "LiteLLM_SpendReservations" WHERE status = 'reserved' AND expires_at > now() AND request_id <> ${excludedRequestId} AND scope_ids @> ${JSON.stringify([scopeKey])}::jsonb`
				: sql`SELECT COALESCE(SUM(reserved), 0) AS reserved FROM "LiteLLM_SpendReservations" WHERE status = 'reserved' AND expires_at > now() AND scope_ids @> ${JSON.stringify([scopeKey])}::jsonb`,
		)) as unknown as { rows: Array<{ reserved: number | string }> };
		const activeReserved = Number(active.rows[0]?.reserved ?? 0);
		if (budget.maxBudget !== null && budget.spend + activeReserved + amount > budget.maxBudget) {
			throw ApiError.tooManyRequests(`预算不足: ${scopeKey}`);
		}
	}
}

async function readReservation(tx: NodePgDatabase<typeof schema>, requestId: string): Promise<SpendReservationRow | undefined> {
	const rows = await tx.select().from(liteLLM_SpendReservations).where(eq(liteLLM_SpendReservations.request_id, requestId));
	return rows[0];
}

/**
 * 跨实例安全预留请求费用。每个 scope 取得 PostgreSQL advisory transaction lock，
 * 因而同一预算主体的余额校验与 ledger 写入不会并发穿透。
 * @param db
 * @param input
 */
export async function reserveSpend(db: NodePgDatabase<typeof schema>, input: SpendReservationInput): Promise<SpendReservationResult> {
	if (!input.requestId || !Number.isFinite(input.reserved) || input.reserved < 0 || input.scopes.length === 0) {
		throw ApiError.badRequest("requestId 必填，reserved 必须为非负数且至少指定一个预算主体");
	}
	try {
		return await db.transaction(async (tx) => {
			const historicalSpend = (await tx.execute(
				sql`SELECT spend FROM "LiteLLM_SpendLogs" WHERE request_id = ${input.requestId} LIMIT 1`,
			)) as unknown as { rows: Array<{ spend: number | null }> };
			if (historicalSpend.rows[0]) {
				return {
					status: "duplicate" as const,
					requestId: input.requestId,
					reserved: 0,
					actual: historicalSpend.rows[0].spend ?? 0,
				};
			}
			const existing = await readReservation(tx, input.requestId);
			const scopeIds = [...new Set(input.scopes.map(reservationScopeKey))].sort();
			if (existing) {
				if (existing.status !== "reserved" || existing.expires_at.getTime() > Date.now()) {
					return {
						status: "duplicate",
						requestId: input.requestId,
						reserved: existing.reserved,
						actual: existing.actual,
					};
				}
				await assertReservationFits(tx, input.scopes, input.reserved, input.requestId);
				const renewed = await tx
					.update(liteLLM_SpendReservations)
					.set({
						scope_ids: scopeIds,
						reserved: input.reserved,
						actual: null,
						status: "reserved",
						expires_at: reservationLeaseExpiresAt(),
						updated_at: new Date(),
					})
					.where(
						and(
							eq(liteLLM_SpendReservations.request_id, input.requestId),
							eq(liteLLM_SpendReservations.status, "reserved"),
							sql`${liteLLM_SpendReservations.expires_at} <= now()`,
						),
					)
					.returning();
				if (renewed[0]) {
					return { status: "reserved", requestId: input.requestId, reserved: renewed[0].reserved, actual: renewed[0].actual };
				}
				const concurrent = await readReservation(tx, input.requestId);
				return {
					status: "duplicate",
					requestId: input.requestId,
					reserved: concurrent?.reserved ?? input.reserved,
					actual: concurrent?.actual ?? null,
				};
			}
			await assertReservationFits(tx, input.scopes, input.reserved);
			const inserted = await tx
				.insert(liteLLM_SpendReservations)
				.values({
					request_id: input.requestId,
					scope_ids: scopeIds,
					reserved: input.reserved,
					status: "reserved",
					expires_at: reservationLeaseExpiresAt(),
				})
				.onConflictDoNothing()
				.returning();
			if (inserted.length === 0) {
				const concurrent = await readReservation(tx, input.requestId);
				return {
					status: "duplicate",
					requestId: input.requestId,
					reserved: concurrent?.reserved ?? input.reserved,
					actual: concurrent?.actual ?? null,
				};
			}
			return { status: "reserved", requestId: input.requestId, reserved: input.reserved, actual: null };
		});
	} catch (error) {
		if (error instanceof ApiError) {
			throw error;
		}
		throw ApiError.unavailable("费用预留数据库暂不可用");
	}
}

/**
 * 幂等释放未结算预留。
 * @param db
 * @param requestId
 */
export async function releaseSpend(db: NodePgDatabase<typeof schema>, requestId: string): Promise<SpendReservationResult> {
	if (!requestId) {
		throw ApiError.badRequest("requestId 必填");
	}
	try {
		return await db.transaction(async (tx) => {
			const removedActive = await tx
				.delete(liteLLM_ActiveRequests)
				.where(eq(liteLLM_ActiveRequests.request_id, requestId))
				.returning({ requestId: liteLLM_ActiveRequests.request_id });
			const rows = await tx
				.update(liteLLM_SpendReservations)
				.set({ status: "released", updated_at: new Date() })
				.where(and(eq(liteLLM_SpendReservations.request_id, requestId), eq(liteLLM_SpendReservations.status, "reserved")))
				.returning();
			const row = rows[0];
			if (row) {
				return { status: "released", requestId: requestId, reserved: row.reserved, actual: row.actual };
			}
			const existing = await tx.select().from(liteLLM_SpendReservations).where(eq(liteLLM_SpendReservations.request_id, requestId));
			if (!existing[0]) {
				if (removedActive.length > 0) {
					return { status: "released", requestId: requestId, reserved: 0, actual: null };
				}
				throw ApiError.badRequest(`预留不存在: ${requestId}`);
			}
			return {
				status: existing[0].status === "settled" ? "settled" : "released",
				requestId: requestId,
				reserved: existing[0].reserved,
				actual: existing[0].actual,
			};
		});
	} catch (error) {
		if (error instanceof ApiError) {
			throw error;
		}
		throw ApiError.unavailable("费用释放数据库暂不可用");
	}
}

/**
 * 幂等结算预留；实际 spend 由随后唯一的 SpendLog 事务累计。
 * @param db
 * @param requestId
 * @param actual
 */
export async function settleSpend(db: NodePgDatabase<typeof schema>, requestId: string, actual: number): Promise<SpendReservationResult> {
	if (!requestId || !Number.isFinite(actual) || actual < 0) {
		throw ApiError.badRequest("requestId 必填且 actual 必须为非负数");
	}
	try {
		return await db.transaction(async (tx) => {
			const existing = await readReservation(tx, requestId);
			if (!existing) {
				throw ApiError.badRequest(`预留不存在: ${requestId}`);
			}
			if (existing.status !== "reserved") {
				return {
					status: existing.status === "released" ? "released" : "settled",
					requestId: requestId,
					reserved: existing.reserved,
					actual: existing.actual,
				};
			}
			await assertReservationFits(tx, existing.scope_ids.map(parseReservationScopeKey), actual, requestId);
			const rows = await tx
				.update(liteLLM_SpendReservations)
				.set({ status: "settled", actual: actual, updated_at: new Date() })
				.where(and(eq(liteLLM_SpendReservations.request_id, requestId), eq(liteLLM_SpendReservations.status, "reserved")))
				.returning();
			const row = rows[0];
			if (row) {
				return { status: "settled", requestId: requestId, reserved: row.reserved, actual: row.actual };
			}
			const concurrent = await readReservation(tx, requestId);
			if (!concurrent) {
				throw ApiError.badRequest(`预留不存在: ${requestId}`);
			}
			return {
				status: concurrent.status === "released" ? "released" : "settled",
				requestId: requestId,
				reserved: concurrent.reserved,
				actual: concurrent.actual,
			};
		});
	} catch (error) {
		if (error instanceof ApiError) {
			throw error;
		}
		throw ApiError.unavailable("费用结算数据库暂不可用");
	}
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
export async function trackSpendLog(db: NodePgDatabase<typeof schema>, logEntry: SpendLog): Promise<SpendLogTrackResult> {
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
		cacheInputCost,
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
		cache_input_cost: cacheInputCost,
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

	const reservationStatus = (logEntry.status ?? SpendLogStatus.Success) === SpendLogStatus.Success || spend > 0 ? "settled" : "released";
	let result: SpendLogTrackResult;
	try {
		result = await db.transaction(async (tx) => {
			const inserted = await tx
				.insert(liteLLM_SpendLogs)
				.values(insertData)
				.onConflictDoNothing()
				.returning({ requestId: liteLLM_SpendLogs.request_id });
			if (inserted.length === 0) {
				// 历史 SpendLog 已经代表另一次已提交 attempt；不得用当前 attempt 的 spend
				// 终结一个来源不明的 reservation。
				await removeActiveRequestIfSupported(tx, logEntry.request_id);
				return { status: "duplicate" as const, requestId: logEntry.request_id, spend: spend };
			}

			const reservation = await readReservation(tx, logEntry.request_id);
			if (reservation?.status === "reserved") {
				await assertReservationFits(tx, reservation.scope_ids.map(parseReservationScopeKey), spend, logEntry.request_id);
			}
			await updateSpendSubjects(tx, logEntry, spend);

			// 使用归一后的字段更新每日汇总，避免 daily 表 prompt_tokens 与 SpendLogs 不一致。
			const normalizedLog: SpendLog = {
				...logEntry,
				prompt_tokens: promptTokens,
				completion_tokens: completionTokens,
				total_tokens: totalTokens,
				cache_creation_input_tokens: cacheCreationTokens,
				cache_read_input_tokens: cacheReadTokens,
			};
			await upsertDailySpend(tx, liteLLM_DailyUserSpend, "user_id", logEntry.user ?? null, normalizedLog, spend);
			await upsertDailySpend(tx, liteLLM_DailyTeamSpend, "team_id", logEntry.team_id ?? null, normalizedLog, spend);
			await upsertDailySpend(
				tx,
				liteLLM_DailyOrganizationSpend,
				"organization_id",
				logEntry.organization_id ?? null,
				normalizedLog,
				spend,
			);
			for (const tag of new Set(logEntry.request_tags ?? logEntry.tags ?? [])) {
				await upsertDailySpend(tx, liteLLM_DailyTagSpend, "tag", tag, normalizedLog, spend);
			}
			await upsertDailySpend(tx, liteLLM_DailyAgentSpend, "agent_id", logEntry.agent_id ?? null, normalizedLog, spend);
			await upsertDailySpend(tx, liteLLM_DailyEndUserSpend, "end_user_id", logEntry.end_user_id ?? null, normalizedLog, spend);
			await tx
				.update(liteLLM_SpendReservations)
				.set({ status: reservationStatus, actual: reservationStatus === "settled" ? spend : null, updated_at: new Date() })
				.where(
					and(eq(liteLLM_SpendReservations.request_id, logEntry.request_id), eq(liteLLM_SpendReservations.status, "reserved")),
				);
			await removeActiveRequestIfSupported(tx, logEntry.request_id);
			return { status: "committed" as const, requestId: logEntry.request_id, spend: spend };
		});
	} catch (error) {
		try {
			await db
				.update(liteLLM_SpendReservations)
				.set({ status: "released", updated_at: new Date() })
				.where(
					and(eq(liteLLM_SpendReservations.request_id, logEntry.request_id), eq(liteLLM_SpendReservations.status, "reserved")),
				);
			await removeActiveRequestIfSupported(db, logEntry.request_id);
		} catch (releaseError) {
			logger.error("SpendLog 提交失败后清理活跃请求与 reservation 失败", {
				error: releaseError,
				requestId: logEntry.request_id,
			});
		}
		if (error instanceof ApiError) {
			throw error;
		}
		throw ApiError.unavailable("花费账务数据库暂不可用");
	}
	logger.debug(`花费已记录: ${logEntry.request_id} spend=${spend}`);
	return result;
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
