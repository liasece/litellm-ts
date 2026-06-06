/**
 * 内部用户管理端点 — CRUD 操作
 *
 * 工厂函数：createInternalUserRoutes(router, db, authMiddleware)
 * 注册所有 /user/* 路由，针对 LiteLLM_UserTable。
 */

import type { Router, Request, RequestHandler } from "express";
import { eq } from "drizzle-orm";
import type { DrizzleDb } from "../core/db/Database";
import { registerRoute } from "../core/api/registerRoute";
import { ApiError } from "../core/api/ApiError";
import { LiteLLM_UserTable } from "../db/schema/users";
import { createModuleLogger } from "../core/utils/logger";
import { firstQueryString, parsePositiveInt } from "../core/api/queryParams";

const logger = createModuleLogger("Management:User");
const EMPTY_STRING_ARRAY: readonly string[] = [];
const EMPTY_METADATA: Readonly<Record<string, never>> = {};
const USER_LIST_PAGINATION = {
	defaultPage: 1,
	defaultPageSize: 50,
	minPageSize: 1,
	maxPageSize: 1000,
	minTotalPages: 1,
} as const;

/** 用户列表支持的排序方向（对齐 WebUI `/user/list?sort_order=` 协议）。 */
enum UserSortOrder {
	ASC = "asc",
	DESC = "desc",
}

/** 用户列表支持的排序字段（对齐 WebUI `/user/list?sort_by=` 协议）。 */
enum UserSortField {
	USER_ID = "user_id",
	USER_EMAIL = "user_email",
	USER_ROLE = "user_role",
	TEAM_ID = "team_id",
	ORGANIZATION_ID = "organization_id",
	SPEND = "spend",
	CREATED_AT = "created_at",
	UPDATED_AT = "updated_at",
}

type UserRow = typeof LiteLLM_UserTable.$inferSelect;

/** 用户排序值类型，用 enum 避免内部判别字段退化为裸字符串联合。 */
enum UserSortValueKind {
	NUMBER = "number",
	STRING = "string",
}

type UserSortValue =
	| { readonly kind: UserSortValueKind.NUMBER; readonly value: number }
	| { readonly kind: UserSortValueKind.STRING; readonly value: string };

/**
 * WebUI `/user/list` 需要的用户字段形状。
 * @see https://github.com/BerriAI/litellm/blob/main/ui/litellm-dashboard/src/components/networking.tsx UserInfo / UserListResponse
 */
interface WebUiUserInfo {
	readonly user_id: string;
	readonly user_alias: string | null;
	readonly user_email: string | null;
	readonly user_role: string | null;
	readonly team_id: string | null;
	readonly organization_id: string | null;
	readonly sso_user_id: string | null;
	readonly spend: number;
	readonly max_budget: number | null;
	readonly models: readonly string[];
	readonly metadata: unknown;
	readonly created_at: Date | null;
	readonly updated_at: Date | null;
	readonly teams: readonly string[];
	readonly budget_duration: string | null;
	readonly budget_reset_at: Date | null;
	readonly tpm_limit: number | null;
	readonly rpm_limit: number | null;
	readonly max_parallel_requests: number | null;
	readonly allowed_cache_controls: readonly string[];
	readonly policies: readonly string[];
}

interface WebUiUserListResponse {
	readonly users: WebUiUserInfo[];
	readonly total: number;
	readonly page: number;
	readonly page_size: number;
	readonly total_pages: number;
}

interface UserListQuery {
	readonly page: number;
	readonly pageSize: number;
	readonly userIds: readonly string[];
	readonly ssoUserIds: readonly string[];
	readonly organizationIds: readonly string[];
	readonly userEmail: string | null;
	readonly role: string | null;
	readonly team: string | null;
	readonly sortBy: UserSortField;
	readonly sortOrder: UserSortOrder;
}

function parseUserListPageSize(value: unknown): number {
	const parsed = parsePositiveInt(value, USER_LIST_PAGINATION.defaultPageSize);
	return Math.min(Math.max(parsed, USER_LIST_PAGINATION.minPageSize), USER_LIST_PAGINATION.maxPageSize);
}

function parseUserListQueryList(value: unknown): readonly string[] {
	if (value === undefined || value === null) {
		return EMPTY_STRING_ARRAY;
	}
	const values = Array.isArray(value) ? value : [value];
	return values
		.flatMap((item) => String(item).split(","))
		.map((item) => item.trim())
		.filter((item) => item.length > 0);
}

/**
 * 把字符串归一为合法 `UserSortField`。
 *
 * 故意用 `Record<UserSortField, true>` + type guard 而非 switch-case：编译器
 * 保证白名单覆盖每个枚举成员，新加成员若忘了登记会立即在 `USER_SORT_FIELD_FLAGS`
 * 的赋值检查上失败，避免静默回退到 `USER_ID` 导致 SQL ORDER BY 拿到的是合法
 * 但非预期的字段。
 */
const USER_SORT_FIELD_FLAGS: Record<UserSortField, true> = {
	[UserSortField.USER_ID]: true,
	[UserSortField.USER_EMAIL]: true,
	[UserSortField.USER_ROLE]: true,
	[UserSortField.TEAM_ID]: true,
	[UserSortField.ORGANIZATION_ID]: true,
	[UserSortField.SPEND]: true,
	[UserSortField.CREATED_AT]: true,
	[UserSortField.UPDATED_AT]: true,
};

function isUserSortField(raw: string): raw is UserSortField {
	return Object.prototype.hasOwnProperty.call(USER_SORT_FIELD_FLAGS, raw);
}

function parseUserSortField(value: unknown): UserSortField {
	const sortBy = firstQueryString(value);
	if (sortBy !== null && isUserSortField(sortBy)) {
		return sortBy;
	}
	return UserSortField.USER_ID;
}

function parseUserSortOrder(value: unknown): UserSortOrder {
	return firstQueryString(value) === UserSortOrder.DESC ? UserSortOrder.DESC : UserSortOrder.ASC;
}

/**
 * 将 Express query 参数解析为用户列表查询对象，并在入口处完成默认值、枚举回退与分页上限钳制。
 * @param req
 */
function parseUserListQuery(req: Request): UserListQuery {
	return {
		page: parsePositiveInt(req.query.page, USER_LIST_PAGINATION.defaultPage),
		pageSize: parseUserListPageSize(req.query.page_size),
		userIds: parseUserListQueryList(req.query.user_ids),
		ssoUserIds: parseUserListQueryList(req.query.sso_user_ids),
		organizationIds: parseUserListQueryList(req.query.organization_ids),
		userEmail: firstQueryString(req.query.user_email),
		role: firstQueryString(req.query.role),
		team: firstQueryString(req.query.team),
		sortBy: parseUserSortField(req.query.sort_by),
		sortOrder: parseUserSortOrder(req.query.sort_order),
	};
}

function includesCaseInsensitive(value: string | null, needle: string): boolean {
	return value?.toLowerCase().includes(needle.toLowerCase()) ?? false;
}

/**
 * 将 Drizzle camelCase 用户行映射为 WebUI 需要的 snake_case 协议对象，并集中处理 nullable DB 字段的空态兜底。
 * @param row
 */
function normalizeUserRow(row: UserRow): WebUiUserInfo {
	return {
		user_id: row.userId,
		user_alias: row.userAlias,
		user_email: row.userEmail,
		user_role: row.userRole,
		team_id: row.teamId,
		organization_id: row.organizationId,
		sso_user_id: row.ssoUserId,
		spend: row.spend ?? 0,
		max_budget: row.maxBudget,
		models: row.models ?? EMPTY_STRING_ARRAY,
		metadata: row.metadata ?? EMPTY_METADATA,
		created_at: row.createdAt,
		updated_at: row.updatedAt,
		teams: row.teams ?? EMPTY_STRING_ARRAY,
		budget_duration: row.budgetDuration,
		budget_reset_at: row.budgetResetAt,
		tpm_limit: row.tpmLimit,
		rpm_limit: row.rpmLimit,
		max_parallel_requests: row.maxParallelRequests,
		allowed_cache_controls: row.allowedCacheControls ?? EMPTY_STRING_ARRAY,
		policies: row.policies ?? EMPTY_STRING_ARRAY,
	};
}

function makeUserSortValue(row: UserRow, sortBy: UserSortField): UserSortValue {
	switch (sortBy) {
		case UserSortField.USER_EMAIL:
			return { kind: UserSortValueKind.STRING, value: row.userEmail ?? "" };
		case UserSortField.USER_ROLE:
			return { kind: UserSortValueKind.STRING, value: row.userRole ?? "" };
		case UserSortField.TEAM_ID:
			return { kind: UserSortValueKind.STRING, value: row.teamId ?? "" };
		case UserSortField.ORGANIZATION_ID:
			return { kind: UserSortValueKind.STRING, value: row.organizationId ?? "" };
		case UserSortField.SPEND:
			return { kind: UserSortValueKind.NUMBER, value: row.spend ?? 0 };
		case UserSortField.CREATED_AT:
			return { kind: UserSortValueKind.NUMBER, value: row.createdAt?.getTime() ?? 0 };
		case UserSortField.UPDATED_AT:
			return { kind: UserSortValueKind.NUMBER, value: row.updatedAt?.getTime() ?? 0 };
		case UserSortField.USER_ID:
			return { kind: UserSortValueKind.STRING, value: row.userId };
		default: {
			const exhaustive: never = sortBy;
			return exhaustive;
		}
	}
}

function compareUserSortValue(left: UserSortValue, right: UserSortValue): number {
	if (left.kind === UserSortValueKind.NUMBER && right.kind === UserSortValueKind.NUMBER) {
		return left.value - right.value;
	}
	return String(left.value).localeCompare(String(right.value));
}

/**
 * 判断单行用户是否命中 `/user/list` 查询条件；team 同时匹配主 teamId 与多团队 teams[]。
 * @param row
 * @param query
 */
function matchesUserListQuery(row: UserRow, query: UserListQuery): boolean {
	return (
		(query.userIds.length === 0 || query.userIds.includes(row.userId)) &&
		(query.ssoUserIds.length === 0 || (row.ssoUserId !== null && query.ssoUserIds.includes(row.ssoUserId))) &&
		(query.organizationIds.length === 0 || (row.organizationId !== null && query.organizationIds.includes(row.organizationId))) &&
		(query.userEmail === null || includesCaseInsensitive(row.userEmail, query.userEmail)) &&
		(query.role === null || row.userRole === query.role) &&
		(query.team === null || row.teamId === query.team || row.teams?.includes(query.team) === true)
	);
}

/**
 * 构造 WebUI `/user/list` 响应。
 * 当前先在内存中对 Drizzle 行做过滤、排序、分页，保持最小侵入式兼容；查询语义为：
 * - `user_ids`、`sso_user_ids`、`organization_ids` 支持逗号分隔和重复 query key。
 * - `user_email` 使用大小写不敏感子串匹配，对齐 WebUI 搜索框体验。
 * - `role` 精确匹配；`team` 同时匹配主 `team_id` 与 `teams[]`。
 * - 未知 `sort_by` 回退 `user_id`；仅 `sort_order=desc` 触发倒序。
 * - 空数据集仍返回 `total_pages=1`，避免前端分页 hook 在 0 页状态下进入异常分支。
 * @param req - Express 请求对象，提供 WebUI 传入的分页、过滤与排序 query。
 * @param rows - 从 LiteLLM_UserTable 读取的用户行。
 */
function buildUserListResponse(req: Request, rows: UserRow[]): WebUiUserListResponse {
	const query = parseUserListQuery(req);
	const filteredRows = rows
		.filter((row) => matchesUserListQuery(row, query))
		.sort((left, right) => {
			const leftValue = makeUserSortValue(left, query.sortBy);
			const rightValue = makeUserSortValue(right, query.sortBy);
			const direction = query.sortOrder === UserSortOrder.DESC ? -1 : 1;
			return compareUserSortValue(leftValue, rightValue) * direction;
		});
	const total = filteredRows.length;
	const totalPages = Math.max(USER_LIST_PAGINATION.minTotalPages, Math.ceil(total / query.pageSize));
	const startIndex = (query.page - 1) * query.pageSize;
	const users = filteredRows.slice(startIndex, startIndex + query.pageSize).map(normalizeUserRow);
	return {
		users: users,
		total: total,
		page: query.page,
		page_size: query.pageSize,
		total_pages: totalPages,
	};
}

/**
 * 创建内部用户管理路由
 * @param router - Express Router 实例
 * @param db - Drizzle 数据库实例
 * @param authMiddleware - 认证中间件（null 表示不要求认证）
 */
export function createInternalUserRoutes(router: Router, db: DrizzleDb, authMiddleware: RequestHandler | null): void {
	function authed(handler: (req: Request) => unknown | Promise<unknown>): (req: Request) => unknown | Promise<unknown> {
		return async (req: Request) => {
			if (authMiddleware) {
				await new Promise<void>((resolve, reject) => {
					authMiddleware(req, {} as never, (err?: unknown) => {
						if (err) {
							reject(err);
						} else {
							resolve();
						}
					});
				});
			}
			return handler(req);
		};
	}

	// ─── POST /user/new ────────────────────────────────────────
	registerRoute(
		router,
		{ method: "post", path: "/user/new" },
		authed(async (req) => {
			const {
				user_id,
				user_alias,
				team_id,
				organization_id,
				user_role,
				user_email,
				max_budget,
				models,
				metadata,
				tpm_limit,
				rpm_limit,
				budget_duration,
			} = req.body ?? {};

			if (!user_id) {
				throw ApiError.badRequest("user_id is required");
			}

			// 检查重复
			const existing = await db.select().from(LiteLLM_UserTable).where(eq(LiteLLM_UserTable.userId, user_id)).limit(1);
			if (existing.length > 0) {
				throw ApiError.conflict(`User already exists: ${user_id}`);
			}

			await db.insert(LiteLLM_UserTable).values({
				userId: user_id,
				userAlias: user_alias ?? null,
				teamId: team_id ?? null,
				organizationId: organization_id ?? null,
				userRole: user_role ?? null,
				userEmail: user_email ?? null,
				maxBudget: max_budget ?? null,
				models: models ?? [],
				metadata: metadata ?? {},
				tpmLimit: tpm_limit ?? null,
				rpmLimit: rpm_limit ?? null,
				budgetDuration: budget_duration ?? null,
			});

			logger.info(`User created: ${user_id}`);

			return { success: true, user_id: user_id };
		}),
	);

	// ─── POST /user/update ─────────────────────────────────────
	registerRoute(
		router,
		{ method: "post", path: "/user/update" },
		authed(async (req) => {
			const { user_id, ...updates } = req.body ?? {};

			if (!user_id) {
				throw ApiError.badRequest("user_id is required");
			}

			const existing = await db.select().from(LiteLLM_UserTable).where(eq(LiteLLM_UserTable.userId, user_id)).limit(1);
			if (existing.length === 0) {
				throw ApiError.notFound(`User not found: ${user_id}`);
			}

			const updateFields: Record<string, unknown> = {};
			if (updates.user_alias !== undefined) {
				updateFields.userAlias = updates.user_alias;
			}
			if (updates.team_id !== undefined) {
				updateFields.teamId = updates.team_id;
			}
			if (updates.organization_id !== undefined) {
				updateFields.organizationId = updates.organization_id;
			}
			if (updates.user_role !== undefined) {
				updateFields.userRole = updates.user_role;
			}
			if (updates.user_email !== undefined) {
				updateFields.userEmail = updates.user_email;
			}
			if (updates.max_budget !== undefined) {
				updateFields.maxBudget = updates.max_budget;
			}
			if (updates.models !== undefined) {
				updateFields.models = updates.models;
			}
			if (updates.metadata !== undefined) {
				updateFields.metadata = updates.metadata;
			}
			if (updates.tpm_limit !== undefined) {
				updateFields.tpmLimit = updates.tpm_limit;
			}
			if (updates.rpm_limit !== undefined) {
				updateFields.rpmLimit = updates.rpm_limit;
			}
			if (updates.budget_duration !== undefined) {
				updateFields.budgetDuration = updates.budget_duration;
			}

			await db
				.update(LiteLLM_UserTable)
				.set({ ...updateFields, updatedAt: new Date() })
				.where(eq(LiteLLM_UserTable.userId, user_id));

			logger.info(`User updated: ${user_id}`);

			return { success: true };
		}),
	);

	// ─── POST /user/delete ─────────────────────────────────────
	registerRoute(
		router,
		{ method: "post", path: "/user/delete" },
		authed(async (req) => {
			const { user_id } = req.body ?? {};

			if (!user_id) {
				throw ApiError.badRequest("user_id is required");
			}

			const result = await db.delete(LiteLLM_UserTable).where(eq(LiteLLM_UserTable.userId, user_id));

			if (result.rowCount === 0) {
				throw ApiError.notFound(`User not found: ${user_id}`);
			}

			logger.info(`User deleted: ${user_id}`);

			return { success: true };
		}),
	);

	// ─── GET /user/info ────────────────────────────────────────
	registerRoute(
		router,
		{ method: "get", path: "/user/info" },
		authed(async (req) => {
			const userId = (req.query.user_id as string) ?? req.body?.user_id;

			if (!userId) {
				throw ApiError.badRequest("user_id is required");
			}

			const rows = await db.select().from(LiteLLM_UserTable).where(eq(LiteLLM_UserTable.userId, userId)).limit(1);
			if (rows.length === 0) {
				throw ApiError.notFound(`User not found: ${userId}`);
			}

			return { success: true, data: rows[0] };
		}),
	);

	// ─── GET /user/list ────────────────────────────────────────
	registerRoute(
		router,
		{ method: "get", path: "/user/list" },
		authed(async (req) => {
			const rows = await db.select().from(LiteLLM_UserTable);
			return buildUserListResponse(req, rows);
		}),
	);
}
