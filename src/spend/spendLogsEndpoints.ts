/**
 * /spend/* 端点（keys/users/tags/logs/calculate）
 *
 * 从 SpendManagementEndpoint.ts 拆分出来，把 7 个明细 / 聚合 / 计算端点
 * 集中在一个文件里，main.ts 与单元测试仍通过 `registerSpendManagementEndpoints`
 * 间接调用本文件的 `registerSpendLogsEndpoints`。
 *
 * `/spend/logs/ui` 与 `/spend/logs/v2` 行为对齐 Python LiteLLM：
 *   - start_date / end_date 必填；UI 只接受 `YYYY-MM-DD HH:MM:SS`，v2 同时接受 `YYYY-MM-DD`。
 *   - sort_by 仅允许白名单字段；非法返回 400。
 *   - sort_order 仅允许 asc / desc；非法返回 400。
 *   - 过滤：api_key / user_id / request_id / team_id / min_spend / max_spend /
 *     status_filter / model / model_id / key_alias / end_user / error_code / error_message。
 *   - 权限裁剪：admin 看全部；非 admin + team_id 时检查 team 可见性；
 *     internal_user 未传 team 时强制只看自己的 user；team member 看不可见 team 返回 403。
 *   - 主查询显式列投影，排除 messages / response / proxy_server_request 重 JSON 列。
 *   - UI 路径 enrichment session_total_count；v2 路径不 enrichment。
 *   - DB 异常抛 5xx，不返回空分页伪装成功。
 */

import type { Router } from "express";
import { eq, sql, and, desc, gt, inArray, type SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "../db/schema";
import { liteLLM_SpendLogs } from "../db/schema/spendLogs";
import { liteLLM_ActiveRequests } from "../db/schema/activeRequests";
import { registerRoute } from "../core/api/registerRoute";
import { ApiError, HTTP_STATUS } from "../core/api/ApiError";
import { costPerToken } from "../cost/CostCalculator";
import { adjustCost, costTrackingConfigService, resolveCostProvider } from "../cost/CostTrackingConfig";
import {
	AGGREGATE_DEFAULT_LIMIT,
	COLD_STORAGE_BATCH_CONCURRENCY,
	SpendSortOrder,
	mapWithConcurrency,
	normalizeSortOrder,
	parseOptionalFloatQueryParam,
	parsePageParam,
	parsePageSizeParam,
	parseSpendLogDate,
	runWithFallback,
} from "./spendManagementHelpers";
import {
	makeEmptyLegacySpendLogsPage,
	normalizeSpendLogRow,
	normalizeUiSpendLogRow,
	toFiniteNumber,
	toSafeString,
} from "./spendManagementFormatters";
import { createModuleLogger } from "../core/utils/logger";
import { getRequestResponsePayloadFromColdStorage } from "./SpendLogColdStorage";
import { buildUiSpendLogDetail } from "./UiLogDetail";
import { spendLogStatusSql } from "./spendLogStatus";
import {
	DEFAULT_SESSION_TIMELINE_WINDOW,
	MAX_SESSION_TIMELINE_WINDOW,
	createSessionImageLookup,
	loadSessionTimeline,
} from "./sessionTimelineLive";
import { CLAUDE_CODE_USER_ID_PATTERN, normalizeSessionUuid } from "./sessionIdentity";
import type { Column } from "./spendManagementTypes";
import type { UserAPIKeyAuth } from "../types/auth";
import {
	isInternalUserRole,
	isSpendAdminView,
	resolveActiveRequestVisibilityClause,
	resolveSpendVisibilityClause,
} from "./spendVisibility";
import {
	parsePersistedSessionGroupKey,
	parseSessionGroupQuery,
	readSessionGroup,
	sessionGroupKey,
	type SessionGroupRef,
} from "./sessionGroup";
import {
	encodeSessionPosition,
	parseSessionPosition,
	sessionCursorClause,
	sessionPositionFromRow,
	sessionSnapshotClause,
	type SessionPosition,
} from "./sessionPosition";
import { spendLogDurationSql, spendLogExecutionModelSql, spendLogMetadataJsonSql } from "./spendLogProjections";

const logger = createModuleLogger("SpendLogs");

/** Python LiteLLM 兼容 sort_by 白名单 */
const SPEND_LOG_SORT_FIELDS = ["spend", "total_tokens", "startTime", "endTime", "request_duration_ms"] as const;
type SpendLogSortField = (typeof SPEND_LOG_SORT_FIELDS)[number];

const SPEND_LOG_DETAIL_BATCH_SIZE = 100;


/**
 * /spend/logs/ui 响应包络 — 对齐 Python `ui_view_spend_logs` 返回。
 * UI 模式额外注入 `session_total_count`；v2 模式不注入。
 */
interface UiSpendLogsPage {
	data: Record<string, unknown>[];
	total: number;
	page: number;
	page_size: number;
	total_pages: number;
	snapshot?: string;
	next_cursor?: string;
}

/**
 * 注册 /spend/* 端点（keys/users/tags/logs/calculate 等明细/聚合/计算端点）。
 * @param router - 鉴权后 Express Router
 * @param db - Drizzle 数据库实例
 */
export function registerSpendLogsEndpoints(router: Router, db: NodePgDatabase<typeof schema>): void {
	// ========== /spend/keys ==========
	// WebUI adminTopKeysCall 通过 /global/spend/keys 调用，期望 total_spend 必为 number 且 api_key 字符串

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
	// 对齐 Python get_spend_by_tags（spend_management_endpoints.py）：
	//   SELECT jsonb_array_elements_text(request_tags) AS individual_request_tag,
	//          COUNT(*) AS log_count, SUM(spend) AS total_spend
	//   FROM "LiteLLM_SpendLogs" GROUP BY individual_request_tag;
	// request_tags 是 jsonb 数组，按元素炸开逐 tag 聚合；
	// Python 忽略 start_date/end_date 查询参数（SQL 无日期过滤），TS 同步忽略。

	registerRoute(router, { method: "get", path: "/spend/tags" }, async (req) => {
		return runWithFallback(logger, "/spend/tags", [] as Array<Record<string, unknown>>, async () => {
			const result = await db
				.select({
					individual_request_tag: sql<string>`jsonb_array_elements_text(${liteLLM_SpendLogs.request_tags})`.as(
						"individual_request_tag",
					),
					log_count: sql<number>`COUNT(*)`,
					total_spend: sql<number>`SUM(${liteLLM_SpendLogs.spend})`,
				})
				.from(liteLLM_SpendLogs)
				.groupBy(sql`individual_request_tag`);

			return result.map((row) => ({
				individual_request_tag: toSafeString(row.individual_request_tag),
				log_count: toFiniteNumber(row.log_count),
				total_spend: toFiniteNumber(row.total_spend),
			}));
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

	// ========== /spend/logs/ui & /spend/logs/v2 ==========
	// 形状契约（对齐 Python ui_view_spend_logs）：
	//   { data: Row[], total, page, page_size, total_pages, (ui-only) session_total_count? }
	// 必填：start_date / end_date；UI 路径日期格式为 `YYYY-MM-DD HH:MM:SS`，
	// v2 路径额外接受 `YYYY-MM-DD`。
	// 错误不捕获为 fallback，让 registerRoute 返回 4xx/5xx。

	const handleUiSpendLogs = (isV2: boolean) => async (req: { query: Record<string, unknown>; auth?: UserAPIKeyAuth }) => {
		const page = parsePageParam(req.query.page);
		const pageSize = parsePageSizeParam(req.query.page_size, req.query.pageSize);

		const startDateRaw = req.query.start_date;
		const endDateRaw = req.query.end_date;
		if (typeof startDateRaw !== "string" || startDateRaw.length === 0) {
			throw new ApiError(HTTP_STATUS.BAD_REQUEST, "Start date and end date are required");
		}
		if (typeof endDateRaw !== "string" || endDateRaw.length === 0) {
			throw new ApiError(HTTP_STATUS.BAD_REQUEST, "Start date and end date are required");
		}

		let startDateObj: Date;
		let endDateObj: Date;
		try {
			startDateObj = parseSpendLogDate(startDateRaw, isV2 ? "v2" : "ui");
		} catch (err) {
			throw new ApiError(HTTP_STATUS.BAD_REQUEST, (err as Error).message);
		}
		try {
			endDateObj = parseSpendLogDate(endDateRaw, isV2 ? "v2" : "ui");
		} catch (err) {
			throw new ApiError(HTTP_STATUS.BAD_REQUEST, (err as Error).message);
		}

		const sortByRaw = req.query.sort_by;
		const sortBy: SpendLogSortField = (SPEND_LOG_SORT_FIELDS as readonly string[]).includes(
			typeof sortByRaw === "string" ? sortByRaw : "",
		)
			? (sortByRaw as SpendLogSortField)
			: "startTime";
		if (typeof sortByRaw === "string" && sortByRaw.length > 0 && !(SPEND_LOG_SORT_FIELDS as readonly string[]).includes(sortByRaw)) {
			throw new ApiError(
				HTTP_STATUS.BAD_REQUEST,
				`Invalid sort_by: ${sortByRaw}. Must be one of: ${SPEND_LOG_SORT_FIELDS.join(", ")}`,
			);
		}

		const sortOrderRaw = req.query.sort_order;
		const sortOrder: SpendSortOrder = normalizeSortOrder(sortOrderRaw);
		if (typeof sortOrderRaw === "string" && sortOrderRaw.length > 0 && sortOrderRaw !== "asc" && sortOrderRaw !== "desc") {
			throw new ApiError(HTTP_STATUS.BAD_REQUEST, `Invalid sort_order: ${sortOrderRaw}. Must be one of: asc, desc`);
		}

		const apiKeyFilter = typeof req.query.api_key === "string" ? req.query.api_key : undefined;
		const userIdFilter = typeof req.query.user_id === "string" ? req.query.user_id : undefined;
		const requestIdFilter = typeof req.query.request_id === "string" ? req.query.request_id : undefined;
		const teamIdFilter = typeof req.query.team_id === "string" ? req.query.team_id : undefined;
		const modelFilter = typeof req.query.model === "string" ? req.query.model : undefined;
		const modelIdFilter = typeof req.query.model_id === "string" ? req.query.model_id : undefined;
		const endUserFilter = typeof req.query.end_user === "string" ? req.query.end_user : undefined;
		const statusFilter = typeof req.query.status_filter === "string" ? req.query.status_filter : undefined;
		const includeActive = !isV2 && req.query.include_active === "true";
		const keyAliasFilter = typeof req.query.key_alias === "string" ? req.query.key_alias : undefined;
		const errorCodeFilter = typeof req.query.error_code === "string" ? req.query.error_code : undefined;
		const errorMessageFilter = typeof req.query.error_message === "string" ? req.query.error_message : undefined;
		const minSpendFilter = parseOptionalFloatQueryParam(req.query.min_spend);
		const maxSpendFilter = parseOptionalFloatQueryParam(req.query.max_spend);
		if (minSpendFilter === null) {
			throw new ApiError(HTTP_STATUS.BAD_REQUEST, "Invalid min_spend: must be a number");
		}
		if (maxSpendFilter === null) {
			throw new ApiError(HTTP_STATUS.BAD_REQUEST, "Invalid max_spend: must be a number");
		}

		// 权限裁剪
		const auth = req.auth;
		const isAdminView = isSpendAdminView(auth);

		const effectiveTeamId = teamIdFilter;
		let effectiveUserId = userIdFilter;
		const effectiveApiKey = apiKeyFilter;

		if (!isAdminView && effectiveTeamId === undefined && isInternalUserRole(auth) && auth?.user_id) {
			effectiveUserId = auth.user_id;
		}

		// 显式列投影：排除重 JSON 列 (messages / response / proxy_server_request)。
		// standard_logging_object 不属于 Python SpendLogs schema，不应出现在投影中。
		// request_duration_ms 在 Python 端用 COALESCE 兼容 NULL，本处直接选原列；
		// Drizzle 会把 NULL 暴露给调用方（前端无需补 0 即可展示）。
		const visibilityClause = await resolveSpendVisibilityClause(db, auth, effectiveTeamId);

		// where 条件（一次构造复用于 count + select）
		const spendLogsWhereClause = and(
			buildUiSpendLogsWhereConditions({
				startDate: startDateObj,
				endDate: endDateObj,
				teamId: effectiveTeamId,
				apiKey: effectiveApiKey,
				user: effectiveUserId,
				requestId: requestIdFilter,
				model: modelFilter,
				modelId: modelIdFilter,
				endUser: endUserFilter,
				statusFilter: statusFilter,
				minSpend: minSpendFilter ?? undefined,
				maxSpend: maxSpendFilter ?? undefined,
				keyAlias: keyAliasFilter,
				errorCode: errorCodeFilter,
				errorMessage: errorMessageFilter,
			}),
			visibilityClause,
		);

		// count 查询：使用同一 whereClause，避免总数与明细不一致。
		const completedCountRow = await db
			.select({ count: sql<number>`COUNT(*)` })
			.from(liteLLM_SpendLogs)
			.where(spendLogsWhereClause);
		const completedTotal = toFiniteNumber(completedCountRow[0]?.count);
		const activeWhereClause = includeActive
			? and(
					buildActiveRequestsWhereConditions({
						startDate: startDateObj,
						endDate: endDateObj,
						teamId: effectiveTeamId,
						apiKey: effectiveApiKey,
						user: effectiveUserId,
						requestId: requestIdFilter,
						model: modelFilter,
						modelId: modelIdFilter,
						endUser: endUserFilter,
						statusFilter: statusFilter,
						minSpend: minSpendFilter ?? undefined,
						maxSpend: maxSpendFilter ?? undefined,
						keyAlias: keyAliasFilter,
						errorCode: errorCodeFilter,
						errorMessage: errorMessageFilter,
					}),
					resolveActiveRequestVisibilityClause(auth, effectiveTeamId),
				)
			: undefined;
		const activeCountRow = activeWhereClause
			? await db
					.select({ count: sql<number>`COUNT(*)` })
					.from(liteLLM_ActiveRequests)
					.where(activeWhereClause)
			: [];
		const activeTotal = toFiniteNumber(activeCountRow[0]?.count);
		const total = completedTotal + activeTotal;
		const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);

		const sortColumn: Column = resolveSortColumn(sortBy);
		const orderExpr = sortOrder === SpendSortOrder.ASC ? sql`${sortColumn} ASC` : sql`${sortColumn} DESC`;
		const pageOffset = (page - 1) * pageSize;
		let data: Record<string, unknown>[];
		if (activeWhereClause && sortBy === "startTime") {
			// startTime 是 ActiveRequests 与 SpendLogs 共有的真实字段，交给 PostgreSQL
			// 在同一 MVCC 快照内 UNION ALL 后统一排序。request_id 用作时间相同时的
			// 稳定排序键，避免两表在分页边界处产生不确定顺序。
			const mixedOrderExpr =
				sortOrder === SpendSortOrder.ASC ? sql`"startTime" ASC, "request_id" ASC` : sql`"startTime" DESC, "request_id" DESC`;
			const mixedRows = await db
				.select(uiActiveRequestSelection())
				.from(liteLLM_ActiveRequests)
				.where(activeWhereClause)
				.unionAll(db.select(uiSpendLogSelection()).from(liteLLM_SpendLogs).where(spendLogsWhereClause))
				.orderBy(mixedOrderExpr)
				.limit(pageSize)
				.offset(pageOffset);
			const normalizedRows = mixedRows.map((row) => normalizeUiSpendLogRow(row as Record<string, unknown>));
			const completedRows = normalizedRows.filter((row) => row.status !== "in_progress").map((row) => withSessionGroup(row));
			const enrichedCompletedRows = await enrichSessionCounts(db, completedRows, visibilityClause);
			const enrichedActiveRows = await enrichInProgressSessionCounts(
				db,
				normalizedRows.filter((row) => row.status === "in_progress"),
				visibilityClause,
			);
			let completedIndex = 0;
			let activeIndex = 0;
			data = normalizedRows.map((row) => {
				return row.status === "in_progress"
					? (enrichedActiveRows[activeIndex++] ?? { ...row, session_total_count: 1 })
					: (enrichedCompletedRows[completedIndex++] ?? { ...row, session_total_count: 1 });
			});
		} else {
			// spend / tokens / endTime / duration 等字段在 ActiveRequests 中没有最终值。
			// 选择这些排序字段时进行中请求固定置顶，已完成请求再按所选字段排序。
			const activeOffset = Math.min(pageOffset, activeTotal);
			const activeRows =
				activeWhereClause && activeOffset < activeTotal
					? await db
							.select(uiActiveRequestSelection())
							.from(liteLLM_ActiveRequests)
							.where(activeWhereClause)
							.orderBy(desc(liteLLM_ActiveRequests.startTime))
							.limit(pageSize)
							.offset(activeOffset)
					: [];
			const completedLimit = Math.max(0, pageSize - activeRows.length);
			const completedOffset = Math.max(0, pageOffset - activeTotal);
			const completedRows =
				completedLimit > 0
					? await db
							.select(uiSpendLogSelection())
							.from(liteLLM_SpendLogs)
							.where(spendLogsWhereClause)
							.orderBy(orderExpr)
							.limit(completedLimit)
							.offset(completedOffset)
					: [];

			const normalizedCompletedRows = completedRows.map((row) =>
				withSessionGroup(normalizeUiSpendLogRow(row as Record<string, unknown>)),
			);
			// UI 路径 enrichment session_total_count；v2 路径不 enrichment。
			const completedData = isV2 ? normalizedCompletedRows : await enrichSessionCounts(db, normalizedCompletedRows, visibilityClause);
			const normalizedActiveRows = activeRows.map((row) => normalizeUiSpendLogRow(row as Record<string, unknown>));
			const activeData = isV2
				? normalizedActiveRows.map((row) => ({ ...row, session_total_count: 1 }))
				: await enrichInProgressSessionCounts(db, normalizedActiveRows, visibilityClause);
			data = [...activeData, ...completedData];
		}

		const response: UiSpendLogsPage = {
			data: data,
			total: total,
			page: page,
			page_size: pageSize,
			total_pages: totalPages,
		};
		return response;
	};

	registerRoute(router, { method: "get", path: "/spend/logs/ui" }, handleUiSpendLogs(false));
	registerRoute(router, { method: "get", path: "/spend/logs/v2" }, handleUiSpendLogs(true));

	// ========== /spend/logs/session/ui ==========
	// 固定 snapshot 边界并按 (startTime, request_id) 复合 keyset 分页；旧 page/page_size 输入继续兼容。
	registerRoute(router, { method: "get", path: "/spend/logs/session/ui" }, async (req) => {
		const group = parseSessionGroupQuery(req.query as Record<string, unknown>);
		const page = parsePageParam(req.query.page);
		const pageSize = Math.min(parsePageSizeParam(req.query.page_size, undefined), 100);
		const snapshot = parseSessionPosition(req.query.snapshot, "snapshot");
		const cursor = parseSessionPosition(req.query.cursor, "cursor");
		const knownTotal = parseKnownSessionTotal(req.query.known_total);
		if (knownTotal !== null && (!snapshot || !cursor)) {
			throw new ApiError(HTTP_STATUS.BAD_REQUEST, "known_total requires snapshot and cursor");
		}
		const includeContent = req.query.include_content === "true";
		const requestedTeamId = typeof req.query.team_id === "string" && req.query.team_id.length > 0 ? req.query.team_id : undefined;
		const visibilityClause = await resolveSpendVisibilityClause(db, req.auth, requestedTeamId);

		// Legacy `session_id` is only an input alias. All detail reads must use the
		// persisted group key so embedded stable session IDs and indexed lookups
		// behave exactly like the explicit session group API.
		const groupClause = eq(liteLLM_SpendLogs.session_group_key, sessionGroupKey(group));
		const baseClause = and(groupClause, visibilityClause) as SQL;
		let effectiveSnapshot = snapshot;
		if (!effectiveSnapshot) {
			const snapshotRows = await db
				.select({ snapshotStartTime: liteLLM_SpendLogs.startTime, snapshotRequestId: liteLLM_SpendLogs.request_id })
				.from(liteLLM_SpendLogs)
				.where(baseClause)
				.orderBy(sql`${liteLLM_SpendLogs.startTime} DESC, ${liteLLM_SpendLogs.request_id} DESC`)
				.limit(1);
			effectiveSnapshot = sessionPositionFromRow(snapshotRows[0], "snapshotStartTime", "snapshotRequestId");
		}

		const boundedClause = effectiveSnapshot ? and(baseClause, sessionSnapshotClause(effectiveSnapshot)) : baseClause;
		let total = knownTotal;
		if (total === null) {
			const countRows = await db
				.select({ count: sql<number>`COUNT(*)` })
				.from(liteLLM_SpendLogs)
				.where(boundedClause);
			total = toFiniteNumber(countRows[0]?.count);
		}
		if (total === 0) {
			effectiveSnapshot = null;
		}
		const legacySkip = cursor ? 0 : (page - 1) * pageSize;
		const detailClause = cursor ? and(boundedClause, sessionCursorClause(cursor)) : boundedClause;
		const rows = await db
			.select(includeContent ? uiSpendLogSelectionWithContent() : uiSpendLogSelection())
			.from(liteLLM_SpendLogs)
			.where(detailClause)
			.orderBy(sql`${liteLLM_SpendLogs.startTime} ASC, ${liteLLM_SpendLogs.request_id} ASC`)
			.limit(legacySkip + pageSize + 1);
		const normalizedRows = rows.map((row) => withSessionGroup(normalizeUiSpendLogRow(row as Record<string, unknown>)));
		const pageRows = normalizedRows.slice(legacySkip, legacySkip + pageSize);
		const hasMore = normalizedRows.length > legacySkip + pageSize;
		const nextCursor = hasMore ? sessionPositionFromNormalizedRow(pageRows.at(-1)) : null;

		return makeSessionPage(pageRows, total, page, pageSize, effectiveSnapshot, nextCursor);
	});

	// ========== /spend/logs/session/timeline ==========
	// 独立的 Session 时间线读取路径。已落库行按复合索引升序分批读取，仍在进行中的请求单独
	// 叠加在 `active_requests`；服务端只保留已去重的最终事件，请求快照、原始响应和
	// proxy_server_request 不会进入 HTTP 响应。WebSocket 长连接复用同一装配实现。
	registerRoute(router, { method: "get", path: "/spend/logs/session/timeline" }, async (req, res) => {
		const timings: Array<{ name: string; durationMs: number }> = [];
		const recordTiming = (name: string, startedAt: number): void => {
			timings.push({ name: name, durationMs: performance.now() - startedAt });
		};
		const group = parseSessionGroupQuery(req.query as Record<string, unknown>);
		const requestedTeamId =
			typeof req.query.team_id === "string" && req.query.team_id.length > 0 ? req.query.team_id : undefined;
		const visibilityStartedAt = performance.now();
		const visibilityClause = await resolveSpendVisibilityClause(db, req.auth, requestedTeamId);
		recordTiming("visibility", visibilityStartedAt);
		const payload = await loadSessionTimeline(
			db,
			{
				groupKey: sessionGroupKey(group),
				includeAuxiliary: req.query.include_auxiliary === "true",
				visibilityClause: visibilityClause,
				activeVisibilityClause: resolveActiveRequestVisibilityClause(req.auth, requestedTeamId),
			},
			{ findImages: createSessionImageLookup(db, visibilityClause), recordTiming: recordTiming },
			{
				limit: parseSessionTimelineWindow(req.query.limit),
				before: parseSessionPosition(req.query.before, "before"),
			},
		);
		res.setHeader(
			"Server-Timing",
			timings.map((timing) => `${timing.name};dur=${timing.durationMs.toFixed(1)}`).join(", "),
		);
		return payload;
	});

	// ========== /spend/logs/ui/batch ==========
	// Session 模拟批量补齐重列：每批最多 100 条。逐条保留冷存储优先语义，
	// 未命中的 request_id 合并成一次 DB 查询，避免大 Session 产生数百次 HTTP/SQL 往返。
	registerRoute(router, { method: "post", path: "/spend/logs/ui/batch" }, async (req) => {
		const requests = parseSpendLogDetailBatch(req.body);
		const coldStoragePayloads = await mapWithConcurrency(
			requests,
			COLD_STORAGE_BATCH_CONCURRENCY,
			async (detailRequest) => {
				const payload = await getRequestResponsePayloadFromColdStorage(
					detailRequest.request_id,
					parseOptionalDetailDate(detailRequest.start_date),
					parseOptionalDetailDate(detailRequest.end_date),
					(_coldStorageLogger, error) =>
						logger.warn(`/spend/logs/ui/batch 冷存储回查失败: ${(error as Error).message}`),
				);
				return [detailRequest.request_id, payload] as const;
			},
		);
		const coldStorageByRequestId = new Map(coldStoragePayloads);
		const databaseRequestIds = requests
			.map((detailRequest) => detailRequest.request_id)
			.filter((requestId) => coldStorageByRequestId.get(requestId) === null);

		const databaseRows =
			databaseRequestIds.length === 0
				? []
				: await db
						.select({
							request_id: liteLLM_SpendLogs.request_id,
							messages: liteLLM_SpendLogs.messages,
							response: liteLLM_SpendLogs.response,
							proxy_server_request: liteLLM_SpendLogs.proxy_server_request,
						})
						.from(liteLLM_SpendLogs)
						.where(inArray(liteLLM_SpendLogs.request_id, databaseRequestIds));
		const databaseByRequestId = new Map(databaseRows.map((row) => [row.request_id, row] as const));

		return {
			data: requests.map((detailRequest) => ({
				...(coldStorageByRequestId.get(detailRequest.request_id) ??
					databaseByRequestId.get(detailRequest.request_id) ??
					{}),
				request_id: detailRequest.request_id,
			})),
		};
	});

	// ========== /spend/logs/ui/:request_id ==========
	// 负载构造与 WebSocket 日志流共用（见 UiLogDetail.ts），保证一次性拉取与推送帧同形。

	registerRoute(router, { method: "get", path: "/spend/logs/ui/:request_id" }, async (req) => {
		const requestId = req.params.request_id;
		if (typeof requestId !== "string" || requestId.length === 0) {
			return null;
		}

		// PY: 可选 start_date / end_date 查询参数（YYYY-MM-DD HH:MM:SS），透传给冷存储 logger 收窄回查窗口
		return await buildUiSpendLogDetail(
			db,
			requestId,
			parseOptionalDetailDate(req.query.start_date),
			parseOptionalDetailDate(req.query.end_date),
		);
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
		// 与落账/响应头同口径：按 provider 折扣与保证金调整（默认空配置不改变金额）。
		// 这里没有 deployment 上下文，provider 只能从模型名前缀解析。
		totalCost = adjustCost(totalCost, resolveCostProvider(undefined, model), costTrackingConfigService.getSnapshot()).total;
		return {
			cost: totalCost,
			model: model,
			prompt_tokens: promptTokens,
			completion_tokens: completionTokens,
		};
	});
}

/**
 * 详情端点可选日期参数解析（PY `datetime.strptime(value, "%Y-%m-%d %H:%M:%S")`）。
 * 非字符串或格式非法时返回 undefined（忽略该时间窗边界，不因单个脏参数拒绝详情查询）。
 * @param rawQueryValue - req.query 原始值
 */
function parseOptionalDetailDate(rawQueryValue: unknown): Date | undefined {
	if (typeof rawQueryValue !== "string" || rawQueryValue.length === 0) {
		return undefined;
	}
	try {
		return parseSpendLogDate(rawQueryValue, "ui");
	} catch {
		return undefined;
	}
}

interface SpendLogDetailBatchRequest {
	readonly request_id: string;
	readonly start_date?: string;
	readonly end_date?: string;
}

function parseSpendLogDetailBatch(body: unknown): SpendLogDetailBatchRequest[] {
	if (typeof body !== "object" || body === null || !Array.isArray((body as Record<string, unknown>).requests)) {
		throw new ApiError(HTTP_STATUS.BAD_REQUEST, "requests must be an array");
	}
	const rawRequests = (body as Record<string, unknown>).requests as unknown[];
	if (rawRequests.length === 0 || rawRequests.length > SPEND_LOG_DETAIL_BATCH_SIZE) {
		throw new ApiError(HTTP_STATUS.BAD_REQUEST, `requests must contain 1-${SPEND_LOG_DETAIL_BATCH_SIZE} items`);
	}

	const uniqueRequests = new Map<string, SpendLogDetailBatchRequest>();
	for (const rawRequest of rawRequests) {
		if (typeof rawRequest !== "object" || rawRequest === null) {
			throw new ApiError(HTTP_STATUS.BAD_REQUEST, "invalid detail request");
		}
		const request = rawRequest as Record<string, unknown>;
		if (
			typeof request.request_id !== "string" ||
			request.request_id.trim().length === 0 ||
			request.request_id.length > 512 ||
			(request.start_date !== undefined && typeof request.start_date !== "string") ||
			(request.end_date !== undefined && typeof request.end_date !== "string")
		) {
			throw new ApiError(HTTP_STATUS.BAD_REQUEST, "invalid detail request");
		}
		if (!uniqueRequests.has(request.request_id)) {
			uniqueRequests.set(request.request_id, {
				request_id: request.request_id,
				...(request.start_date !== undefined ? { start_date: request.start_date } : {}),
				...(request.end_date !== undefined ? { end_date: request.end_date } : {}),
			});
		}
	}
	return [...uniqueRequests.values()];
}

/** Recover legacy failed-call attribution only from a recorded upstream request. */

/** UI logs omit request/response payloads; legacy recovery projects one scalar. */
function uiSpendLogSelection() {
	return {
		request_id: liteLLM_SpendLogs.request_id,
		call_type: liteLLM_SpendLogs.call_type,
		api_key: liteLLM_SpendLogs.api_key,
		spend: liteLLM_SpendLogs.spend,
		total_tokens: liteLLM_SpendLogs.total_tokens,
		prompt_tokens: liteLLM_SpendLogs.prompt_tokens,
		completion_tokens: liteLLM_SpendLogs.completion_tokens,
		startTime: liteLLM_SpendLogs.startTime,
		endTime: liteLLM_SpendLogs.endTime,
		completionStartTime: liteLLM_SpendLogs.completionStartTime,
		model: spendLogExecutionModelSql(),
		model_id: liteLLM_SpendLogs.model_id,
		model_group: liteLLM_SpendLogs.model_group,
		custom_llm_provider: sql<string | null>`${liteLLM_SpendLogs.custom_llm_provider}`,
		api_base: sql<string | null>`${liteLLM_SpendLogs.api_base}`,
		user: liteLLM_SpendLogs.user,
		metadata: sql<unknown | null>`${liteLLM_SpendLogs.metadata}`,
		cache_hit: sql<string | null>`${liteLLM_SpendLogs.cache_hit}`,
		cache_key: liteLLM_SpendLogs.cache_key,
		request_tags: sql<unknown | null>`${liteLLM_SpendLogs.request_tags}`,
		team_id: liteLLM_SpendLogs.team_id,
		organization_id: liteLLM_SpendLogs.organization_id,
		end_user: liteLLM_SpendLogs.end_user,
		requester_ip_address: liteLLM_SpendLogs.requester_ip_address,
		session_id: liteLLM_SpendLogs.session_id,
		session_group_key: liteLLM_SpendLogs.session_group_key,
		status: spendLogStatusSql(liteLLM_SpendLogs.status, liteLLM_SpendLogs.metadata),
		mcp_namespaced_tool_name: liteLLM_SpendLogs.mcp_namespaced_tool_name,
		agent_id: liteLLM_SpendLogs.agent_id,
		request_duration_ms: spendLogDurationSql(),
	};
}

/** Session 模拟专用投影，在轻量行上按需附带会话正文。 */
function uiSpendLogSelectionWithContent() {
	return {
		...uiSpendLogSelection(),
		messages: liteLLM_SpendLogs.messages,
		response: liteLLM_SpendLogs.response,
		proxy_server_request: liteLLM_SpendLogs.proxy_server_request,
	};
}

/**
 * Select only positions beyond the cumulative message-count high-water mark.
 * Rows whose count does not advance are conservatively rescanned at the tail,
 * which keeps retries and non-cumulative payloads observable without hashing
 * every message in every historical snapshot.
 * @param rows - Chronologically ordered timeline manifest rows.
 * @param includeAuxiliary - Whether Claude Code internal service calls remain visible.
 */

/**
 * Timeline manifest projection. Array payloads expose only their cheap count;
 * the payload query later extracts positions selected by the count high-water
 * plan. Non-array legacy payloads remain on the fallback path.
 */

/**
 * Claude Code auxiliary-call classification fields. This projection only runs
 * for manifest rows with at most two messages, so cumulative proxy snapshots
 * are never repeatedly decompressed for normal conversation requests.
 */

/**
 * Fetch only the message indexes selected from the compact manifest.
 * @param selectedIndicesJson - request_id to zero-based message indexes.
 */

/** 活跃请求转成与 UI SpendLog 列表兼容的轻量行。 */
function uiActiveRequestSelection() {
	return {
		request_id: liteLLM_ActiveRequests.request_id,
		call_type: liteLLM_ActiveRequests.call_type,
		api_key: liteLLM_ActiveRequests.api_key,
		spend: sql<number>`0`,
		total_tokens: sql<number>`0`,
		prompt_tokens: sql<number>`0`,
		completion_tokens: sql<number>`0`,
		startTime: liteLLM_ActiveRequests.startTime,
		endTime: sql<Date>`CURRENT_TIMESTAMP`,
		completionStartTime: liteLLM_ActiveRequests.completion_start_time,
		model: liteLLM_ActiveRequests.model,
		model_id: liteLLM_ActiveRequests.model_id,
		model_group: liteLLM_ActiveRequests.model_group,
		// ActiveRequests 侧非空，UNION 需要与 SpendLogs 侧的可空类型对齐。
		custom_llm_provider: sql<string | null>`${liteLLM_ActiveRequests.custom_llm_provider}`,
		api_base: sql<string | null>`${liteLLM_ActiveRequests.api_base}`,
		user: liteLLM_ActiveRequests.user,
		// 聚合中的响应正文只属于详情页，列表不重复下发（见 /spend/logs/ui/:request_id）。
		metadata: sql<unknown | null>`COALESCE(${liteLLM_ActiveRequests.metadata}, '{}'::jsonb) - 'streaming_execution' - 'responses_execution'`,
		cache_hit: sql<string | null>`'False'`,
		cache_key: sql<string | null>`NULL`,
		request_tags: sql<unknown | null>`${liteLLM_ActiveRequests.request_tags}`,
		team_id: liteLLM_ActiveRequests.team_id,
		organization_id: liteLLM_ActiveRequests.organization_id,
		end_user: liteLLM_ActiveRequests.end_user,
		requester_ip_address: liteLLM_ActiveRequests.requester_ip_address,
		session_id: liteLLM_ActiveRequests.session_id,
		session_group_key: sql<string | null>`NULL`,
		status: sql<string | null>`${liteLLM_ActiveRequests.status}`,
		mcp_namespaced_tool_name: sql<string | null>`NULL`,
		agent_id: sql<string | null>`NULL`,
		request_duration_ms: sql<number>`GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - ${liteLLM_ActiveRequests.startTime})) * 1000))::int`,
	};
}

/** Python UI logs duration expression: DB NULL fallback to endTime-startTime in milliseconds. */

/** metadata 仅在原生 JSON object 时参与通用字段过滤；历史 string 不做不安全 cast。 */

/**
 * JSONB metadata 可能是 object，也可能是包含 JSON object 的历史 string。
 * @param value
 */
function parseSpendLogMetadata(value: unknown): Record<string, unknown> | null {
	let parsed = value;
	if (typeof parsed === "string") {
		try {
			parsed = JSON.parse(parsed) as unknown;
		} catch {
			return null;
		}
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		return null;
	}
	return parsed as Record<string, unknown>;
}

/**
 * 严格识别 Claude Code SpendLog metadata 中的稳定 user ID。
 * @param metadata
 */
function readClaudeCodeUserId(metadata: unknown): string | null {
	const parsed = parseSpendLogMetadata(metadata);
	const spendMetadata = parsed?.spend_logs_metadata;
	if (spendMetadata === null || typeof spendMetadata !== "object" || Array.isArray(spendMetadata)) {
		return null;
	}
	const userId = (spendMetadata as Record<string, unknown>).user_id;
	if (typeof userId !== "string") {
		return null;
	}
	const normalized = userId.trim();
	return CLAUDE_CODE_USER_ID_PATTERN.test(normalized) ? normalized : null;
}

/**
 * 部分客户端把稳定 session_id 放在 spend_logs_metadata.user_id 的 JSON 字符串内，
 * 同时把顶层 session_id 设为每次请求的随机 UUID。
 * @param metadata
 */
function readEmbeddedUserSessionId(metadata: unknown): string | null {
	const parsed = parseSpendLogMetadata(metadata);
	const spendMetadata = parsed?.spend_logs_metadata;
	if (spendMetadata === null || typeof spendMetadata !== "object" || Array.isArray(spendMetadata)) {
		return null;
	}
	let userMetadata = (spendMetadata as Record<string, unknown>).user_id;
	if (typeof userMetadata === "string") {
		try {
			userMetadata = JSON.parse(userMetadata) as unknown;
		} catch {
			return null;
		}
	}
	if (userMetadata === null || typeof userMetadata !== "object" || Array.isArray(userMetadata)) {
		return null;
	}
	return normalizeSessionUuid((userMetadata as Record<string, unknown>).session_id);
}

/**
 * 读取 SpendTracker 已从 OpenAI/Codex client_metadata 提取的规范分组键。
 * @param metadata
 */
function readCanonicalSessionGroup(metadata: unknown): SessionGroupRef | null {
	const parsed = parseSpendLogMetadata(metadata);
	return parsePersistedSessionGroupKey(parsed?.session_group_key);
}

/**
 * 统一从原始/规范化 SpendLog 行派生 Session group。
 * @param row
 */
function withSessionGroup(row: Record<string, unknown>): Record<string, unknown> {
	const persistedGroup = parsePersistedSessionGroupKey(row.session_group_key);
	if (persistedGroup) {
		return {
			...row,
			session_group_type: persistedGroup.type,
			session_group_id: persistedGroup.id,
		};
	}
	const canonicalGroup = readCanonicalSessionGroup(row.metadata);
	if (canonicalGroup) {
		return {
			...row,
			session_group_type: canonicalGroup.type,
			session_group_id: canonicalGroup.id,
		};
	}
	const claudeCodeUserId = readClaudeCodeUserId(row.metadata);
	if (claudeCodeUserId) {
		return { ...row, session_group_type: "claude_code_user_id", session_group_id: claudeCodeUserId };
	}
	const embeddedUserSessionId = readEmbeddedUserSessionId(row.metadata);
	if (embeddedUserSessionId) {
		return { ...row, session_group_type: "session_id", session_group_id: embeddedUserSessionId };
	}
	const sessionId = typeof row.session_id === "string" ? row.session_id.trim() : "";
	return sessionId.length > 0
		? { ...row, session_group_type: "session_id", session_group_id: sessionId }
		: { ...row, session_group_type: null, session_group_id: null };
}

function parseKnownSessionTotal(value: unknown): number | null {
	if (value === undefined) {
		return null;
	}
	if (typeof value !== "string" || !/^\d+$/.test(value)) {
		throw new ApiError(HTTP_STATUS.BAD_REQUEST, "invalid known_total");
	}
	const total = Number(value);
	if (!Number.isSafeInteger(total)) {
		throw new ApiError(HTTP_STATUS.BAD_REQUEST, "invalid known_total");
	}
	return total;
}

function sessionPositionFromNormalizedRow(row: Record<string, unknown> | undefined): SessionPosition | null {
	return sessionPositionFromRow(row, "startTime", "request_id");
}

/**
 * 解析时间线窗口大小（最近多少个已落库请求）。
 *
 * 缺省用 {@link DEFAULT_SESSION_TIMELINE_WINDOW}，超过上限返回 400，不静默截断——
 * 让调用方知道请求被拒，而不是拿到一份看起来完整其实被裁剪的时间线。
 * @param value - 查询参数 `limit`
 * @throws {ApiError} 不是 1..{@link MAX_SESSION_TIMELINE_WINDOW} 的整数时返回 400
 */
function parseSessionTimelineWindow(value: unknown): number {
	if (value === undefined) {
		return DEFAULT_SESSION_TIMELINE_WINDOW;
	}
	if (typeof value !== "string" || !/^\d+$/.test(value)) {
		throw new ApiError(HTTP_STATUS.BAD_REQUEST, "invalid limit");
	}
	const limit = Number(value);
	if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_SESSION_TIMELINE_WINDOW) {
		throw new ApiError(HTTP_STATUS.BAD_REQUEST, `limit must be between 1 and ${MAX_SESSION_TIMELINE_WINDOW}`);
	}
	return limit;
}

function makeSessionPage(
	data: Record<string, unknown>[],
	total: number,
	page: number,
	pageSize: number,
	snapshot: SessionPosition | null,
	nextCursor: SessionPosition | null,
): UiSpendLogsPage {
	return {
		data: data,
		total: total,
		page: page,
		page_size: pageSize,
		total_pages: total === 0 ? 0 : Math.ceil(total / pageSize),
		...(snapshot ? { snapshot: encodeSessionPosition(snapshot) } : {}),
		...(nextCursor ? { next_cursor: encodeSessionPosition(nextCursor) } : {}),
	};
}

/**
 * resolve sort_by 白名单到 Drizzle 列
 * @param sortBy
 */
function resolveSortColumn(sortBy: SpendLogSortField): Column {
	switch (sortBy) {
		case "spend":
			return liteLLM_SpendLogs.spend;
		case "total_tokens":
			return liteLLM_SpendLogs.total_tokens;
		case "endTime":
			return liteLLM_SpendLogs.endTime;
		case "request_duration_ms":
			return spendLogDurationSql();
		case "startTime":
		default:
			return liteLLM_SpendLogs.startTime;
	}
}

/** UI 路径 where 条件构造入参 */
interface UiSpendLogsWhereArgs {
	startDate: Date;
	endDate: Date;
	teamId?: string;
	apiKey?: string;
	user?: string;
	requestId?: string;
	model?: string;
	modelId?: string;
	endUser?: string;
	statusFilter?: string;
	minSpend?: number;
	maxSpend?: number;
	keyAlias?: string;
	errorCode?: string;
	errorMessage?: string;
}

/**
 * 构造 /spend/logs/ui 与 /spend/logs/v2 共用的 where 条件。
 * 对齐 Python `ui_view_spend_logs` 的 SQL 拼接：
 * - 时间范围：`startTime >= ... AND startTime <= ...`
 * - 普通列等值：`team_id` / `user` / `api_key` / `request_id` / `model` / `model_id` / `end_user`
 * - status_filter=success → `(status = 'success' OR status IS NULL)`；其它精确匹配
 * - spend 范围
 * - JSONB metadata：`key_alias` → `metadata->>'user_api_key_alias' LIKE`；
 *   `error_code` → `metadata->'error_information'->>'error_code' =`；
 *   `error_message` → `metadata->'error_information'->>'error_message' LIKE`
 * @param args
 */
function buildUiSpendLogsWhereConditions(args: UiSpendLogsWhereArgs) {
	const conditions = [sql`${liteLLM_SpendLogs.startTime} >= ${args.startDate}`, sql`${liteLLM_SpendLogs.startTime} <= ${args.endDate}`];
	if (args.teamId !== undefined) {
		conditions.push(eq(liteLLM_SpendLogs.team_id, args.teamId));
	}
	if (args.apiKey !== undefined) {
		conditions.push(eq(liteLLM_SpendLogs.api_key, args.apiKey));
	}
	if (args.user !== undefined) {
		conditions.push(eq(liteLLM_SpendLogs.user, args.user));
	}
	if (args.requestId !== undefined) {
		conditions.push(eq(liteLLM_SpendLogs.request_id, args.requestId));
	}
	if (args.model !== undefined) {
		conditions.push(eq(spendLogExecutionModelSql(), args.model));
	}
	if (args.modelId !== undefined) {
		conditions.push(eq(liteLLM_SpendLogs.model_id, args.modelId));
	}
	if (args.endUser !== undefined) {
		conditions.push(eq(liteLLM_SpendLogs.end_user, args.endUser));
	}
	if (args.statusFilter !== undefined) {
		if (args.statusFilter === "success") {
			conditions.push(sql`(${liteLLM_SpendLogs.status} = 'success' OR ${liteLLM_SpendLogs.status} IS NULL)`);
		} else {
			conditions.push(sql`${spendLogStatusSql(liteLLM_SpendLogs.status, liteLLM_SpendLogs.metadata)} = ${args.statusFilter}`);
		}
	}
	if (args.minSpend !== undefined) {
		conditions.push(sql`${liteLLM_SpendLogs.spend} >= ${args.minSpend}`);
	}
	if (args.maxSpend !== undefined) {
		conditions.push(sql`${liteLLM_SpendLogs.spend} <= ${args.maxSpend}`);
	}
	if (args.keyAlias !== undefined) {
		conditions.push(sql`${spendLogMetadataJsonSql()}->>'user_api_key_alias' LIKE ${"%" + args.keyAlias + "%"}`);
	}
	if (args.errorCode !== undefined) {
		conditions.push(sql`${spendLogMetadataJsonSql()}->'error_information'->>'error_code' = ${args.errorCode}`);
	}
	if (args.errorMessage !== undefined) {
		conditions.push(sql`${spendLogMetadataJsonSql()}->'error_information'->>'error_message' LIKE ${"%" + args.errorMessage + "%"}`);
	}
	return and(...conditions);
}

/**
 * ActiveRequests 对齐 Logs 列表过滤；错误过滤必然排除尚无最终错误信息的请求。
 * @param args
 */
function buildActiveRequestsWhereConditions(args: UiSpendLogsWhereArgs) {
	const conditions = [
		sql`${liteLLM_ActiveRequests.startTime} >= ${args.startDate}`,
		sql`${liteLLM_ActiveRequests.startTime} <= ${args.endDate}`,
		gt(liteLLM_ActiveRequests.expires_at, new Date()),
		eq(liteLLM_ActiveRequests.status, "in_progress"),
	];
	if (args.teamId !== undefined) {
		conditions.push(eq(liteLLM_ActiveRequests.team_id, args.teamId));
	}
	if (args.apiKey !== undefined) {
		conditions.push(eq(liteLLM_ActiveRequests.api_key, args.apiKey));
	}
	if (args.user !== undefined) {
		conditions.push(eq(liteLLM_ActiveRequests.user, args.user));
	}
	if (args.requestId !== undefined) {
		conditions.push(eq(liteLLM_ActiveRequests.request_id, args.requestId));
	}
	if (args.model !== undefined) {
		conditions.push(eq(liteLLM_ActiveRequests.model, args.model));
	}
	if (args.modelId !== undefined) {
		conditions.push(eq(liteLLM_ActiveRequests.model_id, args.modelId));
	}
	if (args.endUser !== undefined) {
		conditions.push(eq(liteLLM_ActiveRequests.end_user, args.endUser));
	}
	if (args.statusFilter !== undefined && args.statusFilter !== "in_progress") {
		conditions.push(sql`FALSE`);
	}
	if (args.minSpend !== undefined && args.minSpend > 0) {
		conditions.push(sql`FALSE`);
	}
	if (args.maxSpend !== undefined && args.maxSpend < 0) {
		conditions.push(sql`FALSE`);
	}
	if (args.keyAlias !== undefined) {
		conditions.push(sql`${liteLLM_ActiveRequests.metadata}->>'user_api_key_alias' LIKE ${"%" + args.keyAlias + "%"}`);
	}
	if (args.errorCode !== undefined || args.errorMessage !== undefined) {
		conditions.push(sql`FALSE`);
	}
	return and(...conditions);
}

/**
 * 补全进行中行的会话分组与计数。
 *
 * 进行中的请求还没写 SpendLogs：会话分组来自注册时写入的 `metadata.session_group_key`
 * （与请求结束后一致），会话计数则是已落库的同伴数量再加它自己。
 * @param db - Drizzle 数据库实例
 * @param rows - 列表里的进行中行
 * @param visibilityClause - 可见性过滤
 */
async function enrichInProgressSessionCounts(
	db: NodePgDatabase<typeof schema>,
	rows: Record<string, unknown>[],
	visibilityClause: SQL,
): Promise<Record<string, unknown>[]> {
	if (rows.length === 0) {
		return rows;
	}
	const grouped = rows.map((row) => withSessionGroup(row));
	const groups = grouped.map(readSessionGroup);
	const groupKeys = collectSessionGroupKeys(groups);
	if (groupKeys.length === 0) {
		return grouped.map((row) => ({ ...row, session_total_count: 1 }));
	}
	const countMap = await queryCompletedSessionCounts(db, groupKeys, visibilityClause);
	return grouped.map((row, index) => {
		const group = groups[index] ?? null;
		const completed = group === null ? 0 : (countMap.get(sessionGroupKey(group)) ?? 0);
		return { ...row, session_total_count: group === null ? 1 : completed + 1 };
	});
}

/**
 * 去重后的 Session group key 列表，保持首次出现顺序。
 * @param groups - 行对应的会话分组（可能为空）
 */
function collectSessionGroupKeys(groups: (SessionGroupRef | null)[]): string[] {
	return Array.from(
		new Set(groups.filter((group): group is SessionGroupRef => group !== null).map((group) => sessionGroupKey(group))),
	);
}

/**
 * 按 Session group key 统计 SpendLogs 里的已完成行数。失败时记 warn 并返回空表。
 * @param db - Drizzle 数据库实例
 * @param groupKeys - 待统计的会话分组 key
 * @param visibilityClause - 可见性过滤
 */
async function queryCompletedSessionCounts(
	db: NodePgDatabase<typeof schema>,
	groupKeys: string[],
	visibilityClause: SQL,
): Promise<Map<string, number>> {
	const countMap = new Map<string, number>();
	if (groupKeys.length === 0) {
		return countMap;
	}
	try {
		const sessionCounts = await db
			.select({
				session_group_key: liteLLM_SpendLogs.session_group_key,
				total: sql<number>`COUNT(*)`,
			})
			.from(liteLLM_SpendLogs)
			.where(and(inArray(liteLLM_SpendLogs.session_group_key, groupKeys), visibilityClause))
			.groupBy(liteLLM_SpendLogs.session_group_key);
		for (const row of sessionCounts) {
			if (typeof row.session_group_key === "string" && row.session_group_key.length > 0) {
				countMap.set(row.session_group_key, toFiniteNumber(row.total));
			}
		}
	} catch (err) {
		logger.warn(`/spend/logs/ui session count enrichment failed: ${(err as Error).message}`);
	}
	return countMap;
}

/**
 * UI 路径 enrichment：按持久化 Session group key 批量查询总行数。
 * 普通 session_id 与 Claude Code user ID 使用同一个复合索引，不读取 metadata 全表。
 * 失败时记 warn 日志并退化为 session_total_count=1。
 * @param db
 * @param rows
 * @param visibilityClause
 */
async function enrichSessionCounts(
	db: NodePgDatabase<typeof schema>,
	rows: Record<string, unknown>[],
	visibilityClause: SQL,
): Promise<Record<string, unknown>[]> {
	const groups = rows.map(readSessionGroup);
	const groupKeys = collectSessionGroupKeys(groups);
	if (groupKeys.length === 0) {
		return rows.map((row) => ({ ...row, session_total_count: 1 }));
	}

	const countMap = await queryCompletedSessionCounts(db, groupKeys, visibilityClause);

	return rows.map((row, index) => {
		const group = groups[index];
		const total = group ? (countMap.get(sessionGroupKey(group)) ?? 1) : 1;
		return { ...row, session_total_count: total };
	});
}
