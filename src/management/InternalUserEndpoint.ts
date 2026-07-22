/**
 * 内部用户管理端点 — CRUD 操作
 *
 * 工厂函数：createInternalUserRoutes(router, db, authMiddleware)
 * 注册所有 /user/* 路由，针对 LiteLLM_UserTable。
 */

import { randomUUID } from "crypto";
import type { Router, Request, RequestHandler } from "express";
import { eq, and, inArray, isNull, ne, or } from "drizzle-orm";
import type { DrizzleDb } from "../core/db/Database";
import { registerRoute } from "../core/api/registerRoute";
import { ApiError } from "../core/api/ApiError";
import { LiteLLM_UserTable } from "../db/schema/users";
import { LiteLLM_VerificationToken } from "../db/schema/verification-tokens";
import { LiteLLM_ObjectPermissionTable } from "../db/schema/object-permissions";
import { LiteLLM_OrganizationMembership } from "../db/schema/organization-memberships";
import { LiteLLM_TeamTable } from "../db/schema/teams";
import { LiteLLM_TeamMembership } from "../db/schema/team-memberships";
import { createModuleLogger } from "../core/utils/logger";
import { firstQueryString, parsePositiveInt } from "../core/api/queryParams";
import { generateApiKey, hashApiKey } from "../core/utils/crypto";
import { resolveExpiresFromDuration } from "./KeyManagementEndpoint";
import {
	buildGenerateKeyResponse,
	toPythonInternalUserRow,
	toPythonKeyManagementRow,
	toPythonObjectPermission,
	toPythonOrganizationMembership,
	toPythonTeamRow,
} from "./pythonRowSerializers";
import { WEBUI_LOGIN_TEAM_ID } from "../types/webUiSession";

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

/** Python /user/info keys 中 key 无 team_id 时 team_alias 的序列化值（str(None)）。 */
const PYTHON_NO_TEAM_ALIAS = "None";

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
type VerificationTokenRow = typeof LiteLLM_VerificationToken.$inferSelect;
type ObjectPermissionRow = typeof LiteLLM_ObjectPermissionTable.$inferSelect;
type OrganizationMembershipRow = typeof LiteLLM_OrganizationMembership.$inferSelect;

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
 * 严格对齐 Python `/user/list` 实测 21 键（LiteLLM_UserTable 序列化字段 + key_count），
 * 不得附带 Python 没有的 team_id/organization_id/policies/allowed_cache_controls/max_parallel_requests。
 * @see https://github.com/BerriAI/litellm/blob/main/ui/litellm-dashboard/src/components/networking.tsx UserInfo / UserListResponse
 */
interface WebUiUserInfo {
	readonly user_id: string;
	readonly user_alias: string | null;
	readonly user_email: string | null;
	readonly user_role: string | null;
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
	/** Python /user/list 实测字段：该用户名下 key 数量（排除 WebUI 登录会话 team） */
	readonly key_count: number;
	readonly model_spend: unknown;
	readonly model_max_budget: unknown;
	/** Python /user/list 实测字段：关联对象权限（snake_case），无关联为 null */
	readonly object_permission: Record<string, unknown> | null;
	/** Python /user/list 实测字段：组织成员关系列表，无成员关系为 null */
	readonly organization_memberships: readonly Record<string, unknown>[] | null;
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
 * 统计用户名下 key 数量（对齐 Python get_user_key_counts：
 * 排除 team_id = WebUI 登录会话 team 的临时 key）。
 * @param tokens
 * @param userId
 */
function countUserKeys(tokens: readonly VerificationTokenRow[], userId: string): number {
	return tokens.filter((token) => token.userId === userId && (token.teamId === null || token.teamId !== WEBUI_LOGIN_TEAM_ID)).length;
}

/** /user/list 关联数据（一次性取全表，内存中 join，与该端点既有的内存过滤/分页策略一致）。 */
interface UserListJoinData {
	readonly tokens: readonly VerificationTokenRow[];
	readonly objectPermissions: ReadonlyMap<string, ObjectPermissionRow>;
	readonly membershipsByUserId: ReadonlyMap<string, readonly OrganizationMembershipRow[]>;
}

/**
 * 将 Drizzle camelCase 用户行映射为 WebUI 需要的 snake_case 协议对象，并集中处理 nullable DB 字段的空态兜底。
 * @param row
 * @param joinData - key/object_permission/organization_membership 关联数据
 */
function normalizeUserRow(row: UserRow, joinData: UserListJoinData): WebUiUserInfo {
	const objectPermission = row.objectPermissionId !== null ? (joinData.objectPermissions.get(row.objectPermissionId) ?? null) : null;
	const memberships = joinData.membershipsByUserId.get(row.userId) ?? null;
	return {
		user_id: row.userId,
		user_alias: row.userAlias,
		user_email: row.userEmail,
		user_role: row.userRole,
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
		key_count: countUserKeys(joinData.tokens, row.userId),
		model_spend: row.modelSpend ?? EMPTY_METADATA,
		model_max_budget: row.modelMaxBudget ?? EMPTY_METADATA,
		object_permission: objectPermission !== null ? toPythonObjectPermission(objectPermission) : null,
		organization_memberships: memberships !== null && memberships.length > 0 ? memberships.map(toPythonOrganizationMembership) : null,
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
 * @param joinData
 */
function buildUserListResponse(req: Request, rows: UserRow[], joinData: UserListJoinData): WebUiUserListResponse {
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
	const users = filteredRows.slice(startIndex, startIndex + query.pageSize).map((row) => normalizeUserRow(row, joinData));
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
	// 响应对齐 Python new_user 实测：NewUserResponse = GenerateKeyResponse（48 键，token_id/token/
	// created_by/updated_by 为 null）+ user_email/user_role/teams/user_alias。
	// Python 会同步为新用户生成一个 API key（auto_create_key 缺省 true）。
	// 协议源码：litellm/proxy/management_endpoints/internal_user_endpoints.py new_user
	registerRoute(
		router,
		{ method: "post", path: "/user/new" },
		authed(async (req) => {
			const body = (req.body ?? {}) as Record<string, unknown>;
			const {
				user_id: rawUserId,
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
				teams,
				sso_user_id,
				max_parallel_requests,
			} = body;

			// Python: user_id 缺省时自动生成 uuid（internal_user_endpoints.py _update_internal_new_user_params）
			const user_id = typeof rawUserId === "string" && rawUserId.length > 0 ? rawUserId : randomUUID();

			// 检查重复
			const existing = await db.select().from(LiteLLM_UserTable).where(eq(LiteLLM_UserTable.userId, user_id)).limit(1);
			if (existing.length > 0) {
				throw ApiError.conflict(`User already exists: ${user_id}`);
			}

			await db.insert(LiteLLM_UserTable).values({
				userId: user_id,
				userAlias: (user_alias as string | undefined) ?? null,
				teamId: (team_id as string | undefined) ?? null,
				organizationId: (organization_id as string | undefined) ?? null,
				userRole: (user_role as string | undefined) ?? null,
				userEmail: (user_email as string | undefined) ?? null,
				maxBudget: (max_budget as number | undefined) ?? null,
				models: (models as string[] | undefined) ?? [],
				metadata: (metadata as Record<string, unknown> | undefined) ?? {},
				tpmLimit: (tpm_limit as number | undefined) ?? null,
				rpmLimit: (rpm_limit as number | undefined) ?? null,
				budgetDuration: (budget_duration as string | undefined) ?? null,
				teams: (teams as string[] | undefined) ?? [],
				ssoUserId: (sso_user_id as string | undefined) ?? null,
				maxParallelRequests: (max_parallel_requests as number | undefined) ?? null,
			});

			const now = new Date();
			const autoCreateKey = body["auto_create_key"] !== false;
			let plainKey = "";
			let tokenHash: string | null = null;
			let keyName: string | null = null;
			let expires: Date | null = null;

			if (autoCreateKey) {
				// Python: duration 优先于 expires，expires = now + duration
				expires =
					typeof body["duration"] === "string" && body["duration"].length > 0
						? resolveExpiresFromDuration(body["duration"], now)
						: body["expires"]
							? new Date(body["expires"] as string)
							: null;

				plainKey = generateApiKey();
				tokenHash = hashApiKey(plainKey);
				// Python: key_name 缺省时自动置为 "sk-..." + 明文后 4 位
				keyName =
					typeof body["key_name"] === "string" && body["key_name"].length > 0 ? body["key_name"] : `sk-...${plainKey.slice(-4)}`;

				await db.insert(LiteLLM_VerificationToken).values({
					token: tokenHash,
					keyAlias: (body["key_alias"] as string | undefined) ?? null,
					keyName: keyName,
					userId: user_id,
					metadata: {},
					models: (models as string[] | undefined) ?? [],
					maxBudget: (max_budget as number | undefined) ?? null,
					tpmLimit: (tpm_limit as number | undefined) ?? null,
					rpmLimit: (rpm_limit as number | undefined) ?? null,
					budgetDuration: (budget_duration as string | undefined) ?? null,
					expires: expires,
					blocked: false,
					createdBy: null,
					updatedBy: null,
					createdAt: now,
					updatedAt: now,
				});
			}

			logger.info(`User created: ${user_id}`);

			const keyResponse = buildGenerateKeyResponse({
				body: { ...body, user_id: user_id },
				plainKey: plainKey,
				tokenHash: tokenHash ?? "",
				keyName: keyName ?? "",
				expires: expires,
				createdBy: null,
				now: now,
				budgetRow: null,
			});

			// Python new_user 实测：token_id/token/created_by/updated_by 均为 null，
			// 并附带用户字段 user_email/user_role/teams/user_alias
			return {
				...keyResponse,
				token_id: null,
				token: null,
				created_by: null,
				updated_by: null,
				user_email: (user_email as string | undefined) ?? null,
				user_role: (user_role as string | undefined) ?? null,
				teams: (teams as string[] | undefined) ?? null,
				user_alias: (user_alias as string | undefined) ?? null,
			};
		}),
	);

	// ─── POST /user/update ─────────────────────────────────────
	// 响应对齐 Python user_update 实测：{ user_id, data: 更新后完整用户对象（31 键） }。
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

			// 重查更新后完整行，序列化为 Python 31 键用户对象
			const updatedRows = await db.select().from(LiteLLM_UserTable).where(eq(LiteLLM_UserTable.userId, user_id)).limit(1);
			return {
				user_id: user_id,
				// Python /user/update 实测：organization_memberships 为 null（不带关联）
				data: toPythonInternalUserRow(updatedRows[0]!, { organizationMemberships: null }),
			};
		}),
	);

	// ─── POST /user/delete ─────────────────────────────────────
	// 对齐 Python delete_user：请求 { user_ids: [...] }，校验全部存在后删除用户及其
	// keys/组织成员关系/团队成员关系，响应为删除的用户数（裸整数）。
	// 协议源码：litellm/proxy/management_endpoints/internal_user_endpoints.py delete_user
	registerRoute(
		router,
		{ method: "post", path: "/user/delete" },
		authed(async (req) => {
			const body = (req.body ?? {}) as { user_ids?: unknown };
			const userIds = Array.isArray(body.user_ids)
				? body.user_ids.filter((id): id is string => typeof id === "string" && id.length > 0)
				: [];

			if (userIds.length === 0) {
				throw ApiError.badRequest("No user id passed in");
			}

			// Python: 逐个校验存在性，任一不存在即 404
			for (const userId of userIds) {
				const rows = await db.select().from(LiteLLM_UserTable).where(eq(LiteLLM_UserTable.userId, userId)).limit(1);
				if (rows.length === 0) {
					throw ApiError.notFound(`User not found, passed user_id=${userId}`);
				}
			}

			// Python: 级联删除用户名下 keys、组织成员关系、团队成员关系
			await db.delete(LiteLLM_VerificationToken).where(inArray(LiteLLM_VerificationToken.userId, userIds));
			await db.delete(LiteLLM_OrganizationMembership).where(inArray(LiteLLM_OrganizationMembership.userId, userIds));
			await db.delete(LiteLLM_TeamMembership).where(inArray(LiteLLM_TeamMembership.userId, userIds));
			const result = await db.delete(LiteLLM_UserTable).where(inArray(LiteLLM_UserTable.userId, userIds));

			logger.info(`Users deleted: count=${result.rowCount ?? userIds.length}`);

			return result.rowCount ?? userIds.length;
		}),
	);

	// ─── GET /user/info ────────────────────────────────────────
	// 响应对齐 Python user_info 实测：{ user_id, user_info(31 键), keys(48 键+team_alias), teams }。
	// keys 排除 WebUI 登录会话 team（litellm-dashboard）的临时 key；
	// team_alias：key 无 team_id 时为字符串 "None"，team 不存在为 null，存在为团队别名。
	// 协议源码：litellm/proxy/management_endpoints/internal_user_endpoints.py user_info
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
				throw ApiError.notFound(`User ${userId} not found`);
			}
			const userRow = rows[0]!;

			// 组织成员关系（/user/info 实测为空数组 []，而非 null）
			const membershipRows = await db
				.select()
				.from(LiteLLM_OrganizationMembership)
				.where(eq(LiteLLM_OrganizationMembership.userId, userId));
			const organizationMemberships = membershipRows.map(toPythonOrganizationMembership);

			// 对象权限关联
			let objectPermissionRow = null;
			if (userRow.objectPermissionId !== null) {
				const permissionRows = await db
					.select()
					.from(LiteLLM_ObjectPermissionTable)
					.where(eq(LiteLLM_ObjectPermissionTable.objectPermissionId, userRow.objectPermissionId))
					.limit(1);
				objectPermissionRow = permissionRows[0] ?? null;
			}

			// 团队列表：用户 teams 字段 + 团队成员关系指向的 team，按 team_alias 排序
			const teamMembershipRows = await db.select().from(LiteLLM_TeamMembership).where(eq(LiteLLM_TeamMembership.userId, userId));
			const teamIds = Array.from(new Set([...(userRow.teams ?? []), ...teamMembershipRows.map((membership) => membership.teamId)]));
			const teamRows =
				teamIds.length > 0 ? await db.select().from(LiteLLM_TeamTable).where(inArray(LiteLLM_TeamTable.teamId, teamIds)) : [];
			const teamsById = new Map(teamRows.map((team) => [team.teamId, team]));
			const sortedTeamRows = [...teamRows].sort((left, right) => (left.teamAlias ?? "").localeCompare(right.teamAlias ?? ""));

			// 用户名下 keys（排除 WebUI 登录会话 team）
			const tokenRows = await db
				.select()
				.from(LiteLLM_VerificationToken)
				.where(
					and(
						eq(LiteLLM_VerificationToken.userId, userId),
						or(isNull(LiteLLM_VerificationToken.teamId), ne(LiteLLM_VerificationToken.teamId, WEBUI_LOGIN_TEAM_ID)),
					),
				);
			const keys = tokenRows.map((tokenRow) => {
				const teamAlias = tokenRow.teamId === null ? PYTHON_NO_TEAM_ALIAS : (teamsById.get(tokenRow.teamId)?.teamAlias ?? null);
				return toPythonKeyManagementRow(tokenRow, { includeToken: true, teamAlias: teamAlias });
			});

			return {
				user_id: userId,
				user_info: toPythonInternalUserRow(userRow, {
					organizationMemberships: organizationMemberships,
					objectPermissionRow: objectPermissionRow,
				}),
				keys: keys,
				teams: sortedTeamRows.map(toPythonTeamRow),
			};
		}),
	);

	// ─── GET /user/list ────────────────────────────────────────
	registerRoute(
		router,
		{ method: "get", path: "/user/list" },
		authed(async (req) => {
			// 关联数据一次性取全表，内存 join（与该端点既有的内存过滤/分页策略一致）
			const [rows, tokens, objectPermissions, memberships] = await Promise.all([
				db.select().from(LiteLLM_UserTable),
				db.select().from(LiteLLM_VerificationToken),
				db.select().from(LiteLLM_ObjectPermissionTable),
				db.select().from(LiteLLM_OrganizationMembership),
			]);
			const membershipsByUserId = new Map<string, OrganizationMembershipRow[]>();
			for (const membership of memberships) {
				const list = membershipsByUserId.get(membership.userId) ?? [];
				list.push(membership);
				membershipsByUserId.set(membership.userId, list);
			}
			const joinData: UserListJoinData = {
				tokens: tokens,
				objectPermissions: new Map(objectPermissions.map((row) => [row.objectPermissionId, row])),
				membershipsByUserId: membershipsByUserId,
			};
			return buildUserListResponse(req, rows, joinData);
		}),
	);
}
