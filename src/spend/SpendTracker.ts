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
import { sql } from "drizzle-orm";
import type { SpendLog } from "../types/spend";
import type { ModelResponse, ModelResponseStream, Usage } from "../types/openai";
import { costPerToken } from "../cost/CostCalculator";
import { createModuleLogger } from "../core/utils/logger";

const logger = createModuleLogger("SpendTracker");

// ========== 辅助函数 ==========

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
			api_key: log.api_key,
			model: model,
			custom_llm_provider: provider,
			prompt_tokens: log.prompt_tokens,
			completion_tokens: log.completion_tokens,
			spend: spend,
			api_requests: 1,
			successful_requests: 1,
			failed_requests: 0,
		})
		.onConflictDoUpdate({
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			target: (table as any).unq as any,
			set: {
				prompt_tokens: sql`${table.prompt_tokens} + ${log.prompt_tokens}`,
				completion_tokens: sql`${table.completion_tokens} + ${log.completion_tokens}`,
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
		default:
			throw new Error(`未知的键列维度: ${dimension}`);
	}
}

// ========== 公开 API ==========

/**
 * 记录一条花费日志
 *
 * 写入 LiteLLM_SpendLogs 表并更新所有相关 DailySpend 表。
 * @param db - Drizzle 数据库实例
 * @param logEntry - 花费日志条目
 */
export async function trackSpendLog(db: NodePgDatabase<typeof schema>, logEntry: SpendLog): Promise<void> {
	const { totalCost: spend } = costPerToken(logEntry.model, logEntry.prompt_tokens, logEntry.completion_tokens);

	const insertData: typeof liteLLM_SpendLogs.$inferInsert = {
		request_id: logEntry.request_id,
		call_type: logEntry.call_type || "acompletion",
		api_key: logEntry.api_key || "",
		spend: spend,
		total_tokens: logEntry.total_tokens,
		prompt_tokens: logEntry.prompt_tokens,
		completion_tokens: logEntry.completion_tokens,
		startTime: new Date(logEntry.startTime),
		endTime: new Date(logEntry.endTime),
		model: logEntry.model || "",
		model_group: logEntry.model_group || "",
		custom_llm_provider: extractProvider(logEntry.model),
		user: logEntry.user || "",
		metadata: (logEntry.metadata as Record<string, unknown>) ?? {},
		response: {},
		messages: {},
		// eslint-disable-next-line camelcase
		session_id: logEntry.session_id ?? null,
		request_duration_ms: logEntry.request_duration_ms ?? null,
		status: logEntry.status ?? null,
		// eslint-disable-next-line camelcase
		cache_hit: logEntry.cache_hit ? "true" : null,
		organization_id: logEntry.organization_id ?? null,
		request_tags: (logEntry.tag ? [{ tag: logEntry.tag }] : []) as unknown as Record<string, unknown>[],
		// eslint-disable-next-line camelcase
		agent_id: logEntry.agent_id ?? null,
	};

	await db.insert(liteLLM_SpendLogs).values(insertData);

	// 更新各维度每日汇总
	await Promise.allSettled([
		upsertDailySpend(db, liteLLM_DailyUserSpend, "user_id", logEntry.user ?? null, logEntry, spend),
		upsertDailySpend(db, liteLLM_DailyTeamSpend, "team_id", logEntry.team_id ?? null, logEntry, spend),
		upsertDailySpend(db, liteLLM_DailyOrganizationSpend, "organization_id", logEntry.organization_id ?? null, logEntry, spend),
		upsertDailySpend(db, liteLLM_DailyTagSpend, "tag", logEntry.tag ?? null, logEntry, spend),
		upsertDailySpend(db, liteLLM_DailyAgentSpend, "agent_id", logEntry.agent_id ?? null, logEntry, spend),
	]);

	logger.debug(`花费已记录: ${logEntry.request_id} spend=${spend}`);
}

/**
 * 计算并设置响应的花费
 *
 * 调用 costPerToken 计算费用并写入 response.usage.cost。
 * 兼容 OpenAI 和 Anthropic 两种字段命名方式。
 * @param response - ModelResponse 或 ModelResponseStream
 * @param model - 模型名称
 */
export function calculateAndSetCost(response: ModelResponse | ModelResponseStream, model: string): void {
	const usage = (response as ModelResponse).usage as Usage | undefined;
	if (usage === undefined) {
		return;
	}

	const promptTokens = usage.prompt_tokens ?? 0;
	const completionTokens = usage.completion_tokens ?? 0;
	const cachedTokens = usage.prompt_tokens_details?.cached_tokens ?? 0;
	const { totalCost } = costPerToken(model, promptTokens, completionTokens, 0, cachedTokens);

	// 在 usage 上设置 cost
	(usage as Usage & { cost?: number }).cost = totalCost;
}
