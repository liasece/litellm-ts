/**
 * /global/activity 域端点（activity、activity/model）
 *
 * 从 SpendManagementEndpoint.ts 拆分出来，把 12 个 global 域端点
 * 集中在一个文件里，main.ts 与单元测试仍通过 `registerSpendManagementEndpoints`
 * 间接调用本文件的 `registerGlobalSpendEndpoints`。其余 11 个 /global/spend*
 * 聚合端点已迁出到 globalSpendAggregationEndpoints.ts，本文件仅保留 activity 域。
 */

import type { Router } from "express";
import { sql, and, asc } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "../db/schema";
import { liteLLM_SpendLogs } from "../db/schema/spendLogs";
import { registerRoute } from "../core/api/registerRoute";
import { ApiError, HTTP_STATUS } from "../core/api/ApiError";
import type { UserAPIKeyAuth } from "../types/auth";
import { INTERNAL_USER_ROLE, INTERNAL_USER_VIEWER_ROLE } from "../types/webUiSession";
import { AGGREGATE_DEFAULT_LIMIT } from "./spendManagementHelpers";
import { toFiniteNumber, toPythonMonthDayString, toSafeString } from "./spendManagementFormatters";
import { registerGlobalSpendAggregationEndpoints } from "./globalSpendAggregationEndpoints";

/**
 * Python LiteLLM internal user / viewer 角色可见范围：只能看自己的 spend。
 * @param auth
 */
function getInternalUserId(auth: UserAPIKeyAuth | undefined): string | undefined {
	if (!auth || !auth.user_id) {
		return undefined;
	}
	if (auth.user_role === INTERNAL_USER_ROLE || auth.user_role === INTERNAL_USER_VIEWER_ROLE) {
		return auth.user_id;
	}
	return undefined;
}

function parseActivityDate(raw: unknown): Date {
	if (typeof raw !== "string" || raw.length === 0) {
		throw new ApiError(HTTP_STATUS.BAD_REQUEST, "Please provide start_date and end_date");
	}
	const parsed = new Date(`${raw}T00:00:00Z`);
	if (!Number.isFinite(parsed.getTime())) {
		throw new ApiError(HTTP_STATUS.BAD_REQUEST, "Invalid date format. Expected: YYYY-MM-DD");
	}
	return parsed;
}

function buildActivityDateWhere(startDate: Date, endDate: Date, auth: UserAPIKeyAuth | undefined): ReturnType<typeof and> {
	const endExclusive = new Date(endDate.getTime());
	endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
	const conditions = [sql`${liteLLM_SpendLogs.startTime} >= ${startDate}`, sql`${liteLLM_SpendLogs.startTime} < ${endExclusive}`];
	const internalUserId = getInternalUserId(auth);
	if (internalUserId !== undefined) {
		conditions.push(sql`${liteLLM_SpendLogs.user} = ${internalUserId}`);
	}
	return and(...conditions);
}

/**
 * 注册 /global/* 端点（activity/activity/model + spend* 聚合端点）。
 * @param router - 鉴权后 Express Router
 * @param db - Drizzle 数据库实例
 */
export function registerGlobalSpendEndpoints(router: Router, db: NodePgDatabase<typeof schema>): void {
	// ========== /global/activity ==========
	// WebUI usage.tsx fetchGlobalActivity 期望 Python 形状：
	//   { daily_data: [...], sum_api_requests, sum_total_tokens }
	// daily_data 每项：{ date, api_requests, total_tokens }
	// 顶层 sum_* 用于 All Up 卡片标题（Tremor valueFormatter 直接取数），必须为 finite number。

	registerRoute(router, { method: "get", path: "/global/activity" }, async (req) => {
		const startDate = parseActivityDate(req.query.start_date);
		const endDate = parseActivityDate(req.query.end_date);
		const whereClause = buildActivityDateWhere(startDate, endDate, req.auth);

		const result = await db
			.select({
				date: sql<string>`DATE(${liteLLM_SpendLogs.startTime})`,
				api_requests: sql<number>`COUNT(*)`,
				total_tokens: sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.total_tokens}), 0)`,
			})
			.from(liteLLM_SpendLogs)
			.where(whereClause)
			.groupBy(sql`DATE(${liteLLM_SpendLogs.startTime})`)
			.orderBy(asc(sql`DATE(${liteLLM_SpendLogs.startTime})`));

		let totalTokens = 0;
		let totalRequests = 0;
		const dailyData = result.map((row) => {
			const apiRequests = toFiniteNumber(row.api_requests);
			const rowTotalTokens = toFiniteNumber(row.total_tokens);
			totalRequests += apiRequests;
			totalTokens += rowTotalTokens;
			return {
				date: toPythonMonthDayString(row.date),
				api_requests: apiRequests,
				total_tokens: rowTotalTokens,
			};
		});

		return {
			daily_data: dailyData,
			sum_api_requests: toFiniteNumber(totalRequests),
			sum_total_tokens: toFiniteNumber(totalTokens),
		};
	});

	// ========== /global/activity/model ==========
	// WebUI usage.tsx fetchGlobalActivityPerModel 期望：
	//   Array<{
	//     model: string,
	//     sum_api_requests: number,
	//     sum_total_tokens: number,
	//     sum_spend?: number,
	//     daily_data: Array<{ date: string, api_requests: number, total_tokens: number, spend?: number }>
	//   }>
	// daily_data 字段名必须为 api_requests / total_tokens，Tremor categories=["api_requests", "total_tokens"]
	// 直接读取，否则 y=NaN。

	registerRoute(router, { method: "get", path: "/global/activity/model" }, async (req) => {
		const startDate = parseActivityDate(req.query.start_date);
		const endDate = parseActivityDate(req.query.end_date);
		const whereClause = buildActivityDateWhere(startDate, endDate, req.auth);

		const rows = await db
			.select({
				model_group: liteLLM_SpendLogs.model_group,
				date: sql<string>`DATE(${liteLLM_SpendLogs.startTime})`,
				api_requests: sql<number>`COUNT(*)`,
				total_tokens: sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.total_tokens}), 0)`,
			})
			.from(liteLLM_SpendLogs)
			.where(whereClause)
			.groupBy(liteLLM_SpendLogs.model_group, sql`DATE(${liteLLM_SpendLogs.startTime})`)
			.orderBy(asc(sql`DATE(${liteLLM_SpendLogs.startTime})`))
			.limit(AGGREGATE_DEFAULT_LIMIT);

		const grouped = new Map<
			string,
			{
				model: string;
				sum_api_requests: number;
				sum_total_tokens: number;
				daily_data: { model_group: string; date: string; api_requests: number; total_tokens: number }[];
			}
		>();
		for (const row of rows) {
			const modelKey = toSafeString(row.model_group);
			const apiRequests = toFiniteNumber(row.api_requests);
			const rowTotalTokens = toFiniteNumber(row.total_tokens);
			const entry = grouped.get(modelKey) ?? {
				model: modelKey,
				sum_api_requests: 0,
				sum_total_tokens: 0,
				daily_data: [],
			};
			entry.daily_data.push({
				model_group: modelKey,
				date: toPythonMonthDayString(row.date),
				api_requests: apiRequests,
				total_tokens: rowTotalTokens,
			});
			entry.sum_api_requests += apiRequests;
			entry.sum_total_tokens += rowTotalTokens;
			grouped.set(modelKey, entry);
		}

		return Array.from(grouped.values())
			.sort((left, right) => right.sum_api_requests - left.sum_api_requests)
			.slice(0, 10)
			.map((entry) => ({
				model: entry.model,
				daily_data: entry.daily_data.sort((left, right) => left.date.localeCompare(right.date)),
				sum_api_requests: entry.sum_api_requests,
				sum_total_tokens: entry.sum_total_tokens,
			}));
	});

	// 其余 /global/spend* 聚合端点已迁出到 globalSpendAggregationEndpoints.ts
	registerGlobalSpendAggregationEndpoints(router, db);
}
