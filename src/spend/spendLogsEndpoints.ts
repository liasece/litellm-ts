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
import { eq, sql, and, desc, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "../db/schema";
import { liteLLM_SpendLogs } from "../db/schema/spendLogs";
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
}

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

		if (!isAdminView) {
			if (effectiveTeamId !== undefined) {
				const canView = await canTeamMemberViewLog(db, auth, effectiveTeamId);
				if (!canView) {
					throw new ApiError(HTTP_FORBIDDEN, `Not authorized to view team spend for team_id=${effectiveTeamId}`);
				}
			} else if (isInternalUserRole(auth) && auth?.user_id) {
				effectiveUserId = auth.user_id;
			}
		}

		// 显式列投影：排除重 JSON 列 (messages / response / proxy_server_request)。
		// standard_logging_object 不属于 Python SpendLogs schema，不应出现在投影中。
		// request_duration_ms 在 Python 端用 COALESCE 兼容 NULL，本处直接选原列；
		// Drizzle 会把 NULL 暴露给调用方（前端无需补 0 即可展示）。
		const dataQuery = db
			.select({
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
				custom_llm_provider: liteLLM_SpendLogs.custom_llm_provider,
				api_base: liteLLM_SpendLogs.api_base,
				user: liteLLM_SpendLogs.user,
				metadata: liteLLM_SpendLogs.metadata,
				cache_hit: liteLLM_SpendLogs.cache_hit,
				cache_key: liteLLM_SpendLogs.cache_key,
				request_tags: liteLLM_SpendLogs.request_tags,
				team_id: liteLLM_SpendLogs.team_id,
				organization_id: liteLLM_SpendLogs.organization_id,
				end_user: liteLLM_SpendLogs.end_user,
				requester_ip_address: liteLLM_SpendLogs.requester_ip_address,
				session_id: liteLLM_SpendLogs.session_id,
				status: liteLLM_SpendLogs.status,
				mcp_namespaced_tool_name: liteLLM_SpendLogs.mcp_namespaced_tool_name,
				agent_id: liteLLM_SpendLogs.agent_id,
				request_duration_ms: spendLogDurationSql(),
			})
			.from(liteLLM_SpendLogs);

		// where 条件（一次构造复用于 count + select）
		const whereClause = buildUiSpendLogsWhereConditions({
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
		});

		// count 查询：使用同一 whereClause，避免总数与明细不一致
		const countRow = await db
			.select({ count: sql<number>`COUNT(*)` })
			.from(liteLLM_SpendLogs)
			.where(whereClause);
		const total = toFiniteNumber(countRow[0]?.count);
		const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);

		const sortColumn: Column = resolveSortColumn(sortBy);
		const orderExpr = sortOrder === SpendSortOrder.ASC ? sql`${sortColumn} ASC` : sql`${sortColumn} DESC`;

		const rows = await dataQuery
			.where(whereClause)
			.orderBy(orderExpr)
			.limit(pageSize)
			.offset((page - 1) * pageSize);

		const normalizedRows = rows.map((row) => normalizeUiSpendLogRow(row as Record<string, unknown>));

		// UI 路径 enrichment session_total_count；v2 路径不 enrichment
		const data = isV2 ? normalizedRows : await enrichSessionCounts(db, normalizedRows);

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
 * Python `_can_team_member_view_log`：team 存在且用户在 team admins 列表中。
 *
 * TS schema `membersWithRoles` 是 jsonb 对象；典型形态 `{ "<userId>": { role: "admin" | "member" } }`。
 * 这里做宽松解析：`admins` 数组中包含 `user_id` 或 `membersWithRoles[user_id].role === "admin"`。
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

/** Python UI logs duration expression: DB NULL fallback to endTime-startTime in milliseconds. */
function spendLogDurationSql() {
	return sql<number>`COALESCE(${liteLLM_SpendLogs.request_duration_ms}, GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (${liteLLM_SpendLogs.endTime} - ${liteLLM_SpendLogs.startTime})) * 1000))::int)`;
}

/** metadata may be historical JSON string; normalize to JSONB object before path filtering. */
function spendLogMetadataJsonSql() {
	return sql`CASE WHEN jsonb_typeof(${liteLLM_SpendLogs.metadata}) = 'string' THEN (${liteLLM_SpendLogs.metadata} #>> '{}')::jsonb ELSE ${liteLLM_SpendLogs.metadata} END`;
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
 * UI 路径 enrichment：每个非空 session_id 查询该 session 的总行数。
 * 对齐 Python `_build_ui_spend_logs_response(enrich_session_counts=True)`。
 * 失败时记 warn 日志并退化为 session_total_count=1。
 * @param db
 * @param rows
 */
async function enrichSessionCounts(db: NodePgDatabase<typeof schema>, rows: Record<string, unknown>[]): Promise<Record<string, unknown>[]> {
	const sessionIds = Array.from(
		new Set(rows.map((row) => row.session_id).filter((sid): sid is string => typeof sid === "string" && sid.length > 0)),
	);
	if (sessionIds.length === 0) {
		return rows.map((row) => ({ ...row, session_total_count: 1 }));
	}

	let countMap = new Map<string, number>();
	try {
		const aggregated = await db
			.select({
				session_id: liteLLM_SpendLogs.session_id,
				total: sql<number>`COUNT(*)`,
			})
			.from(liteLLM_SpendLogs)
			.where(inArray(liteLLM_SpendLogs.session_id, sessionIds))
			.groupBy(liteLLM_SpendLogs.session_id);
		countMap = new Map(
			aggregated
				.filter((row) => typeof row.session_id === "string" && row.session_id.length > 0)
				.map((row) => [row.session_id as string, toFiniteNumber(row.total)]),
		);
	} catch (err) {
		// 与 Python 不同：TS 不抛 500，session_total_count 退化默认 1，避免明细行被吞掉
		logger.warn(`/spend/logs/ui session count enrichment failed: ${(err as Error).message}`);
	}

	return rows.map((row) => {
		const sid = row.session_id;
		const total = typeof sid === "string" && sid.length > 0 ? (countMap.get(sid) ?? 1) : 1;
		return { ...row, session_total_count: total };
	});
}
