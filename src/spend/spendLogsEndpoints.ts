/**
 * /spend/* 端点（keys/users/tags/logs/calculate）
 *
 * 从 SpendManagementEndpoint.ts 拆分出来，把 7 个明细 / 聚合 / 计算端点
 * 集中在一个文件里，main.ts 与单元测试仍通过 `registerSpendManagementEndpoints`
 * 间接调用本文件的 `registerSpendLogsEndpoints`。
 */

import type { Router } from "express";
import { eq, sql, and, desc } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "../db/schema";
import { liteLLM_SpendLogs } from "../db/schema/spendLogs";
import { registerRoute } from "../core/api/registerRoute";
import { costPerToken } from "../cost/CostCalculator";
import {
	AGGREGATE_DEFAULT_LIMIT,
	SpendSortOrder,
	normalizeSortOrder,
	parsePageParam,
	parsePageSizeParam,
	runWithFallback,
} from "./spendManagementHelpers";
import {
	makeEmptyLegacySpendLogsPage,
	makeEmptyUiSpendLogsPage,
	normalizeSpendLogRow,
	normalizeTagSpendRow,
	toFiniteNumber,
	toSafeString,
} from "./spendManagementFormatters";
import { createModuleLogger } from "../core/utils/logger";
import type { Column } from "./spendManagementTypes";

const logger = createModuleLogger("SpendLogs");

/**
 * 注册 /spend/* 端点（keys/users/tags/logs/calculate 等明细/聚合/计算端点）。
 * @param router - 鉴权后 Express Router
 * @param db - Drizzle 数据库实例
 */
export function registerSpendLogsEndpoints(router: Router, db: NodePgDatabase<typeof schema>): void {
	// ========== /spend/keys ==========
	// WebUI adminTopKeysCall 通过 /global/spend/keys?limit=5 调用，期望 total_spend 必为 number 且 api_key 字符串

	registerRoute(router, { method: "get", path: "/spend/keys" }, async (req) => {
		return runWithFallback(logger, "/spend/keys", [] as Array<Record<string, unknown>>, async () => {
			const result = await db
				.select({
					api_key: liteLLM_SpendLogs.api_key,
					total_spend: sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.spend}), 0)`,
					total_tokens: sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.total_tokens}), 0)`,
				})
				.from(liteLLM_SpendLogs)
				.groupBy(liteLLM_SpendLogs.api_key)
				.limit(AGGREGATE_DEFAULT_LIMIT);

			return result.map((row) => ({
				api_key: toSafeString(row.api_key),
				key_alias: null,
				total_spend: toFiniteNumber(row.total_spend),
				total_tokens: toFiniteNumber(row.total_tokens),
			}));
		});
	});

	// ========== /spend/users ==========

	registerRoute(router, { method: "get", path: "/spend/users" }, async (req) => {
		return runWithFallback(logger, "/spend/users", [] as Array<Record<string, unknown>>, async () => {
			const result = await db
				.select({
					user: liteLLM_SpendLogs.user,
					total_spend: sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.spend}), 0)`,
					total_tokens: sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.total_tokens}), 0)`,
				})
				.from(liteLLM_SpendLogs)
				.where(sql`${liteLLM_SpendLogs.user} IS NOT NULL AND ${liteLLM_SpendLogs.user} != ''`)
				.groupBy(liteLLM_SpendLogs.user)
				.limit(AGGREGATE_DEFAULT_LIMIT);

			return result.map((row) => ({
				user: toSafeString(row.user),
				total_spend: toFiniteNumber(row.total_spend),
				total_tokens: toFiniteNumber(row.total_tokens),
			}));
		});
	});

	// ========== /spend/tags ==========
	// WebUI Tag Based Usage BarChart index="name" categories=["spend"]。
	// 每项需含 name 字符串 + spend 有限数字，避免 y=NaN。

	registerRoute(router, { method: "get", path: "/spend/tags" }, async (req) => {
		return runWithFallback(logger, "/spend/tags", [] as Array<Record<string, unknown>>, async () => {
			const result = await db
				.select({
					tag: liteLLM_SpendLogs.request_tags,
					total_spend: sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.spend}), 0)`,
					total_tokens: sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.total_tokens}), 0)`,
				})
				.from(liteLLM_SpendLogs)
				.where(sql`${liteLLM_SpendLogs.request_tags} IS NOT NULL`)
				.groupBy(liteLLM_SpendLogs.request_tags)
				.limit(AGGREGATE_DEFAULT_LIMIT);

			return result.map((row) => normalizeTagSpendRow(row));
		});
	});

	// ========== /spend/logs ==========
	// 旧分页契约 — WebUI /spend/logs 消费方期待分页对象形状：
	//   { data: Row[], page, pageSize, total, hasMore }
	// 行为契约：
	//   - 不带 api_key / user_id 过滤时，返回按 startTime 降序的明细行；空/失败时返回空 data
	//   - 带 api_key / user_id 过滤时按 filter 返回分页明细
	//   - 绝不在空结果时返回"本月每日 spend=0 假数据"（那是 /global/spend/logs 的职责）
	//   - DB 查询失败时返回空 data 并 warn 日志，不抛 5xx

	registerRoute(router, { method: "get", path: "/spend/logs" }, async (req) => {
		const page = parsePageParam(req.query.page);
		// WebUI 既传 pageSize（JS camelCase）也兼容 page_size（snake_case 协议）
		const pageSize = parsePageSizeParam(req.query.page_size, req.query.pageSize);
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

		// 根因：Drizzle 链式 select / count 任一环节失败（DB 断连、字段不存在、drizzle schema 漂移）
		// 都直接 reject。这里返回旧分页空对象避免 WebUI Logs 页面炸 5xx；
		// 不再返回"本月每日 spend=0 假数据"——那是 /global/spend/logs 的职责，混用会导致
		// Monthly Spend BarChart 与 Logs 表格口径不一致。
		return runWithFallback(logger, "/spend/logs", makeEmptyLegacySpendLogsPage(page, pageSize), async () => {
			const data = await db
				.select()
				.from(liteLLM_SpendLogs)
				.where(whereClause)
				.orderBy(desc(liteLLM_SpendLogs.startTime))
				.limit(pageSize)
				.offset((page - 1) * pageSize);

			const totalRow = await db
				.select({ count: sql<number>`COUNT(*)` })
				.from(liteLLM_SpendLogs)
				.where(whereClause);
			const total = toFiniteNumber(totalRow[0]?.count);

			return {
				data: data.map(normalizeSpendLogRow),
				page: page,
				pageSize: pageSize,
				total: total,
				hasMore: page * pageSize < total,
			};
		});
	});

	// ========== /spend/logs/ui (分页 + 时间过滤，WebUI Logs 页面新接口) ==========
	// 形状契约（对齐 WebUI Request Logs 页面 `fetchSpendLogs` 消费方）：
	//   { data: Row[], total, page, page_size, total_pages }
	// 支持查询参数：start_date / end_date / page / page_size / sort_by / sort_order
	// 默认 page_size=50（≤100 上限）；sort_by 默认 startTime；sort_order 默认 desc
	registerRoute(router, { method: "get", path: "/spend/logs/ui" }, async (req) => {
		const page = parsePageParam(req.query.page);
		// WebUI Logs 页面传 page_size（snake_case），兼容旧版 pageSize
		const pageSize = parsePageSizeParam(req.query.page_size, req.query.pageSize);
		const startDate = req.query.start_date as string | undefined;
		const endDate = req.query.end_date as string | undefined;
		const sortBy = (req.query.sort_by as string | undefined) ?? "startTime";
		// sortOrder 白名单化（参见 SpendSortOrder enum），非法值回退 DESC，规避 ORDER BY 注入
		const sortOrder = normalizeSortOrder(req.query.sort_order);

		// 校验可排序字段白名单，避免任意列名进入 SQL。
		// 用 union + Record 强类型化：编译器保证白名单覆盖每个合法字段，查找返回
		// 已知 Drizzle column 类型（而非 Record<string, unknown>）。
		const allowedSortColumns = {
			startTime: liteLLM_SpendLogs.startTime,
			spend: liteLLM_SpendLogs.spend,
			total_tokens: liteLLM_SpendLogs.total_tokens,
		} as const satisfies Record<string, Column>;
		const sortColumn: Column = isSortableSpendLogField(sortBy) ? allowedSortColumns[sortBy] : liteLLM_SpendLogs.startTime;
		const orderExpr = sortOrder === SpendSortOrder.ASC ? sql`${sortColumn} ASC` : sql`${sortColumn} DESC`;

		const conditions = [];
		if (startDate) {
			conditions.push(sql`${liteLLM_SpendLogs.startTime} >= ${new Date(startDate)}`);
		}
		if (endDate) {
			conditions.push(sql`${liteLLM_SpendLogs.startTime} <= ${new Date(endDate)}`);
		}
		const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

		// 根因：count / select 任一 reject（DB 断连、start_date/end_date 解析异常、
		// drizzle 字段漂移）都直接抛出。返回新分页空对象，避免 WebUI Logs 页面表格炸 5xx；
		// 不返回"本月每日 spend=0 假数据"，因为 Logs 是明细页，假数据会污染用户筛选语义。
		return runWithFallback(logger, "/spend/logs/ui", makeEmptyUiSpendLogsPage(page, pageSize), async () => {
			const totalRow = await db
				.select({ count: sql<number>`COUNT(*)` })
				.from(liteLLM_SpendLogs)
				.where(whereClause);
			const total = toFiniteNumber(totalRow[0]?.count);
			const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);

			const data = await db
				.select()
				.from(liteLLM_SpendLogs)
				.where(whereClause)
				.orderBy(orderExpr)
				.limit(pageSize)
				.offset((page - 1) * pageSize);

			return {
				data: data.map(normalizeSpendLogRow),
				total: total,
				page: page,
				page_size: pageSize,
				total_pages: totalPages,
			};
		});
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
		// GAP 6: 支持请求体传 custom_cost_per_token，对齐 PY deployment 级 override。
		const customBody = body.custom_cost_per_token as
			| {
					input_cost_per_token?: number;
					output_cost_per_token?: number;
					cache_creation_input_token_cost?: number;
					cache_read_input_token_cost?: number;
			  }
			| undefined;
		// GAP: costPerToken 现在 throw missing-model 错误，此处兜底捕获返回 0 + warning
		let totalCost = 0;
		try {
			({ totalCost } = costPerToken(model, promptTokens, completionTokens, 0, 0, {
				customCostPerToken: customBody,
			}));
		} catch (err) {
			logger.warn(`/spend/calculate cost query failed: ${(err as Error).message}`);
			totalCost = 0;
		}
		return {
			cost: totalCost,
			model: model,
			prompt_tokens: promptTokens,
			completion_tokens: completionTokens,
		};
	});
}

/** /spend/logs/ui 允许的 sort_by 字段白名单 */
enum SortableSpendLogField {
	StartTime = "startTime",
	Spend = "spend",
	TotalTokens = "total_tokens",
}

const SORTABLE_SPEND_LOG_FIELDS: ReadonlySet<string> = new Set<string>(Object.values(SortableSpendLogField));
function isSortableSpendLogField(raw: string): raw is SortableSpendLogField {
	return SORTABLE_SPEND_LOG_FIELDS.has(raw);
}
