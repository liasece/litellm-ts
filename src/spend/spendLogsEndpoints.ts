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
import { LiteLLM_TeamTable } from "../db/schema/teams";
import { registerRoute } from "../core/api/registerRoute";
import { ApiError, HTTP_STATUS } from "../core/api/ApiError";
import { costPerToken } from "../cost/CostCalculator";
import {
	AGGREGATE_DEFAULT_LIMIT,
	SpendSortOrder,
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
import type { Column } from "./spendManagementTypes";
import type { UserAPIKeyAuth } from "../types/auth";
import { PROXY_ADMIN_ROLE } from "../types/webUiSession";

const logger = createModuleLogger("SpendLogs");

/** Python LiteLLM 兼容 sort_by 白名单 */
const SPEND_LOG_SORT_FIELDS = ["spend", "total_tokens", "startTime", "endTime", "request_duration_ms"] as const;
type SpendLogSortField = (typeof SPEND_LOG_SORT_FIELDS)[number];

/** Python LiteLLM proxy admin / viewer 角色字面量 */
const PROXY_ADMIN_VIEWER_ROLE = "proxy_admin_viewer";

/** HTTP 403 Forbidden 字面量 */
const HTTP_FORBIDDEN = 403;

/** Python LiteLLM internal user / viewer 角色字面量 */
const INTERNAL_USER_ROLE = "internal_user";
const INTERNAL_USER_VIEWER_ROLE = "internal_user_viewer";

type SessionGroupType = "claude_code_user_id" | "session_id";
const SPEND_LOG_DETAIL_BATCH_SIZE = 100;
const COLD_STORAGE_BATCH_CONCURRENCY = 8;

const CLAUDE_CODE_USER_ID_PATTERN =
	/^user_[A-Za-z0-9_-]+_account_[A-Za-z0-9_-]*_session_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SESSION_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
		const isAdminView = !!auth && (auth.user_role === PROXY_ADMIN_ROLE || auth.user_role === PROXY_ADMIN_VIEWER_ROLE);

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
			let completedIndex = 0;
			data = normalizedRows.map((row) => {
				return row.status === "in_progress"
					? { ...row, session_total_count: 1 }
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
			const normalizedActiveRows = activeRows.map((row) => ({
				...normalizeUiSpendLogRow(row as Record<string, unknown>),
				session_total_count: 1,
			}));
			data = [...normalizedActiveRows, ...completedData];
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
		const legacySessionId = req.query.session_id;
		const sessionGroupType = req.query.session_group_type;
		const sessionGroupId = req.query.session_group_id;
		const hasLegacySessionId = legacySessionId !== undefined;
		const hasSessionGroupType = sessionGroupType !== undefined;
		const hasSessionGroupId = sessionGroupId !== undefined;

		if (hasLegacySessionId && (hasSessionGroupType || hasSessionGroupId)) {
			throw new ApiError(HTTP_STATUS.BAD_REQUEST, "session_id cannot be combined with session group parameters");
		}

		let group: SessionGroupRef;
		if (hasLegacySessionId) {
			if (typeof legacySessionId !== "string" || legacySessionId.length === 0) {
				throw new ApiError(HTTP_STATUS.BAD_REQUEST, "session_id is required");
			}
			group = { type: "session_id", id: legacySessionId };
		} else {
			if (
				!hasSessionGroupType ||
				!hasSessionGroupId ||
				typeof sessionGroupType !== "string" ||
				typeof sessionGroupId !== "string" ||
				sessionGroupId.length === 0 ||
				(sessionGroupType !== "session_id" && sessionGroupType !== "claude_code_user_id")
			) {
				throw new ApiError(HTTP_STATUS.BAD_REQUEST, "valid session group parameters are required");
			}
			const normalizedGroupId = sessionGroupId.trim();
			if (sessionGroupType === "claude_code_user_id" && !CLAUDE_CODE_USER_ID_PATTERN.test(normalizedGroupId)) {
				throw new ApiError(HTTP_STATUS.BAD_REQUEST, "invalid Claude Code session group");
			}
			group = { type: sessionGroupType, id: normalizedGroupId };
		}

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
	// 对齐 PY ui_view_request_response_for_request_id（spend_management_endpoints.py:2028-2048）：
	// 先遍历冷存储 CustomLogger（S3/GCS 等），任一返回非 null payload 即采用；
	// 无注册实现或全部未命中时回落 DB 重列。

	registerRoute(router, { method: "get", path: "/spend/logs/ui/:request_id" }, async (req) => {
		const requestId = req.params.request_id;
		if (!requestId) {
			return null;
		}

		// PY: 可选 start_date / end_date 查询参数（YYYY-MM-DD HH:MM:SS），透传给冷存储 logger 收窄回查窗口
		const startDateObj = parseOptionalDetailDate(req.query.start_date);
		const endDateObj = parseOptionalDetailDate(req.query.end_date);

		const coldStoragePayload = await getRequestResponsePayloadFromColdStorage(
			requestId as string,
			startDateObj,
			endDateObj,
			(_coldStorageLogger, error) => logger.warn(`/spend/logs/ui/:request_id 冷存储回查失败: ${(error as Error).message}`),
		);
		if (coldStoragePayload !== null) {
			return coldStoragePayload;
		}

		const rows = await db
			.select({
				messages: liteLLM_SpendLogs.messages,
				response: liteLLM_SpendLogs.response,
				proxy_server_request: liteLLM_SpendLogs.proxy_server_request,
			})
			.from(liteLLM_SpendLogs)
			.where(eq(liteLLM_SpendLogs.request_id, requestId as string))
			.limit(1);

		return rows.at(0) ?? null;
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

async function mapWithConcurrency<T, R>(
	items: readonly T[],
	concurrency: number,
	mapper: (item: T) => Promise<R>,
): Promise<R[]> {
	const results = new Array<R>(items.length);
	let nextIndex = 0;
	const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
		while (nextIndex < items.length) {
			const index = nextIndex;
			nextIndex += 1;
			results[index] = await mapper(items[index]!);
		}
	});
	await Promise.all(workers);
	return results;
}

/**
 * 判断用户角色是否为 internal_user / internal_user_viewer（Python `_can_user_view_spend_log`）。
 * @param auth
 */
function isInternalUserRole(auth: UserAPIKeyAuth | undefined): boolean {
	if (!auth) {
		return false;
	}
	return auth.user_role === INTERNAL_USER_ROLE || auth.user_role === INTERNAL_USER_VIEWER_ROLE;
}

/**
 * 列表、Session count 和 Session detail 共用的认证可见性边界。
 * @param db
 * @param auth
 * @param requestedTeamId
 */
async function resolveSpendVisibilityClause(
	db: NodePgDatabase<typeof schema>,
	auth: UserAPIKeyAuth | undefined,
	requestedTeamId?: string,
): Promise<SQL> {
	if (auth && (auth.user_role === PROXY_ADMIN_ROLE || auth.user_role === PROXY_ADMIN_VIEWER_ROLE)) {
		return requestedTeamId === undefined ? sql`TRUE` : eq(liteLLM_SpendLogs.team_id, requestedTeamId);
	}
	if (requestedTeamId !== undefined) {
		if (!(await canTeamMemberViewLog(db, auth, requestedTeamId))) {
			throw new ApiError(HTTP_FORBIDDEN, "Not authorized to view requested team spend");
		}
		return eq(liteLLM_SpendLogs.team_id, requestedTeamId);
	}
	if (isInternalUserRole(auth) && auth?.user_id) {
		return eq(liteLLM_SpendLogs.user, auth.user_id);
	}
	if (auth?.team_id) {
		return eq(liteLLM_SpendLogs.team_id, auth.team_id);
	}
	if (auth?.user_id) {
		return eq(liteLLM_SpendLogs.user, auth.user_id);
	}
	return sql`FALSE`;
}

/**
 * ActiveRequests 使用与 SpendLogs 相同的可见性决策。requestedTeamId 的成员校验已由
 * resolveSpendVisibilityClause 完成，此处只把同一决策映射到活跃表列。
 * @param auth
 * @param requestedTeamId
 */
function resolveActiveRequestVisibilityClause(auth: UserAPIKeyAuth | undefined, requestedTeamId?: string): SQL {
	if (auth && (auth.user_role === PROXY_ADMIN_ROLE || auth.user_role === PROXY_ADMIN_VIEWER_ROLE)) {
		return requestedTeamId === undefined ? sql`TRUE` : eq(liteLLM_ActiveRequests.team_id, requestedTeamId);
	}
	if (requestedTeamId !== undefined) {
		return eq(liteLLM_ActiveRequests.team_id, requestedTeamId);
	}
	if (isInternalUserRole(auth) && auth?.user_id) {
		return eq(liteLLM_ActiveRequests.user, auth.user_id);
	}
	if (auth?.team_id) {
		return eq(liteLLM_ActiveRequests.team_id, auth.team_id);
	}
	if (auth?.user_id) {
		return eq(liteLLM_ActiveRequests.user, auth.user_id);
	}
	return sql`FALSE`;
}

/**
 * Python `_can_team_member_view_log`：team 存在且用户在 team admins 列表中。
 * @param db
 * @param auth
 * @param teamId
 */
async function canTeamMemberViewLog(db: NodePgDatabase<typeof schema>, auth: UserAPIKeyAuth | undefined, teamId: string): Promise<boolean> {
	if (!auth || !auth.user_id) {
		return false;
	}
	const rows = await db
		.select({
			admins: LiteLLM_TeamTable.admins,
			membersWithRoles: LiteLLM_TeamTable.membersWithRoles,
		})
		.from(LiteLLM_TeamTable)
		.where(eq(LiteLLM_TeamTable.teamId, teamId))
		.limit(1);
	const team = rows.at(0);
	if (!team) {
		return false;
	}
	const adminList = Array.isArray(team.admins) ? team.admins : [];
	if (adminList.includes(auth.user_id)) {
		return true;
	}
	const roles = (team.membersWithRoles as Record<string, { role?: string }> | null) ?? null;
	const role = roles?.[auth.user_id]?.role;
	return role === "admin";
}

/** UI 日志列表共用轻量投影，排除请求/响应等重 JSON 字段。 */
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
		model: liteLLM_SpendLogs.model,
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
		status: sql<string | null>`${liteLLM_SpendLogs.status}`,
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
		completionStartTime: sql<Date | null>`NULL`,
		model: liteLLM_ActiveRequests.model,
		model_id: liteLLM_ActiveRequests.model_id,
		model_group: liteLLM_ActiveRequests.model_group,
		custom_llm_provider: sql<string | null>`''`,
		api_base: sql<string | null>`''`,
		user: liteLLM_ActiveRequests.user,
		metadata: sql<unknown | null>`${liteLLM_ActiveRequests.metadata}`,
		cache_hit: sql<string | null>`'False'`,
		cache_key: sql<string | null>`NULL`,
		request_tags: sql<unknown | null>`${liteLLM_ActiveRequests.request_tags}`,
		team_id: liteLLM_ActiveRequests.team_id,
		organization_id: liteLLM_ActiveRequests.organization_id,
		end_user: liteLLM_ActiveRequests.end_user,
		requester_ip_address: liteLLM_ActiveRequests.requester_ip_address,
		session_id: sql<string | null>`NULL`,
		session_group_key: sql<string | null>`NULL`,
		status: sql<string | null>`${liteLLM_ActiveRequests.status}`,
		mcp_namespaced_tool_name: sql<string | null>`NULL`,
		agent_id: sql<string | null>`NULL`,
		request_duration_ms: sql<number>`GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - ${liteLLM_ActiveRequests.startTime})) * 1000))::int`,
	};
}

/** Python UI logs duration expression: DB NULL fallback to endTime-startTime in milliseconds. */
function spendLogDurationSql() {
	return sql<number>`COALESCE(${liteLLM_SpendLogs.request_duration_ms}, GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (${liteLLM_SpendLogs.endTime} - ${liteLLM_SpendLogs.startTime})) * 1000))::int)`;
}

/** metadata 仅在原生 JSON object 时参与通用字段过滤；历史 string 不做不安全 cast。 */
function spendLogMetadataJsonSql() {
	return sql`CASE WHEN jsonb_typeof(${liteLLM_SpendLogs.metadata}) = 'object' THEN ${liteLLM_SpendLogs.metadata} ELSE '{}'::jsonb END`;
}

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
	const sessionId = (userMetadata as Record<string, unknown>).session_id;
	if (typeof sessionId !== "string") {
		return null;
	}
	const normalized = sessionId.trim();
	return SESSION_UUID_PATTERN.test(normalized) ? normalized : null;
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

interface SessionPosition {
	readonly startTime: Date;
	readonly requestId: string;
}

function parseSessionPosition(value: unknown, parameterName: string): SessionPosition | null {
	if (value === undefined) {
		return null;
	}
	if (typeof value !== "string" || value.length === 0) {
		throw new ApiError(HTTP_STATUS.BAD_REQUEST, `invalid ${parameterName}`);
	}
	try {
		const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
		const startTime = typeof decoded.startTime === "string" ? new Date(decoded.startTime) : null;
		const requestId = decoded.requestId;
		if (!startTime || Number.isNaN(startTime.getTime()) || typeof requestId !== "string" || requestId.length === 0) {
			throw new Error("invalid position");
		}
		return { startTime: startTime, requestId: requestId };
	} catch {
		throw new ApiError(HTTP_STATUS.BAD_REQUEST, `invalid ${parameterName}`);
	}
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

function encodeSessionPosition(position: SessionPosition): string {
	return Buffer.from(JSON.stringify({ startTime: position.startTime.toISOString(), requestId: position.requestId }), "utf8").toString(
		"base64url",
	);
}

function sessionPositionFromRow(
	row: Record<string, unknown> | undefined,
	startTimeKey: string,
	requestIdKey: string,
): SessionPosition | null {
	if (!row) {
		return null;
	}
	const rawStartTime = row[startTimeKey];
	const startTime = rawStartTime instanceof Date ? rawStartTime : typeof rawStartTime === "string" ? new Date(rawStartTime) : null;
	const requestId = row[requestIdKey];
	if (!startTime || Number.isNaN(startTime.getTime()) || typeof requestId !== "string" || requestId.length === 0) {
		return null;
	}
	return { startTime: startTime, requestId: requestId };
}

function sessionPositionFromNormalizedRow(row: Record<string, unknown> | undefined): SessionPosition | null {
	return sessionPositionFromRow(row, "startTime", "request_id");
}

function sessionSnapshotClause(snapshot: SessionPosition): SQL {
	return sql`(${liteLLM_SpendLogs.startTime}, ${liteLLM_SpendLogs.request_id}) <= (${snapshot.startTime}, ${snapshot.requestId})`;
}

function sessionCursorClause(cursor: SessionPosition): SQL {
	return sql`(${liteLLM_SpendLogs.startTime}, ${liteLLM_SpendLogs.request_id}) > (${cursor.startTime}, ${cursor.requestId})`;
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
		conditions.push(eq(liteLLM_SpendLogs.model, args.model));
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
			conditions.push(sql`${liteLLM_SpendLogs.status} = ${args.statusFilter}`);
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
	const groupKeys = Array.from(
		new Set(groups.filter((group): group is SessionGroupRef => group !== null).map((group) => sessionGroupKey(group))),
	);
	if (groupKeys.length === 0) {
		return rows.map((row) => ({ ...row, session_total_count: 1 }));
	}

	const countMap = new Map<string, number>();
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

	return rows.map((row, index) => {
		const group = groups[index];
		const total = group ? (countMap.get(sessionGroupKey(group)) ?? 1) : 1;
		return { ...row, session_total_count: total };
	});
}

interface SessionGroupRef {
	readonly type: SessionGroupType;
	readonly id: string;
}

function readSessionGroup(row: Record<string, unknown>): SessionGroupRef | null {
	const type = row.session_group_type;
	const id = row.session_group_id;
	if ((type !== "session_id" && type !== "claude_code_user_id") || typeof id !== "string" || id.length === 0) {
		return null;
	}
	return { type: type, id: id };
}

function sessionGroupKey(group: SessionGroupRef): string {
	return `${group.type === "claude_code_user_id" ? "c" : "s"}:${group.id}`;
}

function parsePersistedSessionGroupKey(value: unknown): SessionGroupRef | null {
	if (typeof value !== "string" || value.length < 3) {
		return null;
	}
	if (value.startsWith("c:")) {
		const id = value.slice(2);
		return CLAUDE_CODE_USER_ID_PATTERN.test(id) ? { type: "claude_code_user_id", id: id } : null;
	}
	if (value.startsWith("s:")) {
		const id = value.slice(2);
		return id.length > 0 ? { type: "session_id", id: id } : null;
	}
	return null;
}
