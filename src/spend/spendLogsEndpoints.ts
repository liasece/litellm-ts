/**
 * /spend/* 端点（keys/users/tags/logs/calculate）
 *
 * 从 SpendManagementEndpoint.ts 拆分出来，把 7 个明细 / 聚合 / 计算端点
 * 集中在一个文件里，main.ts 与单元测试仍通过 `registerSpendManagementEndpoints`
 * 间接调用本文件的 `registerSpendLogsEndpoints`。
 *
 * `/spend/logs/ui` 与 `/spend/logs/v2` 行为对齐 Python LiteLLM：
 *   - start_date 必填；`/spend/logs/ui` 的 end_date 可选（缺省取服务端 now），v2 的 end_date 必填。
 *     UI 只接受 `YYYY-MM-DD HH:MM:SS`，v2 同时接受 `YYYY-MM-DD`。
 *   - sort_by 仅允许白名单字段；非法返回 400。
 *   - sort_order 仅允许 asc / desc；非法返回 400。
 *   - 过滤：api_key / user_id / request_id / team_id / min_spend / max_spend /
 *     status_filter / model / model_id / key_alias / session_id / end_user / error_code / error_message。
 *   - 权限裁剪：admin 看全部；非 admin + team_id 时检查 team 可见性；
 *     internal_user 未传 team 时强制只看自己的 user；team member 看不可见 team 返回 403。
 *   - 主查询显式列投影，排除 messages / response / proxy_server_request 重 JSON 列。
 *   - 列表先按索引取当前页的行键，再按主键回表算重投影：metadata 剥载荷等表达式
 *     不会对整个时间窗逐行执行（见 selectMixedUiPageRowKeys / hydrateUiPageRows）。
 *   - UI 路径 enrichment session_total_count；v2 路径不 enrichment。
 *   - DB 异常抛 5xx，不返回空分页伪装成功。
 */

import type { Router } from "express";
import { sql, and, type SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "../db/schema";
import { registerRoute } from "../core/api/registerRoute";
import { ApiError, HTTP_STATUS } from "../core/api/ApiError";
import { costPerToken } from "../cost/CostCalculator";
import { adjustCost, costTrackingConfigService, resolveCostProvider } from "../cost/CostTrackingConfig";
import {
	AGGREGATE_DEFAULT_LIMIT,
	COLD_STORAGE_BATCH_CONCURRENCY,
	mapWithConcurrency,
	normalizeSortOrder,
	parseOptionalFloatQueryParam,
	parsePageParam,
	parsePageSizeParam,
	parseSpendLogDate,
	resolveUiSpendLogEndDate,
	runWithFallback,
	type SpendSortOrder,
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
import { hydrateSpendLogRows } from "./SpendLogBlocks";
import { spendReportingRepositoryFor } from "../repositories/SpendReportingRepository";
import {
	DEFAULT_SESSION_TIMELINE_WINDOW,
	MAX_SESSION_TIMELINE_WINDOW,
	createSessionImageLookup,
	loadSessionTimeline,
} from "./sessionTimelineLive";
import { CLAUDE_CODE_USER_ID_PATTERN, normalizeSessionUuid } from "./sessionIdentity";
import type { UserAPIKeyAuth } from "../types/auth";
import {
	isInternalUserRole,
	filterVisibleSpendRequestIds,
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
import { encodeSessionPosition, parseSessionPosition, sessionPositionFromRow, type SessionPosition } from "./sessionPosition";

const logger = createModuleLogger("SpendLogs");

/** 旧 `/spend/logs` 正文路径的单页硬上限；摘要路径仍沿用通用分页上限。 */
const LEGACY_CONTENT_PAGE_SIZE = 50;

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
			const result = await spendReportingRepositoryFor(db).sumSpendByApiKey(AGGREGATE_DEFAULT_LIMIT);

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
			const result = await spendReportingRepositoryFor(db).sumSpendByUser(AGGREGATE_DEFAULT_LIMIT);

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
			const result = await spendReportingRepositoryFor(db).sumSpendByRequestTagElement();

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
	// 默认只返回轻量标量行；需要历史正文时显式 include_content=true（单页最多 50 行）。
	// 行为契约：
	//   - 不带 api_key / user_id 过滤时，返回按 startTime 降序的明细行；空/失败时返回空 data
	//   - 带 api_key / user_id 过滤时按 filter 返回分页明细
	//   - 绝不在空结果时返回"本月每日 spend=0 假数据"（那是 /global/spend/logs 的职责）
	//   - DB 查询失败时返回空 data 并 warn 日志，不抛 5xx

	registerRoute(router, { method: "get", path: "/spend/logs" }, async (req) => {
		const page = parsePageParam(req.query.page);
		// WebUI 既传 pageSize（JS camelCase）也兼容 page_size（snake_case 协议）。
		// 正文路径单独收紧上限：50 行的真实正文实测可达 92 MB，不能沿用通用 1000 上限。
		const requestedPageSize = parsePageSizeParam(req.query.page_size, req.query.pageSize);
		const includeContent = req.query.include_content === "true";
		const pageSize = includeContent ? Math.min(requestedPageSize, LEGACY_CONTENT_PAGE_SIZE) : requestedPageSize;
		const apiKeyFilter = req.query.api_key as string | undefined;
		const userIdFilter = req.query.user_id as string | undefined;

		// 根因：Drizzle 链式 select / count 任一环节失败（DB 断连、字段不存在、drizzle schema 漂移）
		// 都直接 reject。这里返回旧分页空对象避免 WebUI Logs 页面炸 5xx；
		// 不再返回"本月每日 spend=0 假数据"——那是 /global/spend/logs 的职责，混用会导致
		// Monthly Spend BarChart 与 Logs 表格口径不一致。
		return runWithFallback(logger, "/spend/logs", makeEmptyLegacySpendLogsPage(page, pageSize), async () => {
			// 默认返回与 UI 列表同形的轻量行：旧调用方多数只需要分页与标量；
			// 正文必须显式传 include_content=true，且正文页大小有硬上限，避免一次拉回
			// 几十 MB 的 messages/proxy/response 把主线程和客户端一起拖住。
			const repository = spendReportingRepositoryFor(db);
			const rawRows = await repository.listLegacySpendLogsPage({
				apiKey: apiKeyFilter,
				userId: userIdFilter,
				includeContent: includeContent,
				pageSize: pageSize,
				offset: (page - 1) * pageSize,
			});
			const data = includeContent ? await hydrateSpendLogRows(db, rawRows) : rawRows;

			const total = await repository.countLegacySpendLogs({ apiKey: apiKeyFilter, userId: userIdFilter });

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
	// UI 路径日期格式为 `YYYY-MM-DD HH:MM:SS`，v2 路径额外接受 `YYYY-MM-DD`。
	// `/spend/logs/ui` 的两个日期都可选：都缺省表示「不过滤时间」（Dashboard 默认的
	// All Time），只给 end_date 表示上界，只给 start_date 时上界取服务端 now。
	// 上界取 now 而不是客户端整秒，是因为预设区间的上界恒为「现在」，客户端补整秒会切掉
	// 当前这一秒的毫秒部分，刚注册的在途行因此不可见（表现为 Live Tail 要等上游首字节才
	// 刷出行）；now 也避免受浏览器时钟影响。v2 保持与 Python 一致，两个日期都必填。
	// 错误不捕获为 fallback，让 registerRoute 返回 4xx/5xx。

	const handleUiSpendLogs = (isV2: boolean) => async (req: { query: Record<string, unknown>; auth?: UserAPIKeyAuth }) => {
		const page = parsePageParam(req.query.page);
		const pageSize = parsePageSizeParam(req.query.page_size, req.query.pageSize);

		const startDateRaw = req.query.start_date;
		const endDateRaw = req.query.end_date;
		const startDateProvided = typeof startDateRaw === "string" && startDateRaw.length > 0;
		const endDateProvided = typeof endDateRaw === "string" && endDateRaw.length > 0;
		if (isV2 && (!startDateProvided || !endDateProvided)) {
			throw new ApiError(HTTP_STATUS.BAD_REQUEST, "Start date and end date are required");
		}

		// UI 路径：两个日期都缺省即「不过滤时间」；只给 start_date 时上界取服务端 now。
		let startDateObj: Date | undefined;
		let endDateObj: Date | undefined;
		if (startDateProvided) {
			try {
				startDateObj = parseSpendLogDate(startDateRaw, isV2 ? "v2" : "ui");
			} catch (err) {
				throw new ApiError(HTTP_STATUS.BAD_REQUEST, (err as Error).message);
			}
		}
		if (endDateProvided) {
			try {
				endDateObj = isV2 ? parseSpendLogDate(endDateRaw, "v2") : resolveUiSpendLogEndDate(endDateRaw);
			} catch (err) {
				throw new ApiError(HTTP_STATUS.BAD_REQUEST, (err as Error).message);
			}
		} else if (startDateProvided && !isV2) {
			endDateObj = new Date();
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
		const sessionIdFilter = typeof req.query.session_id === "string" ? req.query.session_id.trim() : undefined;
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

		// where 条件（一次构造复用于 count + select）。可见性裁剪恒有返回值，这里再兜底一次
		// FALSE，避免条件意外变空时读到全表（All Time 只去掉时间谓词，不放宽可见性）。
		const repository = spendReportingRepositoryFor(db);
		const spendLogsWhereClause =
			and(
				repository.uiSpendLogsWhereClause({
					startDate: startDateObj,
					endDate: endDateObj,
					teamId: effectiveTeamId,
					apiKey: effectiveApiKey,
					user: effectiveUserId,
					requestId: requestIdFilter,
					model: modelFilter,
					modelId: modelIdFilter,
					endUser: endUserFilter,
					sessionId: sessionIdFilter || undefined,
					statusFilter: statusFilter,
					minSpend: minSpendFilter ?? undefined,
					maxSpend: maxSpendFilter ?? undefined,
					keyAlias: keyAliasFilter,
					errorCode: errorCodeFilter,
					errorMessage: errorMessageFilter,
				}),
				visibilityClause,
			) ?? sql`FALSE`;

		// count 查询：使用同一 whereClause，避免总数与明细不一致。
		const completedTotal = await repository.countSpendLogs(spendLogsWhereClause);
		const activeWhereClause = includeActive
			? and(
					repository.activeRequestsWhereClause({
						startDate: startDateObj,
						endDate: endDateObj,
						teamId: effectiveTeamId,
						apiKey: effectiveApiKey,
						user: effectiveUserId,
						requestId: requestIdFilter,
						model: modelFilter,
						modelId: modelIdFilter,
						endUser: endUserFilter,
						sessionId: sessionIdFilter || undefined,
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
		const activeTotal = activeWhereClause === undefined ? 0 : await repository.countActiveRequests(activeWhereClause);
		const total = completedTotal + activeTotal;
		const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);

		const pageOffset = (page - 1) * pageSize;
		let data: Record<string, unknown>[];
		if (activeWhereClause && sortBy === "startTime") {
			// startTime 是 ActiveRequests 与 SpendLogs 共有的真实字段：两表各自按
			// (startTime, request_id) 取当前页的行键后归并，request_id 作为时间相同时的
			// 稳定排序键，避免两表在分页边界处产生不确定顺序。重投影在回表时才算。
			const mixedRows = await repository.hydrateUiPageRows(
				await repository.selectMixedUiPageRowKeys(activeWhereClause, spendLogsWhereClause, sortOrder, pageSize, pageOffset),
			);
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
			const activeKeys =
				activeWhereClause && activeOffset < activeTotal
					? await repository.listActivePageRequestKeys(activeWhereClause, sortOrder, pageSize, activeOffset)
					: [];
			const activeRows = await repository.hydrateUiPageRows(activeKeys);
			const completedLimit = Math.max(0, pageSize - activeRows.length);
			const completedOffset = Math.max(0, pageOffset - activeTotal);
			const completedKeys =
				completedLimit > 0
					? await repository.listSpendPageRequestKeys(spendLogsWhereClause, sortBy, sortOrder, completedLimit, completedOffset)
					: [];
			const completedRows = await repository.hydrateUiPageRows(completedKeys);

			const normalizedCompletedRows = completedRows.map((row) =>
				withSessionGroup(normalizeUiSpendLogRow(row as Record<string, unknown>)),
			);
			// UI 路径 enrichment session_total_count；v2 路径不 enrichment。
			const completedData = isV2 ? normalizedCompletedRows : await enrichSessionCounts(db, normalizedCompletedRows, visibilityClause);
			const normalizedActiveRows = activeRows.map((row) => normalizeUiSpendLogRow(row as Record<string, unknown>));
			const activeData = isV2
				? normalizedActiveRows.map((row) => ({ ...row, session_total_count: 1 }))
				: await enrichInProgressSessionCounts(db, normalizedActiveRows, visibilityClause);
			// 在途行与已结算行可能短暂同名（结算提交落在两次查询之间），并集后再收敛一次。
			data = dedupeSpendLogRows([...activeData, ...completedData]);
		}

		// 最后一层保险：任何分支都不把同一个 request_id 的两行交给前端。前端以 request_id
		// 作为行标识，重复标识会让虚拟表格复用错位、渲染成多条一模一样的行。
		const response: UiSpendLogsPage = {
			data: dedupeSpendLogRows(data),
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
		const repository = spendReportingRepositoryFor(db);
		const baseClause = and(repository.sessionGroupClause(sessionGroupKey(group)), visibilityClause) as SQL;
		let effectiveSnapshot = snapshot;
		if (!effectiveSnapshot) {
			effectiveSnapshot = sessionPositionFromRow(
				await repository.findSessionSnapshotPosition(baseClause),
				"snapshotStartTime",
				"snapshotRequestId",
			);
		}

		const boundedClause = (
			effectiveSnapshot ? and(baseClause, repository.sessionSnapshotClause(effectiveSnapshot)) : baseClause
		) as SQL;
		let total = knownTotal;
		if (total === null) {
			total = await repository.countSpendLogs(boundedClause);
		}
		if (total === 0) {
			effectiveSnapshot = null;
		}
		const legacySkip = cursor ? 0 : (page - 1) * pageSize;
		const detailClause = cursor ? (and(boundedClause, repository.sessionCursorClause(cursor)) as SQL) : boundedClause;
		const selectedRows = await repository.listSessionDetailRows({
			whereClause: detailClause,
			includeContent: includeContent,
			limit: legacySkip + pageSize + 1,
		});
		// 会话模拟带正文时按块组装：整批引用合并成一次块查询。
		const rows = includeContent ? await hydrateSpendLogRows(db, selectedRows) : selectedRows;
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
		const requestedTeamId = typeof req.query.team_id === "string" && req.query.team_id.length > 0 ? req.query.team_id : undefined;
		const visibilityStartedAt = performance.now();
		const visibilityClause = await resolveSpendVisibilityClause(db, req.auth, requestedTeamId);
		recordTiming("visibility", visibilityStartedAt);
		const before = parseSessionPosition(req.query.before, "before");
		const after = parseSessionPosition(req.query.after, "after");
		const rawDirection = req.query.direction;
		if (rawDirection !== undefined && rawDirection !== "forward" && rawDirection !== "backward") {
			throw new ApiError(HTTP_STATUS.BAD_REQUEST, "invalid direction");
		}
		const direction = rawDirection === "forward" ? "forward" : "backward";
		if ((before && after) || (direction === "forward" && before) || (direction === "backward" && after)) {
			throw new ApiError(HTTP_STATUS.BAD_REQUEST, "before and after are mutually exclusive");
		}
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
				before: direction === "backward" ? before : null,
				after: direction === "forward" ? after : null,
				direction: direction,
			},
		);
		res.setHeader("Server-Timing", timings.map((timing) => `${timing.name};dur=${timing.durationMs.toFixed(1)}`).join(", "));
		return payload;
	});

	// ========== /spend/logs/ui/batch ==========
	// Session 模拟批量补齐重列：每批最多 100 条。逐条保留冷存储优先语义，
	// 未命中的 request_id 合并成一次 DB 查询，避免大 Session 产生数百次 HTTP/SQL 往返。
	registerRoute(router, { method: "post", path: "/spend/logs/ui/batch" }, async (req) => {
		const requests = parseSpendLogDetailBatch(req.body);
		// 批量详情同样按 request_id 直读；先裁剪到可见集合，避免绕过列表读别人的正文。
		const visibleRequestIds = await filterVisibleSpendRequestIds(
			db,
			req.auth,
			requests.map((detailRequest) => detailRequest.request_id),
		);
		const loadableRequests = requests.filter((detailRequest) => visibleRequestIds.has(detailRequest.request_id));
		const coldStoragePayloads = await mapWithConcurrency(loadableRequests, COLD_STORAGE_BATCH_CONCURRENCY, async (detailRequest) => {
			const payload = await getRequestResponsePayloadFromColdStorage(
				detailRequest.request_id,
				parseOptionalDetailDate(detailRequest.start_date),
				parseOptionalDetailDate(detailRequest.end_date),
				(_coldStorageLogger, error) => logger.warn(`/spend/logs/ui/batch 冷存储回查失败: ${(error as Error).message}`),
			);
			return [detailRequest.request_id, payload] as const;
		});
		const coldStorageByRequestId = new Map(coldStoragePayloads);
		const databaseRequestIds = loadableRequests
			.map((detailRequest) => detailRequest.request_id)
			.filter((requestId) => coldStorageByRequestId.get(requestId) === null);

		// 冷存储 payload 与落库同源，也可能带块引用；批量补缺和单条详情必须走同一套
		// 组装与 compact 形状，否则前端缓存里会出现“有的行带引用、有的行已展开”的混合状态。
		const coldStorageRows = coldStoragePayloads.flatMap(([requestId, payload]) => {
			if (payload === null) {
				return [];
			}
			return [
				{
					...payload,
					request_id: requestId,
					messages: payload["messages"],
					proxy_server_request: payload["proxy_server_request"],
				},
			];
		});
		const hydratedColdStorageRows =
			coldStorageRows.length === 0 ? [] : await hydrateSpendLogRows(db, coldStorageRows, { compactAliases: true });
		const hydratedColdStorageByRequestId = new Map(hydratedColdStorageRows.map((row) => [String(row.request_id), row] as const));

		const databaseRows =
			databaseRequestIds.length === 0
				? []
				: await hydrateSpendLogRows(db, await spendReportingRepositoryFor(db).listSpendLogPayloadColumns(databaseRequestIds), {
						compactAliases: true,
					});
		const databaseByRequestId = new Map(databaseRows.map((row) => [row.request_id, row] as const));

		return {
			data: requests.map((detailRequest) => ({
				...(hydratedColdStorageByRequestId.get(detailRequest.request_id) ??
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
		const visibleRequestIds = await filterVisibleSpendRequestIds(db, req.auth, [requestId]);
		if (!visibleRequestIds.has(requestId)) {
			// 与列表一致：不可见与不存在都返回 null，避免通过详情接口探测别人的 request_id。
			return null;
		}

		// PY: 可选 start_date / end_date 查询参数（YYYY-MM-DD HH:MM:SS），透传给冷存储 logger 收窄回查窗口。
		// compact 是详情默认读形状：顶层 messages 只展开一次，重复别名保留提示标记。单次详情
		// 在非 compact 下会把同一段对话展开三份（messages / proxy_server_request / 上游请求），
		// 大请求实测从 177KB 涨到 466KB(gzip)；dashboard 一直显式传 compact=true，默认值只影响
		// 手工排查。需要完整展开时传 compact=false。
		return await buildUiSpendLogDetail(
			db,
			requestId,
			parseOptionalDetailDate(req.query.start_date),
			parseOptionalDetailDate(req.query.end_date),
			{ compactAliases: req.query.compact !== "false" },
		);
	});

	// ========== /spend/calculate ==========

	registerRoute(router, { method: "post", path: "/spend/calculate" }, async (req) => {
		const body = req.body ?? {};
		const model = (body.model as string) ?? "";
		const provider = typeof body.custom_llm_provider === "string" ? body.custom_llm_provider : undefined;
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
				provider: provider,
			}));
		} catch (err) {
			logger.warn(`/spend/calculate cost query failed: ${(err as Error).message}`);
			totalCost = 0;
		}
		// 与落账/响应头同口径：按 provider 折扣与保证金调整（默认空配置不改变金额）。
		// 这里没有 deployment 上下文，provider 只能从模型名前缀解析。
		totalCost = adjustCost(totalCost, resolveCostProvider(provider, model), costTrackingConfigService.getSnapshot()).total;
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

/**
 * 一页里同一个 request_id 只能出现一行，已结算的那一行优先。
 *
 * 与分页键去重同一类竞态的兜底：即使分页键去重后，回表兜底与 session
 * 计数补充之间仍可能跨越提交边界。这里放在响应出口，保证前端拿到的每页行标识唯一。
 * @param rows - 拼装完成的行
 */
function dedupeSpendLogRows(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
	if (rows.length < 2) {
		return rows;
	}
	const byId = new Map<string, number>();
	const result: Array<Record<string, unknown>> = [];
	let dropped = 0;
	for (const row of rows) {
		const id = typeof row.request_id === "string" ? row.request_id : "";
		const index = id ? byId.get(id) : undefined;
		if (index === undefined) {
			if (id) {
				byId.set(id, result.length);
			}
			result.push(row);
			continue;
		}
		dropped += 1;
		if (result[index]?.status === "in_progress" && row.status !== "in_progress") {
			result[index] = row;
		}
	}
	if (dropped > 0) {
		logger.warn("列表页内出现重复 request_id，已收敛为一行", { dropped: dropped });
	}
	return dropped > 0 ? result : rows;
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
	return Array.from(new Set(groups.filter((group): group is SessionGroupRef => group !== null).map((group) => sessionGroupKey(group))));
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
		const sessionCounts = await spendReportingRepositoryFor(db).countSpendLogsBySessionGroup(groupKeys, visibilityClause);
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
