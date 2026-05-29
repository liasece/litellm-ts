/**
 * 花费追踪器
 *
 * 记录每次 API 调用的费用：
 * 1. 插入 LiteLLM_SpendLogs 表
 * 2. 更新 DailySpend 相关表（User/Team/Organization/Tag/Agent）
 * 3. 在响应中注入 x-litellm-response-cost 头
 */

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
import type { SpendLog } from "../types/spend";
import { CallType } from "../types/spend";
import type { ModelResponse, ModelResponseStream, Usage } from "../types/openai";
import { costPerToken } from "../cost/CostCalculator";
import { createModuleLogger } from "../core/utils/logger";
import { hashApiKey } from "../core/utils/crypto";

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
	if (!_masterKeyPlaintext || rawApiKey !== _masterKeyPlaintext) {
		// 非 master key 或未配置 — 原样保留
		return rawApiKey;
	}
	// 是 master key
	if (_disableAddingMasterKeyHashToDb) {
		// GAP 9: PY 用 `MASTER_KEY_ALIAS` 字符串别名（"litellm_proxy_master_key"）
		// 代替 null，让下游 SQL 查询行为一致（spend_tracking_utils.py:55-69）。
		return MASTER_KEY_ALIAS;
	}
	// 默认写入哈希而非明文（避免明文 master key 入库）
	return hashApiKey(rawApiKey);
}

// ========== 辅助函数 ==========

/**
 * DIFF-SPEND-01: 构造 standard_logging_object 字段，对齐 PY
 * `litellm/proxy/spend_tracking/spend_tracking_utils.py:283-446` 的
 * StandardLoggingPayload。
 *
 * 字段命名采用 snake_case 以匹配 PY 消费者（analytics / eval pipeline 跨语言读 JSONB）。
 * @param log
 */
function _buildStandardLoggingObject(log: SpendLog & { spend: number }): Record<string, unknown> {
	return {
		request_id: log.request_id,

		call_type: log.call_type,

		api_key: _protectApiKeyForDb(log.api_key || ""),
		spend: log.spend,

		total_tokens: log.total_tokens,

		prompt_tokens: log.prompt_tokens,

		completion_tokens: log.completion_tokens,
		model: log.model,

		model_group: log.model_group,

		model_id: log.model_id,

		custom_llm_provider: extractProvider(log.model || ""),

		api_base: log.api_base,
		user: log.user,

		team_id: log.team_id,

		organization_id: log.organization_id,

		end_user_id: log.end_user_id,
		// eslint-disable-next-line camelcase
		cache_key: log.cache_key,
		// eslint-disable-next-line camelcase
		cache_hit: log.cache_hit,

		cache_creation_input_tokens: log.cache_creation_input_tokens,

		cache_read_input_tokens: log.cache_read_input_tokens,

		request_tags: log.tags ?? [],
		metadata: (log.metadata as Record<string, unknown>) ?? {},

		request_duration_ms: log.request_duration_ms,
		status: log.status,

		requester_ip_address: log.requester_ip_address,
	};
}

/** 日期格式为 YYYY-MM-DD */
function todayDate(): string {
	const d = new Date();
	const yyyy = d.getFullYear();
	const mm = String(d.getMonth() + 1).padStart(2, "0");
	const dd = String(d.getDate()).padStart(2, "0");
	return `${yyyy}-${mm}-${dd}`;
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

	const date = todayDate();
	const model = log.model || "";
	const provider = extractProvider(model);

	await db
		.insert(table)
		.values({
			[keyColumn]: keyValue,
			date: date,
			// GAP: master key 保护 — 同步在 daily 表中转哈希或置空
			api_key: _protectApiKeyForDb(log.api_key),
			model: model,
			custom_llm_provider: provider,
			prompt_tokens: log.prompt_tokens,
			completion_tokens: log.completion_tokens,
			cache_read_input_tokens: log.cache_read_input_tokens ?? 0,
			cache_creation_input_tokens: log.cache_creation_input_tokens ?? 0,
			spend: spend,
			api_requests: 1,
			successful_requests: 1,
			failed_requests: 0,
		})
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
				successful_requests: sql`${table.successful_requests} + 1`,
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
	// PY: prefer `prompt_tokens`; fall back to `input_tokens` (Anthropic/Responses API)
	const promptTokens =
		(typeof usage["prompt_tokens"] === "number" ? (usage["prompt_tokens"] as number) : undefined) ??
		(typeof usage["input_tokens"] === "number" ? (usage["input_tokens"] as number) : 0);
	// PY: prefer `completion_tokens`; fall back to `output_tokens`
	const completionTokens =
		(typeof usage["completion_tokens"] === "number" ? (usage["completion_tokens"] as number) : undefined) ??
		(typeof usage["output_tokens"] === "number" ? (usage["output_tokens"] as number) : 0);
	// cache fields: prompt_tokens_details.cached_tokens > cache_read_input_tokens
	const promptDetails = usage["prompt_tokens_details"] as Record<string, unknown> | undefined;
	const cacheRead =
		(typeof promptDetails?.["cached_tokens"] === "number" ? (promptDetails["cached_tokens"] as number) : undefined) ??
		(typeof usage["cache_read_input_tokens"] === "number" ? (usage["cache_read_input_tokens"] as number) : 0);
	const cacheCreation =
		(typeof promptDetails?.["cache_creation_tokens"] === "number" ? (promptDetails["cache_creation_tokens"] as number) : undefined) ??
		(typeof usage["cache_creation_input_tokens"] === "number" ? (usage["cache_creation_input_tokens"] as number) : 0);
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
	const modelCostMapEntry = (logEntry as unknown as { model_cost_map?: Record<string, unknown> }).model_cost_map;
	// DIFF-003: 从 SpendLog.usage 透传 reasoning_tokens（如果存在）到 costPerToken。
	// 对齐 PY cost_calculator.py:2093-2098 — completion_tokens -= reasoning_tokens。
	const usageRecord = (logEntry as unknown as { usage?: Record<string, unknown> }).usage;
	const completionDetails =
		(usageRecord?.["completion_tokens_details"] as Record<string, unknown> | undefined) ??
		(logEntry as unknown as { completion_tokens_details?: Record<string, unknown> }).completion_tokens_details ??
		undefined;
	const reasoningTokens =
		typeof completionDetails?.["reasoning_tokens"] === "number" ? (completionDetails["reasoning_tokens"] as number) : 0;
	const { totalCost: spend } = costPerToken(logEntry.model, promptTokens, completionTokens, cacheCreationTokens, cacheReadTokens, {
		modelCostMap: modelCostMapEntry as never,
		reasoningTokens: reasoningTokens,
	});

	const insertData: typeof liteLLM_SpendLogs.$inferInsert = {
		request_id: logEntry.request_id,
		call_type: logEntry.call_type || CallType.ACompletion,
		// GAP 9: master key 保护 — 直接明文 master key 转哈希，或在 disable_adding=true 时
		// 写 `"litellm_proxy_master_key"` 别名（对齐 PY spend_tracking_utils.py:55-69）。
		api_key: _protectApiKeyForDb(logEntry.api_key || ""),
		spend: spend,
		total_tokens: totalTokens,
		prompt_tokens: promptTokens,
		completion_tokens: completionTokens,
		startTime: new Date(logEntry.startTime),
		endTime: new Date(logEntry.endTime),
		completionStartTime: logEntry.completionStartTime ? new Date(logEntry.completionStartTime) : null,
		model: logEntry.model || "",
		model_group: logEntry.model_group || "",
		model_id: logEntry.model_id ?? null,
		custom_llm_provider: extractProvider(logEntry.model),
		api_base: logEntry.api_base ?? null,
		user: logEntry.user || "",
		team_id: logEntry.team_id ?? null,
		organization_id: logEntry.organization_id ?? null,
		// eslint-disable-next-line camelcase
		end_user: logEntry.end_user_id ?? null,
		// eslint-disable-next-line camelcase
		cache_key: logEntry.cache_key ?? null,
		// eslint-disable-next-line camelcase
		cache_hit: logEntry.cache_hit ? "true" : "false",
		requester_ip_address: logEntry.requester_ip_address ?? null,
		proxy_server_request: (logEntry.proxy_server_request as Record<string, unknown>) ?? null,
		metadata: (logEntry.metadata as Record<string, unknown>) ?? {},
		response: {},
		messages: {},
		// eslint-disable-next-line camelcase
		session_id: logEntry.session_id ?? null,
		request_duration_ms: logEntry.request_duration_ms ?? null,
		status: logEntry.status ?? null,
		request_tags: (logEntry.tags ?? []) as unknown as Record<string, unknown>[],
		// eslint-disable-next-line camelcase
		agent_id: logEntry.agent_id ?? null,
		mcp_namespaced_tool_name: logEntry.mcp_namespaced_tool_name ?? null,
		// DIFF-SPEND-01: standard_logging_object JSONB 字段，对齐 PY StandardLoggingPayload
		// （spend_tracking_utils.py:283-446）。下游 analytics / eval pipeline 可直接读这一列。
		// eslint-disable-next-line camelcase
		standard_logging_object: _buildStandardLoggingObject({
			...logEntry,
			prompt_tokens: promptTokens,
			completion_tokens: completionTokens,
			total_tokens: totalTokens,
			cache_creation_input_tokens: cacheCreationTokens,
			cache_read_input_tokens: cacheReadTokens,
			spend: spend,
		}),
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
	await Promise.allSettled([
		upsertDailySpend(db, liteLLM_DailyUserSpend, "user_id", logEntry.user ?? null, normalizedLog, spend),
		upsertDailySpend(db, liteLLM_DailyTeamSpend, "team_id", logEntry.team_id ?? null, normalizedLog, spend),
		upsertDailySpend(db, liteLLM_DailyOrganizationSpend, "organization_id", logEntry.organization_id ?? null, normalizedLog, spend),
		upsertDailySpend(db, liteLLM_DailyTagSpend, "tag", logEntry.tags?.[0] ?? null, normalizedLog, spend),
		upsertDailySpend(db, liteLLM_DailyAgentSpend, "agent_id", logEntry.agent_id ?? null, normalizedLog, spend),
		upsertDailySpend(db, liteLLM_DailyEndUserSpend, "end_user_id", logEntry.end_user_id ?? null, normalizedLog, spend),
	]);

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
	const effectiveCustom = customCostPerToken ?? (response as unknown as { _customCostPerToken?: unknown })._customCostPerToken;
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
