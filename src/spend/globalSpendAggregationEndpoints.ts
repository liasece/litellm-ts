/**
 * /global/spend* 聚合端点（spend/keys/teams/models/providers/report/logs/provider/tags/all_tag_names/end_users）
 *
 * 从 globalSpendEndpoints.ts 拆分出来，专门承载 11 个 /global/spend 前缀的
 * 聚合查询端点。activity 域（/global/activity、/global/activity/model）仍保留在
 * globalSpendEndpoints.ts。main.ts / 单元测试通过 `registerSpendManagementEndpoints`
 * 调用本文件的 `registerGlobalSpendAggregationEndpoints`。
 */

import type { Router } from "express";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "../db/schema";
import { registerRoute } from "../core/api/registerRoute";
import { createModuleLogger } from "../core/utils/logger";
import { spendAggregationRepositoryFor } from "../repositories/SpendAggregationRepository";
import {
	AGGREGATE_DEFAULT_LIMIT,
	DAILY_SPEND_MATRIX_LIMIT,
	getInternalUserId,
	parseAggregateLimitParam,
	runWithFallback,
} from "./spendManagementHelpers";
import { normalizeTagSpendRow, toDateString, toFiniteNumber, toSafeString } from "./spendManagementFormatters";

const logger = createModuleLogger("GlobalSpendAggregation");

/**
 * 注册 /global/spend* 聚合端点（spend/keys/teams/models/providers/report/logs/provider/tags/all_tag_names/end_users）。
 * @param router - 鉴权后 Express Router
 * @param db - Drizzle 数据库实例
 */
export function registerGlobalSpendAggregationEndpoints(router: Router, db: NodePgDatabase<typeof schema>): void {
	// ========== /global/spend ==========

	registerRoute(router, { method: "get", path: "/global/spend" }, async () => {
		const totals = await spendAggregationRepositoryFor(db).globalTotals();

		// 表为空时聚合函数已由 SQL 的 COALESCE 归零；这里只兜底「一行都没返回」的情况。
		return totals ?? { total_spend: 0, total_prompt_tokens: 0, total_completion_tokens: 0 };
	});

	// ========== /global/spend/keys ==========
	// WebUI adminTopKeysCall 直接消费：k["api_key"].substring(0, 10); k["total_spend"].toFixed(2)
	// 必须保证 api_key 字符串、total_spend 数字、key_alias 兜底空字符串

	registerRoute(router, { method: "get", path: "/global/spend/keys" }, async () => {
		return runWithFallback(
			logger,
			"/global/spend/keys",
			[] as { api_key: string; key_alias: null; total_spend: number; total_tokens: number }[],
			async () => {
				const result = await spendAggregationRepositoryFor(db).spendByApiKey();

				return result.map((row) => ({
					api_key: toSafeString(row.api_key),
					key_alias: null,
					total_spend: toFiniteNumber(row.total_spend),
					total_tokens: toFiniteNumber(row.total_tokens),
				}));
			},
		);
	});

	// ========== /global/spend/teams ==========
	// WebUI 期望形状：
	//   teams: string[]               （BarChart categories，需为字符串数组）
	//   total_spend_per_team: Array<{ team_id, total_spend, total_tokens }>
	//   daily_spend: Array<{ date: 'YYYY-MM-DD', [team_id: string]: number }>
	//     每项必须含 date 字符串与每个 team_id 字段的 finite number，确保 BarChart y 非 NaN。

	registerRoute(router, { method: "get", path: "/global/spend/teams" }, async () =>
		runWithFallback(logger, "/global/spend/teams", { daily_spend: [], teams: [], total_spend_per_team: [] }, async () => {
			const aggregate = await spendAggregationRepositoryFor(db).teamSpendTotals(AGGREGATE_DEFAULT_LIMIT);

			// WebUI 把 teams 直接作为 BarChart categories，必须为字符串数组
			const teams: string[] = aggregate.map((row) => toSafeString(row.team_id));

			// 按日期 + team 聚合，得到 daily_spend 矩阵
			const dailyRows = await spendAggregationRepositoryFor(db).teamDailySpend(DAILY_SPEND_MATRIX_LIMIT);

			// 把 dailyRows 聚合成 date -> { date, team_id1: spend, team_id2: spend, ... }
			const dailyMap = new Map<string, Record<string, number | string>>();
			for (const row of dailyRows) {
				const dateStr = toSafeString(row.date);
				const teamKey = toSafeString(row.team_id);
				if (!dateStr || !teamKey) {
					continue;
				}
				const entry = dailyMap.get(dateStr) ?? { date: dateStr };
				entry[teamKey] = toFiniteNumber(row.spend);
				dailyMap.set(dateStr, entry);
			}
			const daily_spend = Array.from(dailyMap.values()).sort((a, b) => toSafeString(a.date).localeCompare(toSafeString(b.date)));

			const total_spend_per_team = aggregate.map((row) => ({
				team_id: toSafeString(row.team_id),
				total_spend: toFiniteNumber(row.total_spend),
				total_tokens: toFiniteNumber(row.total_tokens),
			}));

			return {
				daily_spend: daily_spend,
				teams: teams,
				total_spend_per_team: total_spend_per_team,
			};
		}),
	);

	// ========== /global/spend/models ==========
	// WebUI adminTopModelsCall 直接消费：k["model"]; formatNumberWithCommas(k["total_spend"], 2)
	// 必须保证 model 字符串、total_spend 数字

	registerRoute(router, { method: "get", path: "/global/spend/models" }, async (req) => {
		const limit = parseAggregateLimitParam(req.query.limit);
		return runWithFallback(
			logger,
			"/global/spend/models",
			[] as { model: string; total_spend: number; total_tokens: number }[],
			async () => {
				const result = await spendAggregationRepositoryFor(db).spendByModel(limit);

				return result.map((row) => ({
					model: toSafeString(row.model),
					total_spend: toFiniteNumber(row.total_spend),
					total_tokens: toFiniteNumber(row.total_tokens),
				}));
			},
		);
	});

	// ========== /global/spend/providers ==========

	registerRoute(router, { method: "get", path: "/global/spend/providers" }, async () =>
		runWithFallback(
			logger,
			"/global/spend/providers",
			[] as { provider: string; total_spend: number; total_tokens: number }[],
			async () => {
				const result = await spendAggregationRepositoryFor(db).spendByProvider(AGGREGATE_DEFAULT_LIMIT);

				return result.map((row) => ({
					provider: toSafeString(row.provider),
					total_spend: toFiniteNumber(row.total_spend),
					total_tokens: toFiniteNumber(row.total_tokens),
				}));
			},
		),
	);

	// ========== /global/spend/report ==========

	registerRoute(router, { method: "get", path: "/global/spend/report" }, async (req) => {
		const startDate = (req.query.start_date as string) ?? "";
		const endDate = (req.query.end_date as string) ?? "";

		// 端点只决定「哪个边界存在」；区间比较的 SQL 结构留在仓储，避免两端各写一份比较符。
		const startBound = startDate ? new Date(startDate) : undefined;
		const endBound = endDate ? new Date(endDate) : undefined;
		const result = await spendAggregationRepositoryFor(db).spendReportByModel(startBound, endBound, AGGREGATE_DEFAULT_LIMIT);

		const safeReport = result.map((row) => ({
			model: toSafeString(row.model),
			total_spend: toFiniteNumber(row.total_spend),
			total_tokens: toFiniteNumber(row.total_tokens),
			totalRequests: toFiniteNumber((row as Record<string, unknown>).totalRequests),
		}));

		return {
			report: safeReport,
			total: safeReport.length,
		};
	});

	// ========== /global/spend/logs ==========
	// 对齐 Python global_spend_logs（spend_management_endpoints.py）：
	// 从 "MonthlyGlobalSpend" 视图读取，视图定义（create_views.py）：
	//   SELECT DATE("startTime") AS date, SUM("spend") AS spend
	//   FROM "LiteLLM_SpendLogs"
	//   WHERE "startTime" >= (CURRENT_DATE - INTERVAL '30 days')
	//   GROUP BY DATE("startTime") ORDER BY "date";
	// 行为契约：
	//   - 只返回近 30 天内有数据的日期，每项仅 {date, spend}，不做零填充
	//   - api_key 过滤对齐 "MonthlyGlobalSpendPerKey"：行内补 api_key 字段
	//   - internal_user 对齐 "MonthlyGlobalSpendPerUserPerKey"：行内补 api_key/user 字段

	registerRoute(router, { method: "get", path: "/global/spend/logs" }, async (req) => {
		const apiKey = typeof req.query.api_key === "string" ? req.query.api_key : undefined;
		const internalUserId = getInternalUserId(req.auth);

		return runWithFallback(logger, "/global/spend/logs", [] as Array<Record<string, unknown>>, async () => {
			const rows = await spendAggregationRepositoryFor(db).dailySpendForLast30Days(apiKey, internalUserId);

			// 响应字段随过滤维度收窄：无过滤只有 date/spend，传 key 补 api_key，internal_user
			// 再补 user（对应 Python 的三个 MonthlyGlobalSpend* 视图）。这里保留分支是为了让
			// 返回的键集合与视图一致，不能统一塞满四个字段。
			if (internalUserId !== undefined) {
				return rows.map((row) => ({
					date: toDateString(row.date),
					spend: toFiniteNumber(row.spend),
					api_key: toSafeString(row.api_key),
					user: toSafeString(row.user),
				}));
			}

			if (apiKey !== undefined) {
				return rows.map((row) => ({
					date: toDateString(row.date),
					spend: toFiniteNumber(row.spend),
					api_key: toSafeString(row.api_key),
				}));
			}

			return rows.map((row) => ({
				date: toDateString(row.date),
				spend: toFiniteNumber(row.spend),
			}));
		});
	});

	// ========== /global/spend/provider (单数形式) ==========
	// WebUI usage.tsx 渲染 spendByProvider.map(provider => { provider.spend.toFixed(2) })
	// 期望每项：{ provider: string, spend: number }
	// Python 真实行为：[{ provider, spend }]

	registerRoute(router, { method: "get", path: "/global/spend/provider" }, async (req) => {
		const startDate = req.query.start_date as string | undefined;
		const endDate = req.query.end_date as string | undefined;

		const startBound = startDate && endDate ? new Date(startDate) : undefined;
		const endBound = startDate && endDate ? new Date(endDate) : undefined;

		return runWithFallback(
			logger,
			"/global/spend/provider",
			[] as { provider: string; spend: number; total_spend: number }[],
			async () => {
				const result = await spendAggregationRepositoryFor(db).spendByProviderInRange(
					startBound,
					endBound,
					AGGREGATE_DEFAULT_LIMIT,
				);

				return result.map((row) => ({
					provider: toSafeString(row.provider),
					spend: toFiniteNumber(row.total_spend),
					total_spend: toFiniteNumber(row.total_spend),
				}));
			},
		);
	});

	// ========== /global/spend/tags (带日期过滤) ==========
	// WebUI 期望：{ spend_per_tag: [] }
	//   spend_per_tag 每项：{ name, spend, tag, total_spend, total_tokens }
	//   BarChart index="name" categories=["spend"]，name/spend 必须为字符串/有限数字，
	//   否则 y=NaN。

	registerRoute(router, { method: "get", path: "/global/spend/tags" }, async (req) => {
		const startDate = req.query.start_date as string | undefined;
		const endDate = req.query.end_date as string | undefined;

		// 只有起止日期同时存在才收窄（空串按缺省处理），与 Python 标签报表一致。
		const startBound = startDate && endDate ? new Date(startDate) : undefined;
		const endBound = startDate && endDate ? new Date(endDate) : undefined;
		return runWithFallback(
			logger,
			"/global/spend/tags",
			{ spend_per_tag: [] as { name: string; spend: number; tag: string; total_spend: number; total_tokens: number }[] },
			async () => {
				const result = await spendAggregationRepositoryFor(db).spendByTag(startBound, endBound, AGGREGATE_DEFAULT_LIMIT);

				const spend_per_tag = result.map((row) => normalizeTagSpendRow(row));

				return { spend_per_tag: spend_per_tag };
			},
		);
	});

	// ========== /global/spend/all_tag_names ==========

	registerRoute(router, { method: "get", path: "/global/spend/all_tag_names" }, async () => {
		const result = await spendAggregationRepositoryFor(db).requestTagNames(AGGREGATE_DEFAULT_LIMIT);

		return { tag_names: result.map((row) => row.tag) };
	});

	// ========== /global/spend/end_users (POST) ==========
	// WebUI 期望：数组

	registerRoute(router, { method: "post", path: "/global/spend/end_users" }, async (req) => {
		const body = req.body ?? {};
		const startTime = body.startTime as string | undefined;
		const endTime = body.endTime as string | undefined;

		// 与标签报表相同：起止时间必须成对出现，单侧（或空串）按缺省处理。
		const startBound = startTime && endTime ? new Date(startTime) : undefined;
		const endBound = startTime && endTime ? new Date(endTime) : undefined;
		return runWithFallback(
			logger,
			"/global/spend/end_users",
			[] as { end_user: string; total_spend: number; total_tokens: number }[],
			async () => {
				const result = await spendAggregationRepositoryFor(db).spendByEndUser(startBound, endBound, AGGREGATE_DEFAULT_LIMIT);

				return result.map((row) => ({
					end_user: toSafeString(row.end_user),
					total_spend: toFiniteNumber(row.total_spend),
					total_tokens: toFiniteNumber(row.total_tokens),
				}));
			},
		);
	});
}
