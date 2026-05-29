/**
 * 花费管理端点
 *
 * 提供 LiteLLM Proxy 兼容的花费查询 API。
 * 使用 Drizzle ORM 查询 liteLLM_SpendLogs 表。
 */

import type { Router, Request, Response } from "express";
import { eq, sql, count, and, desc } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "../db/schema";
import { liteLLM_SpendLogs } from "../db/schema/spendLogs";
import { registerRoute } from "../core/api/registerRoute";
import { createModuleLogger } from "../core/utils/logger";
import { costPerToken } from "../cost/CostCalculator";

const logger = createModuleLogger("SpendMgmt");

/**
 * 注册所有花费管理端点
 * @param router - Express Router 实例
 * @param db - Drizzle 数据库实例
 * @param _requireAuth - 可选的认证中间件
 */
export function registerSpendManagementEndpoints(
	router: Router,
	db: NodePgDatabase<typeof schema>,
	_requireAuth?: (req: Request, res: Response, next: () => void) => void,
): void {
	logger.info("注册花费管理端点");

	// ========== /spend/keys ==========

	registerRoute(router, { method: "get", path: "/spend/keys" }, async (req) => {
		const result = await db
			.select({
				api_key: liteLLM_SpendLogs.api_key,
				total_spend: sql<number>`SUM(${liteLLM_SpendLogs.spend})`,
				total_tokens: sql<number>`SUM(${liteLLM_SpendLogs.total_tokens})`,
			})
			.from(liteLLM_SpendLogs)
			.groupBy(liteLLM_SpendLogs.api_key)
			.limit(100);

		return { keys: result, total: result.length };
	});

	// ========== /spend/users ==========

	registerRoute(router, { method: "get", path: "/spend/users" }, async (req) => {
		const result = await db
			.select({
				user: liteLLM_SpendLogs.user,
				total_spend: sql<number>`SUM(${liteLLM_SpendLogs.spend})`,
				total_tokens: sql<number>`SUM(${liteLLM_SpendLogs.total_tokens})`,
			})
			.from(liteLLM_SpendLogs)
			.where(sql`${liteLLM_SpendLogs.user} IS NOT NULL AND ${liteLLM_SpendLogs.user} != ''`)
			.groupBy(liteLLM_SpendLogs.user)
			.limit(100);

		return { users: result, total: result.length };
	});

	// ========== /spend/tags ==========

	registerRoute(router, { method: "get", path: "/spend/tags" }, async (req) => {
		const result = await db
			.select({
				tag: liteLLM_SpendLogs.request_tags,
				total_spend: sql<number>`SUM(${liteLLM_SpendLogs.spend})`,
				total_tokens: sql<number>`SUM(${liteLLM_SpendLogs.total_tokens})`,
			})
			.from(liteLLM_SpendLogs)
			.where(sql`${liteLLM_SpendLogs.request_tags} IS NOT NULL`)
			.groupBy(liteLLM_SpendLogs.request_tags)
			.limit(100);

		return { tags: result, total: result.length };
	});

	// ========== /spend/logs ==========

	registerRoute(router, { method: "get", path: "/spend/logs" }, async (req) => {
		const page = Math.max(1, parseInt(req.query.page as string) || 1);
		const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 50));
		const apiKeyFilter = req.query.api_key as string | undefined;
		const userIdFilter = req.query.user_id as string | undefined;

		const conditions = [];
		if (apiKeyFilter) {
			conditions.push(eq(liteLLM_SpendLogs.api_key, apiKeyFilter));
		}
		if (userIdFilter) {
			conditions.push(eq(liteLLM_SpendLogs.user, userIdFilter));
		}

		const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

		const totalResult = await db.select({ count: count() }).from(liteLLM_SpendLogs).where(whereClause);

		const total = totalResult[0]?.count ?? 0;

		const data = await db
			.select()
			.from(liteLLM_SpendLogs)
			.where(whereClause)
			.orderBy(desc(liteLLM_SpendLogs.startTime))
			.limit(pageSize)
			.offset((page - 1) * pageSize);

		return {
			data: data,
			page: page,
			pageSize: pageSize,
			total: total,
			hasMore: page * pageSize < total,
		};
	});

	// ========== /spend/logs/ui/:request_id ==========

	registerRoute(router, { method: "get", path: "/spend/logs/ui/:request_id" }, async (req) => {
		const requestId = req.params.request_id;
		if (!requestId) {
			return null;
		}

		const rows = await db
			.select({ response: liteLLM_SpendLogs.response })
			.from(liteLLM_SpendLogs)
			.where(eq(liteLLM_SpendLogs.request_id, requestId as string))
			.limit(1);

		return rows.at(0)?.response ?? null;
	});

	// ========== /spend/calculate ==========

	registerRoute(router, { method: "post", path: "/spend/calculate" }, async (req) => {
		const body = req.body ?? {};
		const model = (body.model as string) ?? "";
		const promptTokens = (body.prompt_tokens as number) ?? 0;
		const completionTokens = (body.completion_tokens as number) ?? 0;
		const { totalCost } = costPerToken(model, promptTokens, completionTokens);
		return {
			cost: totalCost,
			model: model,
			prompt_tokens: promptTokens,
			completion_tokens: completionTokens,
		};
	});

	// ========== /global/activity ==========

	registerRoute(router, { method: "get", path: "/global/activity" }, async () => {
		const result = await db
			.select({
				date: sql<string>`DATE(${liteLLM_SpendLogs.startTime})`,
				requests: sql<number>`COUNT(*)`,
				spend: sql<number>`SUM(${liteLLM_SpendLogs.spend})`,
			})
			.from(liteLLM_SpendLogs)
			.groupBy(sql`DATE(${liteLLM_SpendLogs.startTime})`)
			.orderBy(desc(sql`DATE(${liteLLM_SpendLogs.startTime})`))
			.limit(30);

		return {
			activity: result,
			total: result.length,
		};
	});

	// ========== /global/spend ==========

	registerRoute(router, { method: "get", path: "/global/spend" }, async () => {
		const result = await db
			.select({
				total_spend: sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.spend}), 0)`,
				total_prompt_tokens: sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.prompt_tokens}), 0)`,
				total_completion_tokens: sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.completion_tokens}), 0)`,
			})
			.from(liteLLM_SpendLogs);

		return result[0] ?? { total_spend: 0, total_prompt_tokens: 0, total_completion_tokens: 0 };
	});

	// ========== /global/spend/keys ==========

	registerRoute(router, { method: "get", path: "/global/spend/keys" }, async () => {
		const result = await db
			.select({
				api_key: liteLLM_SpendLogs.api_key,
				total_spend: sql<number>`SUM(${liteLLM_SpendLogs.spend})`,
				total_tokens: sql<number>`SUM(${liteLLM_SpendLogs.total_tokens})`,
			})
			.from(liteLLM_SpendLogs)
			.groupBy(liteLLM_SpendLogs.api_key)
			.limit(100);

		return { keys: result, total: result.length };
	});

	// ========== /global/spend/teams ==========

	registerRoute(router, { method: "get", path: "/global/spend/teams" }, async () => {
		const result = await db
			.select({
				team_id: liteLLM_SpendLogs.team_id,
				total_spend: sql<number>`SUM(${liteLLM_SpendLogs.spend})`,
				total_tokens: sql<number>`SUM(${liteLLM_SpendLogs.total_tokens})`,
			})
			.from(liteLLM_SpendLogs)
			.where(sql`${liteLLM_SpendLogs.team_id} IS NOT NULL`)
			.groupBy(liteLLM_SpendLogs.team_id)
			.limit(100);

		return { teams: result, total: result.length };
	});

	// ========== /global/spend/models ==========

	registerRoute(router, { method: "get", path: "/global/spend/models" }, async () => {
		const result = await db
			.select({
				model: liteLLM_SpendLogs.model,
				total_spend: sql<number>`SUM(${liteLLM_SpendLogs.spend})`,
				total_tokens: sql<number>`SUM(${liteLLM_SpendLogs.total_tokens})`,
			})
			.from(liteLLM_SpendLogs)
			.groupBy(liteLLM_SpendLogs.model)
			.limit(100);

		return { models: result, total: result.length };
	});

	// ========== /global/spend/providers ==========

	registerRoute(router, { method: "get", path: "/global/spend/providers" }, async () => {
		const result = await db
			.select({
				custom_llm_provider: liteLLM_SpendLogs.custom_llm_provider,
				total_spend: sql<number>`SUM(${liteLLM_SpendLogs.spend})`,
				total_tokens: sql<number>`SUM(${liteLLM_SpendLogs.total_tokens})`,
			})
			.from(liteLLM_SpendLogs)
			.where(sql`${liteLLM_SpendLogs.custom_llm_provider} IS NOT NULL AND ${liteLLM_SpendLogs.custom_llm_provider} != ''`)
			.groupBy(liteLLM_SpendLogs.custom_llm_provider)
			.limit(100);

		return { providers: result, total: result.length };
	});

	// ========== /global/spend/report ==========

	registerRoute(router, { method: "get", path: "/global/spend/report" }, async (req) => {
		const startDate = (req.query.start_date as string) ?? "";
		const endDate = (req.query.end_date as string) ?? "";

		let whereClause;
		if (startDate && endDate) {
			whereClause = and(
				sql`${liteLLM_SpendLogs.startTime} >= ${new Date(startDate)}`,
				sql`${liteLLM_SpendLogs.startTime} <= ${new Date(endDate)}`,
			);
		} else if (startDate) {
			whereClause = sql`${liteLLM_SpendLogs.startTime} >= ${new Date(startDate)}`;
		} else if (endDate) {
			whereClause = sql`${liteLLM_SpendLogs.startTime} <= ${new Date(endDate)}`;
		}

		const result = await db
			.select({
				model: liteLLM_SpendLogs.model,
				total_spend: sql<number>`SUM(${liteLLM_SpendLogs.spend})`,
				total_tokens: sql<number>`SUM(${liteLLM_SpendLogs.total_tokens})`,
				totalRequests: sql<number>`COUNT(*)`,
			})
			.from(liteLLM_SpendLogs)
			.where(whereClause)
			.groupBy(liteLLM_SpendLogs.model)
			.orderBy(desc(sql`SUM(${liteLLM_SpendLogs.spend})`))
			.limit(100);

		return {
			report: result,
			total: result.length,
		};
	});

	// ========== /global/spend/logs ==========

	registerRoute(router, { method: "get", path: "/global/spend/logs" }, async (req) => {
		const page = Math.max(1, parseInt(req.query.page as string) || 1);
		const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 50));

		const totalResult = await db.select({ count: count() }).from(liteLLM_SpendLogs);
		const total = totalResult[0]?.count ?? 0;

		const data = await db
			.select()
			.from(liteLLM_SpendLogs)
			.orderBy(desc(liteLLM_SpendLogs.startTime))
			.limit(pageSize)
			.offset((page - 1) * pageSize);

		return {
			logs: data,
			total: total,
			page: page,
			pageSize: pageSize,
		};
	});
}
