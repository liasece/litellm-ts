/**
 * 六张每日花费汇总表（user / team / organization / tag / agent / end_user）的增量写入。
 *
 * 每张表都按 `(主体, date, api_key, model, model_group, custom_llm_provider, mcp, endpoint)`
 * 唯一，结算时对每个主体 upsert 一次并累加 token 与金额。这六张表的列形状一致，只有主体
 * 列名不同，因此维度解析（`user` → `LiteLLM_DailyUserSpend.user_id` 等）集中在本仓库：
 * 调用方只说「哪个维度、主体值是什么」，不再接触 drizzle 表对象。
 *
 * 汇总表按天 × 主体增长，属于流水性质，不做缓存；每次结算都直接写库。
 */

import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { BaseRepository } from "../core/db/BaseRepository";
import type { DrizzleDb } from "../core/db/Database";
import { liteLLM_DailyAgentSpend } from "../db/schema/dailyAgentSpend";
import { liteLLM_DailyEndUserSpend } from "../db/schema/dailyEndUserSpend";
import { liteLLM_DailyOrganizationSpend } from "../db/schema/dailyOrganizationSpend";
import { liteLLM_DailyTagSpend } from "../db/schema/dailyTagSpend";
import { liteLLM_DailyTeamSpend } from "../db/schema/dailyTeamSpend";
import { liteLLM_DailyUserSpend } from "../db/schema/dailyUserSpend";
import { SpendLogStatus } from "../types/spend";
import { singletonFor } from "./internal/registry";

/** 事务句柄；日汇总写入必须与 SpendLog 插入在同一事务里提交。 */
export type DailySpendTransaction = Parameters<Parameters<DrizzleDb["transaction"]>[0]>[0];

/** 日汇总的唯一维度名；未知维度会抛错，避免静默丢账。 */
export type DailySpendDimension = "user" | "team" | "organization" | "tag" | "agent" | "end_user";

/** 一次增量写入需要用到的请求事实（已由调用方归一与解析）。 */
export interface DailySpendEntry {
	/** 请求 ID；仅 tag 汇总需要写入该列。 */
	readonly requestId: string;
	/** 请求开始时间（ISO 8601），用于派生 UTC 日期。 */
	readonly startTime: string;
	/** 已按 master key 策略保护过的 api key 落库值。 */
	readonly apiKey: string;
	/** 实际执行模型名。 */
	readonly model: string;
	/** 最终实际执行的公共模型组；没有解析结果时为 null。 */
	readonly modelGroup: string | null;
	/** 自定义 provider；缺省时由调用方按模型名解析。 */
	readonly customLlmProvider: string | null;
	/** MCP 命名空间工具名；没有时为 null。 */
	readonly mcpNamespacedToolName: string | null;
	/** 代理请求端点（去掉 query）；无法解析时为 null。 */
	readonly endpoint: string | null;
	/** 归一后的输入 token。 */
	readonly promptTokens: number;
	/** 归一后的输出 token。 */
	readonly completionTokens: number;
	/** 缓存读取 token。 */
	readonly cacheReadInputTokens: number;
	/** 缓存创建 token。 */
	readonly cacheCreationInputTokens: number;
	/** 本次请求的最终状态，用于成功/失败计数。 */
	readonly status: SpendLogStatus;
}

/** 六张汇总表在运行时共享的行形状，用 user 表的列类型统一表达。 */
type DailySpendTable = typeof liteLLM_DailyUserSpend;

/** 可写入的日汇总列。 */
type DailySpendInsertValues = typeof liteLLM_DailyUserSpend.$inferInsert;

/** 维度解析结果：目标表与主体列名。 */
interface DailySpendTarget {
	/** 该维度的汇总表。 */
	readonly table: DailySpendTable;
	/** 该维度的主体列名，同时是唯一约束的第一列。 */
	readonly keyColumn: string;
}

/**
 * 把维度名解析为汇总表与主体列；未知维度直接抛错（与迁移前一致）。
 * @param dimension - 维度名
 * @returns 目标表与主体列名
 * @throws {Error} 维度名不在六个受支持维度中
 */
function resolveDailySpendTarget(dimension: string): DailySpendTarget {
	switch (dimension) {
		case "user":
			return { table: liteLLM_DailyUserSpend, keyColumn: "user_id" };
		case "team":
			return { table: liteLLM_DailyTeamSpend as unknown as DailySpendTable, keyColumn: "team_id" };
		case "organization":
			return { table: liteLLM_DailyOrganizationSpend as unknown as DailySpendTable, keyColumn: "organization_id" };
		case "tag":
			return { table: liteLLM_DailyTagSpend as unknown as DailySpendTable, keyColumn: "tag" };
		case "agent":
			return { table: liteLLM_DailyAgentSpend as unknown as DailySpendTable, keyColumn: "agent_id" };
		case "end_user":
			return { table: liteLLM_DailyEndUserSpend as unknown as DailySpendTable, keyColumn: "end_user_id" };
		default:
			throw new Error(`未知的每日花费维度: ${dimension}`);
	}
}

/**
 * 从请求开始时间提取 UTC 日期（YYYY-MM-DD）。
 * @param startTime - ISO 8601 请求开始时间
 * @returns UTC 日期
 */
function dailySpendDate(startTime: string): string {
	return new Date(startTime).toISOString().slice(0, 10);
}

/**
 * 取得与数据库连接绑定的日汇总仓库。
 * @param db - Drizzle 数据库实例
 */
export const dailySpendRepositoryFor = singletonFor((db: DrizzleDb) => new DailySpendRepository(db));

/** 六张每日花费汇总表的 upsert 入口。 */
export class DailySpendRepository extends BaseRepository {
	/**
	 * @param db - Drizzle 数据库实例（BaseRepository 构造为 protected，显式公开子类构造）
	 */
	constructor(db: DrizzleDb) {
		super(db);
	}

	/**
	 * 对指定维度的汇总行做 upsert 增量累加；主体值为空时跳过。
	 *
	 * 冲突目标是唯一约束的完整列组合（主体 + date + api_key + model + model_group +
	 * custom_llm_provider + mcp + endpoint），命中时累加 token、金额与请求计数。
	 * @param tx - 结算事务句柄
	 * @param dimension - 维度名（user/team/organization/tag/agent/end_user）
	 * @param keyValue - 该维度的主体值；null/undefined 表示本次请求不属于该维度
	 * @param entry - 请求事实
	 * @param spend - 本次实际费用
	 */
	async upsertIncrement(
		tx: DailySpendTransaction,
		dimension: string,
		keyValue: string | null | undefined,
		entry: DailySpendEntry,
		spend: number,
	): Promise<void> {
		if (keyValue === null || keyValue === undefined) {
			return;
		}
		const target = resolveDailySpendTarget(dimension);
		const table = target.table;
		const successfulRequests = entry.status === SpendLogStatus.Success ? 1 : 0;
		const failedRequests = entry.status === SpendLogStatus.Failure ? 1 : 0;
		const updatedAt = new Date();
		const values: Record<string, unknown> = {
			id: randomUUID(),
			[target.keyColumn]: keyValue,
			date: dailySpendDate(entry.startTime),
			api_key: entry.apiKey,
			model: entry.model,
			model_group: entry.modelGroup,
			custom_llm_provider: entry.customLlmProvider,
			mcp_namespaced_tool_name: entry.mcpNamespacedToolName ?? "",
			endpoint: entry.endpoint ?? "",
			prompt_tokens: entry.promptTokens,
			completion_tokens: entry.completionTokens,
			cache_read_input_tokens: entry.cacheReadInputTokens,
			cache_creation_input_tokens: entry.cacheCreationInputTokens,
			spend: spend,
			api_requests: 1,
			successful_requests: successfulRequests,
			failed_requests: failedRequests,
			updated_at: updatedAt,
		};
		if (target.keyColumn === "tag") {
			values["request_id"] = entry.requestId;
		}
		await tx
			.insert(table)
			.values(values as unknown as DailySpendInsertValues)
			.onConflictDoUpdate({
				// GAP (DB-001): drizzle 不把 uniqueIndex 暴露成 table 对象的 `.unq` 属性，
				// 因此显式构造 conflict target，对齐 PY schema.db.spend.py 的唯一约束。
				// DailyUser/Team/Organization/Tag/Agent: (key, date, api_key, model,
				// model_group, custom_llm_provider, mcp, endpoint)
				// DailyEndUser: (end_user_id, date, api_key, model, model_group, ...)
				target: [
					table[target.keyColumn as keyof typeof table] as never,
					table.date,
					table.api_key,
					table.model,
					table.model_group,
					table.custom_llm_provider,
					table.mcp_namespaced_tool_name,
					table.endpoint,
				] as never,
				set: {
					prompt_tokens: sql`${table.prompt_tokens} + ${entry.promptTokens}`,
					completion_tokens: sql`${table.completion_tokens} + ${entry.completionTokens}`,
					cache_read_input_tokens: sql`${table.cache_read_input_tokens} + ${entry.cacheReadInputTokens}`,
					cache_creation_input_tokens: sql`${table.cache_creation_input_tokens} + ${entry.cacheCreationInputTokens}`,
					spend: sql`COALESCE(${table.spend}, 0) + ${spend}`,
					api_requests: sql`${table.api_requests} + 1`,
					successful_requests: sql`${table.successful_requests} + ${successfulRequests}`,
					failed_requests: sql`${table.failed_requests} + ${failedRequests}`,
					updated_at: updatedAt,
				},
			});
	}
}
