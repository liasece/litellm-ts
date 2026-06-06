/* eslint-disable camelcase */
/**
 * /global/spend* 聚合端点（spend/keys/teams/models/providers/report/logs/provider/tags/all_tag_names/end_users）
 *
 * 从 globalSpendEndpoints.ts 拆分出来，专门承载 11 个 /global/spend 前缀的
 * 聚合查询端点。activity 域（/global/activity、/global/activity/model）仍保留在
 * globalSpendEndpoints.ts。main.ts / 单元测试通过 `registerSpendManagementEndpoints`
 * 调用本文件的 `registerGlobalSpendAggregationEndpoints`。
 */

import type { Router } from "express";
import { sql, and, desc } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "../db/schema";
import { liteLLM_SpendLogs } from "../db/schema/spendLogs";
import { registerRoute } from "../core/api/registerRoute";
import { createModuleLogger } from "../core/utils/logger";
import { AGGREGATE_DEFAULT_LIMIT, DAILY_SPEND_MATRIX_LIMIT, parseAggregateLimitParam, runWithFallback } from "./spendManagementHelpers";
import {
	getCurrentMonthDateRange,
	makeEmptyDailySpendRow,
	mergeWithCurrentMonthPlaceholder,
	normalizeTagSpendRow,
	toDateString,
	toFiniteNumber,
	toSafeString,
} from "./spendManagementFormatters";

const logger = createModuleLogger("GlobalSpendAggregation");

/**
 * 注册 /global/spend* 聚合端点（spend/keys/teams/models/providers/report/logs/provider/tags/all_tag_names/end_users）。
 * @param router - 鉴权后 Express Router
 * @param db - Drizzle 数据库实例
 */
export function registerGlobalSpendAggregationEndpoints(router: Router, db: NodePgDatabase<typeof schema>): void {
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
	// WebUI adminTopKeysCall 直接消费：k["api_key"].substring(0, 10); k["total_spend"].toFixed(2)
	// 必须保证 api_key 字符串、total_spend 数字、key_alias 兜底空字符串

	registerRoute(router, { method: "get", path: "/global/spend/keys" }, async (req) => {
		const limit = parseAggregateLimitParam(req.query.limit);
		return runWithFallback(
			logger,
			"/global/spend/keys",
			[] as { api_key: string; key_alias: null; total_spend: number; total_tokens: number }[],
			async () => {
				const result = await db
					.select({
						api_key: liteLLM_SpendLogs.api_key,
						total_spend: sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.spend}), 0)`,
						total_tokens: sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.total_tokens}), 0)`,
					})
					.from(liteLLM_SpendLogs)
					.groupBy(liteLLM_SpendLogs.api_key)
					.limit(limit);

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
			const aggregate = await db
				.select({
					team_id: liteLLM_SpendLogs.team_id,
					total_spend: sql<number>`SUM(${liteLLM_SpendLogs.spend})`,
					total_tokens: sql<number>`SUM(${liteLLM_SpendLogs.total_tokens})`,
				})
				.from(liteLLM_SpendLogs)
				.where(sql`${liteLLM_SpendLogs.team_id} IS NOT NULL`)
				.groupBy(liteLLM_SpendLogs.team_id)
				.limit(AGGREGATE_DEFAULT_LIMIT);

			// WebUI 把 teams 直接作为 BarChart categories，必须为字符串数组
			const teams: string[] = aggregate.map((row) => toSafeString(row.team_id));

			// 按日期 + team 聚合，得到 daily_spend 矩阵
			const dailyRows = await db
				.select({
					team_id: liteLLM_SpendLogs.team_id,
					date: sql<string>`DATE(${liteLLM_SpendLogs.startTime})`,
					spend: sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.spend}), 0)`,
				})
				.from(liteLLM_SpendLogs)
				.where(sql`${liteLLM_SpendLogs.team_id} IS NOT NULL`)
				.groupBy(liteLLM_SpendLogs.team_id, sql`DATE(${liteLLM_SpendLogs.startTime})`)
				.orderBy(desc(sql`DATE(${liteLLM_SpendLogs.startTime})`))
				.limit(DAILY_SPEND_MATRIX_LIMIT);

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
				const result = await db
					.select({
						model: liteLLM_SpendLogs.model,
						total_spend: sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.spend}), 0)`,
						total_tokens: sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.total_tokens}), 0)`,
					})
					.from(liteLLM_SpendLogs)
					.groupBy(liteLLM_SpendLogs.model)
					.limit(limit);

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
				const result = await db
					.select({
						provider: liteLLM_SpendLogs.custom_llm_provider,
						total_spend: sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.spend}), 0)`,
						total_tokens: sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.total_tokens}), 0)`,
					})
					.from(liteLLM_SpendLogs)
					.where(sql`${liteLLM_SpendLogs.custom_llm_provider} IS NOT NULL AND ${liteLLM_SpendLogs.custom_llm_provider} != ''`)
					.groupBy(liteLLM_SpendLogs.custom_llm_provider)
					.limit(AGGREGATE_DEFAULT_LIMIT);

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
				total_spend: sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.spend}), 0)`,
				total_tokens: sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.total_tokens}), 0)`,
				totalRequests: sql<number>`COUNT(*)`,
			})
			.from(liteLLM_SpendLogs)
			.where(whereClause)
			.groupBy(liteLLM_SpendLogs.model)
			.orderBy(desc(sql`SUM(${liteLLM_SpendLogs.spend})`))
			.limit(AGGREGATE_DEFAULT_LIMIT);

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
	// WebUI adminSpendLogsCall 期望：数组（用于 fillMissingDates + Monthly Spend BarChart）
	// 每项必须含 date 字符串（YYYY-MM-DD）和 finite number spend，避免 Tremor y=NaN。
	// 行为契约：
	//   - 按 DATE(startTime) 聚合本月每天的 spend / total_tokens
	//   - 补齐本月 1 号到今天（含）所有日期，缺失日 spend=0
	//   - DB 查询失败时返回本月每日 spend=0 的兜底数组，绝不返回 []
	// 兜底原因：WebUI fetchOverallSpend 把结果丢给 fillMissingDates(data, firstDay, lastDay, [])，
	// categories=[] 时 fill 出的每项缺 spend 字段，Tremor BarChart y=NaN 报错。

	registerRoute(router, { method: "get", path: "/global/spend/logs" }, async (req) => {
		const { firstDay, lastDay, dates } = getCurrentMonthDateRange();
		const firstDayDate = new Date(`${firstDay}T00:00:00Z`);
		const lastDayDate = new Date(`${lastDay}T23:59:59.999Z`);

		return runWithFallback(logger, "/global/spend/logs", dates.map(makeEmptyDailySpendRow), async () => {
			const data = await db
				.select({
					date: sql<string>`DATE(${liteLLM_SpendLogs.startTime})`,
					spend: sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.spend}), 0)`,
					total_tokens: sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.total_tokens}), 0)`,
				})
				.from(liteLLM_SpendLogs)
				.where(and(sql`${liteLLM_SpendLogs.startTime} >= ${firstDayDate}`, sql`${liteLLM_SpendLogs.startTime} <= ${lastDayDate}`))
				.groupBy(sql`DATE(${liteLLM_SpendLogs.startTime})`)
				.orderBy(sql`DATE(${liteLLM_SpendLogs.startTime})`);

			return mergeWithCurrentMonthPlaceholder(
				data.map((row) => ({
					date: toDateString(row.date),
					spend: toFiniteNumber(row.spend),
					total_tokens: toFiniteNumber(row.total_tokens),
					startTime: new Date(`${toSafeString(row.date).slice(0, 10)}T00:00:00Z`),
				})),
				dates,
			);
		});
	});

	// ========== /global/spend/provider (单数形式) ==========
	// WebUI usage.tsx 渲染 spendByProvider.map(provider => { provider.spend.toFixed(2) })
	// 期望每项：{ provider: string, spend: number }
	// Python 真实行为：[{ provider, spend }]

	registerRoute(router, { method: "get", path: "/global/spend/provider" }, async (req) => {
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
			"/global/spend/provider",
			[] as { provider: string; spend: number; total_spend: number }[],
			async () => {
				const result = await db
					.select({
						provider: liteLLM_SpendLogs.custom_llm_provider,
						total_spend: sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.spend}), 0)`,
					})
					.from(liteLLM_SpendLogs)
					.where(
						whereClause
							? and(
									whereClause,
									sql`${liteLLM_SpendLogs.custom_llm_provider} IS NOT NULL AND ${liteLLM_SpendLogs.custom_llm_provider} != ''`,
								)
							: sql`${liteLLM_SpendLogs.custom_llm_provider} IS NOT NULL AND ${liteLLM_SpendLogs.custom_llm_provider} != ''`,
					)
					.groupBy(liteLLM_SpendLogs.custom_llm_provider)
					.limit(AGGREGATE_DEFAULT_LIMIT);

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

		const conditions = [sql`${liteLLM_SpendLogs.request_tags} IS NOT NULL`];
		if (startDate && endDate) {
			conditions.push(sql`${liteLLM_SpendLogs.startTime} >= ${new Date(startDate)}`);
			conditions.push(sql`${liteLLM_SpendLogs.startTime} <= ${new Date(endDate)}`);
		}
		const whereClause = conditions.length > 1 ? and(...conditions) : conditions[0];

		return runWithFallback(
			logger,
			"/global/spend/tags",
			{ spend_per_tag: [] as { name: string; spend: number; tag: string; total_spend: number; total_tokens: number }[] },
			async () => {
				const result = await db
					.select({
						tag: liteLLM_SpendLogs.request_tags,
						total_spend: sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.spend}), 0)`,
						total_tokens: sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.total_tokens}), 0)`,
					})
					.from(liteLLM_SpendLogs)
					.where(whereClause)
					.groupBy(liteLLM_SpendLogs.request_tags)
					.limit(AGGREGATE_DEFAULT_LIMIT);

				const spend_per_tag = result.map((row) => normalizeTagSpendRow(row));

				return { spend_per_tag: spend_per_tag };
			},
		);
	});

	// ========== /global/spend/all_tag_names ==========

	registerRoute(router, { method: "get", path: "/global/spend/all_tag_names" }, async () => {
		const result = await db
			.selectDistinct({ tag: liteLLM_SpendLogs.request_tags })
			.from(liteLLM_SpendLogs)
			.where(sql`${liteLLM_SpendLogs.request_tags} IS NOT NULL`)
			.limit(AGGREGATE_DEFAULT_LIMIT);

		return { tag_names: result.map((r) => r.tag) };
	});

	// ========== /global/spend/end_users (POST) ==========
	// WebUI 期望：数组

	registerRoute(router, { method: "post", path: "/global/spend/end_users" }, async (req) => {
		const body = req.body ?? {};
		const startTime = body.startTime as string | undefined;
		const endTime = body.endTime as string | undefined;

		const conditions = [sql`${liteLLM_SpendLogs.end_user} IS NOT NULL AND ${liteLLM_SpendLogs.end_user} != ''`];
		if (startTime && endTime) {
			conditions.push(sql`${liteLLM_SpendLogs.startTime} >= ${new Date(startTime)}`);
			conditions.push(sql`${liteLLM_SpendLogs.startTime} <= ${new Date(endTime)}`);
		}
		const whereClause = conditions.length > 1 ? and(...conditions) : conditions[0];

		return runWithFallback(
			logger,
			"/global/spend/end_users",
			[] as { end_user: string; total_spend: number; total_tokens: number }[],
			async () => {
				const result = await db
					.select({
						end_user: liteLLM_SpendLogs.end_user,
						total_spend: sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.spend}), 0)`,
						total_tokens: sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.total_tokens}), 0)`,
					})
					.from(liteLLM_SpendLogs)
					.where(whereClause)
					.groupBy(liteLLM_SpendLogs.end_user)
					.limit(AGGREGATE_DEFAULT_LIMIT);

				return result.map((row) => ({
					end_user: toSafeString(row.end_user),
					total_spend: toFiniteNumber(row.total_spend),
					total_tokens: toFiniteNumber(row.total_tokens),
				}));
			},
		);
	});
}
