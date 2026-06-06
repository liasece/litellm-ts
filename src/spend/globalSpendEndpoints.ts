/* eslint-disable camelcase */
/**
 * /global/activity 域端点（activity、activity/model）
 *
 * 从 SpendManagementEndpoint.ts 拆分出来，把 12 个 global 域端点
 * 集中在一个文件里，main.ts 与单元测试仍通过 `registerSpendManagementEndpoints`
 * 间接调用本文件的 `registerGlobalSpendEndpoints`。其余 11 个 /global/spend*
 * 聚合端点已迁出到 globalSpendAggregationEndpoints.ts，本文件仅保留 activity 域。
 */

import type { Router } from "express";
import { sql, and, desc } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "../db/schema";
import { liteLLM_SpendLogs } from "../db/schema/spendLogs";
import { registerRoute } from "../core/api/registerRoute";
import { createModuleLogger } from "../core/utils/logger";
import { AGGREGATE_DEFAULT_LIMIT, GLOBAL_ACTIVITY_DAY_LIMIT, runWithFallback } from "./spendManagementHelpers";
import { toFiniteNumber, toSafeString } from "./spendManagementFormatters";
import { registerGlobalSpendAggregationEndpoints } from "./globalSpendAggregationEndpoints";

const logger = createModuleLogger("GlobalSpend");

/** /global/activity 空态兜底（sum_* 必须为 finite number，避免 Tremor BarChart y=NaN） */
const EMPTY_ACTIVITY_RESPONSE = {
	daily_data: [] as { date: string; api_requests: number; total_tokens: number; total_spend: number }[],
	total_spend: 0,
	total_tokens: 0,
	api_requests: 0,
	sum_api_requests: 0,
	sum_total_tokens: 0,
	sum_total_spend: 0,
};

/**
 * 注册 /global/* 端点（activity/activity/model + spend* 聚合端点）。
 * @param router - 鉴权后 Express Router
 * @param db - Drizzle 数据库实例
 */
export function registerGlobalSpendEndpoints(router: Router, db: NodePgDatabase<typeof schema>): void {
	// ========== /global/activity ==========
	// WebUI usage.tsx fetchGlobalActivity 期望形状：
	//   { daily_data: [...], total_spend, total_tokens, api_requests,
	//     sum_api_requests, sum_total_tokens, sum_total_spend }
	// daily_data 每项：{ date, api_requests, total_tokens, total_spend }
	// 顶层 sum_* 用于 All Up 卡片标题（Tremor valueFormatter 直接取数），必须为 finite number，
	// 避免 BarChart y=NaN 报错。
	// 真实查询失败时兜底同形状，避免 .length/.toFixed 崩溃。

	registerRoute(router, { method: "get", path: "/global/activity" }, async () =>
		runWithFallback(logger, "/global/activity", EMPTY_ACTIVITY_RESPONSE, async () => {
			const result = await db
				.select({
					date: sql<string>`DATE(${liteLLM_SpendLogs.startTime})`,
					api_requests: sql<number>`COUNT(*)`,
					total_tokens: sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.total_tokens}), 0)`,
					total_spend: sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.spend}), 0)`,
				})
				.from(liteLLM_SpendLogs)
				.groupBy(sql`DATE(${liteLLM_SpendLogs.startTime})`)
				.orderBy(desc(sql`DATE(${liteLLM_SpendLogs.startTime})`))
				.limit(GLOBAL_ACTIVITY_DAY_LIMIT);

			let totalSpend = 0;
			let totalTokens = 0;
			let totalRequests = 0;
			const dailyData = result.map((row) => {
				const apiRequests = toFiniteNumber(row.api_requests);
				const rowTotalTokens = toFiniteNumber(row.total_tokens);
				const rowTotalSpend = toFiniteNumber(row.total_spend);
				totalRequests += apiRequests;
				totalTokens += rowTotalTokens;
				totalSpend += rowTotalSpend;
				return {
					date: toSafeString(row.date),
					api_requests: apiRequests,
					total_tokens: rowTotalTokens,
					total_spend: rowTotalSpend,
				};
			});

			return {
				daily_data: dailyData,
				total_spend: toFiniteNumber(totalSpend),
				total_tokens: toFiniteNumber(totalTokens),
				api_requests: toFiniteNumber(totalRequests),
				sum_api_requests: toFiniteNumber(totalRequests),
				sum_total_tokens: toFiniteNumber(totalTokens),
				sum_total_spend: toFiniteNumber(totalSpend),
			};
		}),
	);

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
		const startDate = req.query.start_date as string | undefined;
		const endDate = req.query.end_date as string | undefined;

		let whereClause: ReturnType<typeof sql> | ReturnType<typeof and> | undefined;
		if (startDate && endDate) {
			whereClause = and(
				sql`${liteLLM_SpendLogs.startTime} >= ${new Date(startDate)}`,
				sql`${liteLLM_SpendLogs.startTime} <= ${new Date(endDate)}`,
			);
		}

		return runWithFallback(
			logger,
			"/global/activity/model",
			[] as {
				model: string;
				sum_api_requests: number;
				sum_total_tokens: number;
				sum_spend: number;
				daily_data: { date: string; api_requests: number; total_tokens: number; spend: number }[];
			}[],
			async () => {
				const rows = await db
					.select({
						model: liteLLM_SpendLogs.model,
						date: sql<string>`DATE(${liteLLM_SpendLogs.startTime})`,
						api_requests: sql<number>`COUNT(*)`,
						total_tokens: sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.total_tokens}), 0)`,
						spend: sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.spend}), 0)`,
					})
					.from(liteLLM_SpendLogs)
					.where(whereClause)
					.groupBy(liteLLM_SpendLogs.model, sql`DATE(${liteLLM_SpendLogs.startTime})`)
					.orderBy(desc(sql`DATE(${liteLLM_SpendLogs.startTime})`))
					.limit(AGGREGATE_DEFAULT_LIMIT);

				// 按 model 聚合，daily_data 数组
				const grouped = new Map<
					string,
					{
						model: string;
						sum_api_requests: number;
						sum_total_tokens: number;
						sum_spend: number;
						daily_data: {
							date: string;
							api_requests: number;
							total_tokens: number;
							spend: number;
						}[];
					}
				>();
				for (const row of rows) {
					const modelKey = toSafeString(row.model);
					const apiRequests = toFiniteNumber(row.api_requests);
					const rowTotalTokens = toFiniteNumber(row.total_tokens);
					const rowSpend = toFiniteNumber(row.spend);
					const entry =
						grouped.get(modelKey) ??
						({
							model: modelKey,
							sum_api_requests: 0,
							sum_total_tokens: 0,
							sum_spend: 0,
							daily_data: [],
						} as {
							model: string;
							sum_api_requests: number;
							sum_total_tokens: number;
							sum_spend: number;
							daily_data: {
								date: string;
								api_requests: number;
								total_tokens: number;
								spend: number;
							}[];
						});
					entry.daily_data.push({
						date: toSafeString(row.date),
						api_requests: apiRequests,
						total_tokens: rowTotalTokens,
						spend: rowSpend,
					});
					entry.sum_api_requests += apiRequests;
					entry.sum_total_tokens += rowTotalTokens;
					entry.sum_spend += rowSpend;
					grouped.set(modelKey, entry);
				}
				return Array.from(grouped.values());
			},
		);
	});

	// 其余 /global/spend* 聚合端点已迁出到 globalSpendAggregationEndpoints.ts
	registerGlobalSpendAggregationEndpoints(router, db);
}
