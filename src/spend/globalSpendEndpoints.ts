/**
 * /global/activity 域端点（activity、activity/model）
 *
 * 从 SpendManagementEndpoint.ts 拆分出来，把 12 个 global 域端点
 * 集中在一个文件里，main.ts 与单元测试仍通过 `registerSpendManagementEndpoints`
 * 间接调用本文件的 `registerGlobalSpendEndpoints`。其余 11 个 /global/spend*
 * 聚合端点已迁出到 globalSpendAggregationEndpoints.ts，本文件仅保留 activity 域。
 */

import type { Router } from "express";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "../db/schema";
import { registerRoute } from "../core/api/registerRoute";
import { ApiError, HTTP_STATUS } from "../core/api/ApiError";
import { spendAggregationRepositoryFor } from "../repositories/SpendAggregationRepository";
import { AGGREGATE_DEFAULT_LIMIT, getInternalUserId } from "./spendManagementHelpers";
import { toFiniteNumber, toPythonMonthDayString, toSafeString } from "./spendManagementFormatters";
import { registerGlobalSpendAggregationEndpoints } from "./globalSpendAggregationEndpoints";

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
		// 日期解析与权限判定留在端点：仓储只接收「从哪天到哪天、是否只看自己」。
		const result = await spendAggregationRepositoryFor(db).dailyActivity(startDate, endDate, getInternalUserId(req.auth));

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
		const rows = await spendAggregationRepositoryFor(db).modelDailyActivity(
			startDate,
			endDate,
			AGGREGATE_DEFAULT_LIMIT,
			getInternalUserId(req.auth),
		);

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
