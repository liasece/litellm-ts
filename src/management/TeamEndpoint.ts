/**
 * 团队管理端点 — CRUD + 成员管理 + 模型管理
 *
 * 工厂函数：createTeamRoutes(router, db, authMiddleware)
 * 注册所有 /team/* 路由，针对 LiteLLM_TeamTable。
 */

import { randomUUID } from "crypto";
import type { Router, Request, RequestHandler } from "express";
import { eq, and, inArray } from "drizzle-orm";
import type { DrizzleDb } from "../core/db/Database";
import { registerRoute } from "../core/api/registerRoute";
import { ApiError } from "../core/api/ApiError";
import { LiteLLM_TeamTable } from "../db/schema/teams";
import { LiteLLM_TeamMembership } from "../db/schema/team-memberships";
import { LiteLLM_UserTable } from "../db/schema/users";
import { LiteLLM_VerificationToken } from "../db/schema/verification-tokens";
import { createModuleLogger } from "../core/utils/logger";
import { toPythonKeyManagementRow, toPythonTeamRow, toPythonTeamUpdateDataRow } from "./pythonRowSerializers";
import { PROXY_ADMIN_USER_ID } from "../types/webUiSession";

const logger = createModuleLogger("Management:Team");
const EMPTY_STRING_ARRAY: readonly string[] = [];
const EMPTY_METADATA: Readonly<Record<string, never>> = {};
const DEFAULT_TEAM_LIST_PAGE = 1;
const DEFAULT_TEAM_LIST_PAGE_SIZE = 10;
const MAX_TEAM_LIST_PAGE_SIZE = 100;
const MIN_TOTAL_PAGES = 1;

type TeamRow = typeof LiteLLM_TeamTable.$inferSelect;
type TeamMembershipRow = typeof LiteLLM_TeamMembership.$inferSelect;
type VerificationTokenRow = typeof LiteLLM_VerificationToken.$inferSelect;
type UserRow = typeof LiteLLM_UserTable.$inferSelect;

interface TeamListQuery {
	readonly userId: string | null;
	readonly organizationId: string | null;
	readonly teamId: string | null;
	readonly teamAlias: string | null;
	readonly page: number;
	readonly pageSize: number;
	readonly sortBy: TeamSortField | null;
	readonly sortOrder: TeamSortOrder;
}

/** 团队列表排序方向，对齐 Python `/v2/team/list` 查询参数。 */
enum TeamSortOrder {
	ASC = "asc",
	DESC = "desc",
}

/** 团队列表排序字段，对齐 Python WebUI 使用的列名。 */
enum TeamSortField {
	TEAM_ID = "team_id",
	TEAM_ALIAS = "team_alias",
	ORGANIZATION_ID = "organization_id",
	SPEND = "spend",
	CREATED_AT = "created_at",
	UPDATED_AT = "updated_at",
}

const TEAM_SORT_FIELD_FLAGS: Record<TeamSortField, true> = {
	[TeamSortField.TEAM_ID]: true,
	[TeamSortField.TEAM_ALIAS]: true,
	[TeamSortField.ORGANIZATION_ID]: true,
	[TeamSortField.SPEND]: true,
	[TeamSortField.CREATED_AT]: true,
	[TeamSortField.UPDATED_AT]: true,
};

interface WebUiTeamMembershipInfo {
	readonly user_id: string;
	readonly team_id: string;
	readonly spend: number;
	readonly budget_id: string | null;
}

interface WebUiTeamKeyInfo {
	readonly key_name: string | null;
	readonly key_alias: string | null;
	readonly spend: number;
	readonly user_id: string | null;
	readonly team_id: string | null;
	readonly organization_id: string | null;
	readonly models: readonly string[];
	readonly metadata: unknown;
	readonly blocked: boolean | null;
	readonly created_at: Date | null;
	readonly updated_at: Date | null;
	readonly expires: Date | null;
	readonly last_active: Date | null;
}

interface WebUiTeamInfo {
	readonly team_id: string;
	readonly team_alias: string | null;
	readonly organization_id: string | null;
	readonly object_permission_id: string | null;
	readonly admins: readonly string[];
	readonly members: readonly string[];
	readonly members_with_roles: unknown;
	readonly metadata: unknown;
	readonly max_budget: number | null;
	readonly soft_budget: number | null;
	readonly spend: number;
	readonly models: readonly string[];
	readonly max_parallel_requests: number | null;
	readonly tpm_limit: number | null;
	readonly rpm_limit: number | null;
	readonly budget_duration: string | null;
	readonly budget_reset_at: Date | null;
	readonly blocked: boolean;
	readonly created_at: Date | null;
	readonly updated_at: Date | null;
	readonly model_spend: unknown;
	readonly model_max_budget: unknown;
	readonly router_settings: unknown;
	readonly team_member_permissions: readonly string[];
	readonly access_group_ids: readonly string[];
	readonly policies: readonly string[];
	readonly model_id: number | null;
	readonly allow_team_guardrail_config: boolean;
	readonly team_memberships: WebUiTeamMembershipInfo[];
	readonly keys: WebUiTeamKeyInfo[];
}

interface WebUiTeamListResponse {
	readonly teams: WebUiTeamInfo[];
	readonly total: number;
	readonly page: number;
	readonly page_size: number;
	readonly total_pages: number;
}

function firstQueryString(value: unknown): string | null {
	if (Array.isArray(value)) {
		const firstValue = value[0];
		return firstValue === undefined ? null : String(firstValue);
	}
	return value === undefined || value === null ? null : String(value);
}

function parsePositiveInt(value: unknown, fallback: number): number {
	const rawValue = firstQueryString(value);
	if (rawValue === null) {
		return fallback;
	}
	const parsed = Number.parseInt(rawValue, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseTeamPageSize(value: unknown): number {
	return Math.min(parsePositiveInt(value, DEFAULT_TEAM_LIST_PAGE_SIZE), MAX_TEAM_LIST_PAGE_SIZE);
}

function isTeamSortField(raw: string): raw is TeamSortField {
	return Object.prototype.hasOwnProperty.call(TEAM_SORT_FIELD_FLAGS, raw);
}

function parseTeamSortField(value: unknown): TeamSortField | null {
	const rawValue = firstQueryString(value);
	return rawValue !== null && isTeamSortField(rawValue) ? rawValue : null;
}

function parseTeamListQuery(req: Request): TeamListQuery {
	return {
		userId: firstQueryString(req.query.user_id),
		organizationId: firstQueryString(req.query.organization_id),
		teamId: firstQueryString(req.query.team_id),
		teamAlias: firstQueryString(req.query.team_alias),
		page: parsePositiveInt(req.query.page, DEFAULT_TEAM_LIST_PAGE),
		pageSize: parseTeamPageSize(req.query.page_size),
		sortBy: parseTeamSortField(req.query.sort_by),
		sortOrder: firstQueryString(req.query.sort_order) === TeamSortOrder.DESC ? TeamSortOrder.DESC : TeamSortOrder.ASC,
	};
}

function normalizeTeamMembershipRow(row: TeamMembershipRow): WebUiTeamMembershipInfo {
	return {
		user_id: row.userId,
		team_id: row.teamId,
		spend: row.spend ?? 0,
		budget_id: row.budgetId,
	};
}

function normalizeTeamKeyRow(row: VerificationTokenRow): WebUiTeamKeyInfo {
	return {
		key_name: row.keyName,
		key_alias: row.keyAlias,
		spend: row.spend ?? 0,
		user_id: row.userId,
		team_id: row.teamId,
		organization_id: row.organizationId,
		models: row.models ?? EMPTY_STRING_ARRAY,
		metadata: row.metadata ?? EMPTY_METADATA,
		blocked: row.blocked,
		created_at: row.createdAt,
		updated_at: row.updatedAt,
		expires: row.expires,
		last_active: row.lastActive,
	};
}

function normalizeTeamRow(row: TeamRow, memberships: TeamMembershipRow[], keys: VerificationTokenRow[]): WebUiTeamInfo {
	return {
		team_id: row.teamId,
		team_alias: row.teamAlias,
		organization_id: row.organizationId,
		object_permission_id: row.objectPermissionId,
		admins: row.admins ?? EMPTY_STRING_ARRAY,
		members: row.members ?? EMPTY_STRING_ARRAY,
		members_with_roles: row.membersWithRoles ?? EMPTY_METADATA,
		metadata: row.metadata ?? EMPTY_METADATA,
		max_budget: row.maxBudget,
		soft_budget: row.softBudget,
		spend: row.spend ?? 0,
		models: row.models ?? EMPTY_STRING_ARRAY,
		max_parallel_requests: row.maxParallelRequests,
		tpm_limit: row.tpmLimit,
		rpm_limit: row.rpmLimit,
		budget_duration: row.budgetDuration,
		budget_reset_at: row.budgetResetAt,
		blocked: row.blocked ?? false,
		created_at: row.createdAt,
		updated_at: row.updatedAt,
		model_spend: row.modelSpend ?? EMPTY_METADATA,
		model_max_budget: row.modelMaxBudget ?? EMPTY_METADATA,
		router_settings: row.routerSettings ?? EMPTY_METADATA,
		team_member_permissions: row.teamMemberPermissions ?? EMPTY_STRING_ARRAY,
		access_group_ids: row.accessGroupIds ?? EMPTY_STRING_ARRAY,
		policies: row.policies ?? EMPTY_STRING_ARRAY,
		model_id: row.modelId,
		allow_team_guardrail_config: row.allowTeamGuardrailConfig ?? false,
		team_memberships: memberships.map(normalizeTeamMembershipRow),
		keys: keys.map(normalizeTeamKeyRow),
	};
}

function matchesTeamListQuery(team: TeamRow, membershipRows: TeamMembershipRow[], query: TeamListQuery): boolean {
	const matchesUser =
		query.userId === null ||
		membershipRows.some((membership) => membership.teamId === team.teamId && membership.userId === query.userId);
	const matchesOrganization = query.organizationId === null || team.organizationId === query.organizationId;
	const matchesTeamId = query.teamId === null || team.teamId === query.teamId;
	const matchesAlias = query.teamAlias === null || (team.teamAlias ?? "").toLowerCase().includes(query.teamAlias.toLowerCase());
	return matchesUser && matchesOrganization && matchesTeamId && matchesAlias;
}

function makeTeamSortValue(team: TeamRow, sortBy: TeamSortField | null): string | number {
	switch (sortBy) {
		case TeamSortField.TEAM_ALIAS:
			return team.teamAlias ?? "";
		case TeamSortField.ORGANIZATION_ID:
			return team.organizationId ?? "";
		case TeamSortField.SPEND:
			return team.spend ?? 0;
		case TeamSortField.CREATED_AT:
			return team.createdAt?.getTime() ?? 0;
		case TeamSortField.UPDATED_AT:
			return team.updatedAt?.getTime() ?? 0;
		case TeamSortField.TEAM_ID:
		case null:
			return team.teamId;
		default: {
			const exhaustive: never = sortBy;
			return exhaustive;
		}
	}
}

function sortTeamRows(rows: TeamRow[], query: TeamListQuery): TeamRow[] {
	const sortedRows = [...rows].sort((left, right) => {
		const leftValue = makeTeamSortValue(left, query.sortBy);
		const rightValue = makeTeamSortValue(right, query.sortBy);
		const comparison =
			typeof leftValue === "number" && typeof rightValue === "number"
				? leftValue - rightValue
				: String(leftValue).localeCompare(String(rightValue));
		const direction = query.sortOrder === TeamSortOrder.DESC ? -1 : 1;
		return comparison * direction;
	});
	return sortedRows;
}

async function loadTeamMemberships(db: DrizzleDb, teamId: string | null): Promise<TeamMembershipRow[]> {
	if (teamId === null) {
		return await db.select().from(LiteLLM_TeamMembership);
	}
	return await db.select().from(LiteLLM_TeamMembership).where(eq(LiteLLM_TeamMembership.teamId, teamId));
}

async function loadTeamKeys(db: DrizzleDb, teamId: string | null): Promise<VerificationTokenRow[]> {
	if (teamId === null) {
		return await db.select().from(LiteLLM_VerificationToken);
	}
	return await db.select().from(LiteLLM_VerificationToken).where(eq(LiteLLM_VerificationToken.teamId, teamId));
}

async function buildTeamInfo(
	db: DrizzleDb,
	team: TeamRow,
	allMemberships?: TeamMembershipRow[],
	allKeys?: VerificationTokenRow[],
): Promise<WebUiTeamInfo> {
	const memberships =
		allMemberships?.filter((membership) => membership.teamId === team.teamId) ?? (await loadTeamMemberships(db, team.teamId));
	const keys = allKeys?.filter((key) => key.teamId === team.teamId) ?? (await loadTeamKeys(db, team.teamId));
	return normalizeTeamRow(team, memberships, keys);
}

async function buildTeamListResponse(req: Request, db: DrizzleDb, rows: TeamRow[]): Promise<WebUiTeamListResponse> {
	const query = parseTeamListQuery(req);
	const memberships = await loadTeamMemberships(db, null);
	const keys = await loadTeamKeys(db, null);
	const filteredRows = sortTeamRows(
		rows.filter((team) => matchesTeamListQuery(team, memberships, query)),
		query,
	);
	const total = filteredRows.length;
	const totalPages = Math.max(MIN_TOTAL_PAGES, Math.ceil(total / query.pageSize));
	const startIndex = (query.page - 1) * query.pageSize;
	const pageRows = filteredRows.slice(startIndex, startIndex + query.pageSize);
	const teams = await Promise.all(pageRows.map((team) => buildTeamInfo(db, team, memberships, keys)));
	return {
		teams: teams,
		total: total,
		page: query.page,
		page_size: query.pageSize,
		total_pages: totalPages,
	};
}

function extractMembers(
	body: Record<string, unknown>,
): Array<{ readonly user_id?: string; readonly user_email?: string; readonly role?: string }> {
	const memberValue = body.member;
	if (Array.isArray(memberValue)) {
		return memberValue as Array<{ readonly user_id?: string; readonly user_email?: string; readonly role?: string }>;
	}
	if (memberValue !== undefined && memberValue !== null) {
		return [memberValue as { readonly user_id?: string; readonly user_email?: string; readonly role?: string }];
	}
	return [
		{
			user_id: body.user_id as string | undefined,
			user_email: body.user_email as string | undefined,
			role: body.user_role as string | undefined,
		},
	];
}

async function ensureUser(
	db: DrizzleDb,
	member: { readonly user_id?: string; readonly user_email?: string; readonly role?: string },
): Promise<UserRow> {
	const userId = member.user_id ?? member.user_email;
	if (!userId) {
		throw ApiError.badRequest("Either user_id or user_email needs to be passed in");
	}
	const existing = await db.select().from(LiteLLM_UserTable).where(eq(LiteLLM_UserTable.userId, userId)).limit(1);
	if (existing.length > 0) {
		return existing[0]!;
	}
	const inserted = await db
		.insert(LiteLLM_UserTable)
		.values({
			userId: userId,
			userEmail: member.user_email ?? null,
			userRole: member.role ?? null,
			models: [],
			metadata: {},
		})
		.returning();
	return inserted[0]! as UserRow;
}

/**
 * 创建团队管理路由
 * @param router - Express Router 实例
 * @param db - Drizzle 数据库实例
 * @param authMiddleware - 认证中间件（null 表示不要求认证）
 */
export function createTeamRoutes(router: Router, db: DrizzleDb, authMiddleware: RequestHandler | null): void {
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

	// ─── POST /team/new ────────────────────────────────────────
	// 响应对齐 Python new_team 实测：LiteLLM_TeamTable 完整 26 键对象（无 success 包装）。
	// Python 会把调用者（master key 时为 default_user_id）以 admin 角色加入 members_with_roles。
	// 协议源码：litellm/proxy/management_endpoints/team_endpoints.py new_team
	registerRoute(
		router,
		{ method: "post", path: "/team/new" },
		authed(async (req) => {
			const body = (req.body ?? {}) as Record<string, unknown>;
			const {
				team_id,
				team_alias,
				organization_id,
				admins,
				members,
				metadata,
				models,
				max_budget,
				soft_budget,
				tpm_limit,
				rpm_limit,
				budget_duration,
				blocked,
				max_parallel_requests,
				router_settings,
				access_group_ids,
				team_member_permissions,
			} = body;

			const teamId = typeof team_id === "string" && team_id.length > 0 ? team_id : randomUUID();
			const createdBy = req.auth?.user_id ?? PROXY_ADMIN_USER_ID;

			// Python: 创建者默认以 admin 角色写入 members_with_roles；请求自带成员追加在后
			const requestMembersWithRoles = Array.isArray(body["members_with_roles"])
				? (body["members_with_roles"] as Array<{ user_id?: string; user_email?: string; role?: string }>)
				: [];
			const creatorInRequest = requestMembersWithRoles.some((member) => member.user_id === createdBy);
			const membersWithRoles = [
				...(creatorInRequest ? [] : [{ user_id: createdBy, user_email: null, role: "admin" }]),
				...requestMembersWithRoles.map((member) => ({
					user_id: member.user_id ?? null,
					user_email: member.user_email ?? null,
					role: member.role ?? "user",
				})),
			];

			const inserted = await db
				.insert(LiteLLM_TeamTable)
				.values({
					teamId: teamId,
					teamAlias: (team_alias as string | undefined) ?? null,
					organizationId: (organization_id as string | undefined) ?? null,
					admins: (admins as string[] | undefined) ?? [],
					members: (members as string[] | undefined) ?? [],
					membersWithRoles: membersWithRoles,
					metadata: (metadata as Record<string, unknown> | undefined) ?? {},
					models: (models as string[] | undefined) ?? [],
					maxBudget: (max_budget as number | undefined) ?? null,
					softBudget: (soft_budget as number | undefined) ?? null,
					tpmLimit: (tpm_limit as number | undefined) ?? null,
					rpmLimit: (rpm_limit as number | undefined) ?? null,
					budgetDuration: (budget_duration as string | undefined) ?? null,
					blocked: (blocked as boolean | undefined) ?? false,
					maxParallelRequests: (max_parallel_requests as number | undefined) ?? null,
					routerSettings: (router_settings as Record<string, unknown> | undefined) ?? {},
					accessGroupIds: (access_group_ids as string[] | undefined) ?? [],
					teamMemberPermissions: (team_member_permissions as string[] | undefined) ?? [],
				})
				.returning();

			logger.info(`团队已创建: ${(team_alias as string | undefined) ?? teamId}`);

			return toPythonTeamRow(inserted[0]!);
		}),
	);

	// ─── POST /team/update ─────────────────────────────────────
	registerRoute(
		router,
		{ method: "post", path: "/team/update" },
		authed(async (req) => {
			const { team_id, ...updates } = req.body ?? {};

			if (!team_id) {
				throw ApiError.badRequest("必须提供 team_id");
			}

			const existing = await db.select().from(LiteLLM_TeamTable).where(eq(LiteLLM_TeamTable.teamId, team_id)).limit(1);
			if (existing.length === 0) {
				throw ApiError.notFound(`团队不存在: ${team_id}`);
			}

			const updateFields: Record<string, unknown> = {};
			if (updates.team_alias !== undefined) {
				updateFields.teamAlias = updates.team_alias;
			}
			if (updates.organization_id !== undefined) {
				updateFields.organizationId = updates.organization_id;
			}
			if (updates.admins !== undefined) {
				updateFields.admins = updates.admins;
			}
			if (updates.members !== undefined) {
				updateFields.members = updates.members;
			}
			if (updates.metadata !== undefined) {
				updateFields.metadata = updates.metadata;
			}
			if (updates.models !== undefined) {
				updateFields.models = updates.models;
			}
			if (updates.max_budget !== undefined) {
				updateFields.maxBudget = updates.max_budget;
			}
			if (updates.soft_budget !== undefined) {
				updateFields.softBudget = updates.soft_budget;
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
			if (updates.blocked !== undefined) {
				updateFields.blocked = updates.blocked;
			}

			const updated = await db
				.update(LiteLLM_TeamTable)
				.set({ ...updateFields, updatedAt: new Date() })
				.where(eq(LiteLLM_TeamTable.teamId, team_id))
				.returning();

			logger.info(`团队已更新: ${team_id}`);

			// 响应对齐 Python update_team 实测：{ team_id, data: 更新后完整 team 对象（32 键） }
			return { team_id: team_id, data: toPythonTeamUpdateDataRow(updated[0] as TeamRow) };
		}),
	);

	// ─── POST /team/delete ─────────────────────────────────────
	// 对齐 Python delete_team：请求 { team_ids: [...] }，校验全部存在后级联删除
	// 团队 keys / 成员关系 / 团队行，响应 { deleted_teams: [...] }。
	// 协议源码：litellm/proxy/management_endpoints/team_endpoints.py delete_team
	registerRoute(
		router,
		{ method: "post", path: "/team/delete" },
		authed(async (req) => {
			const body = (req.body ?? {}) as { team_ids?: unknown };
			const teamIds = Array.isArray(body.team_ids)
				? body.team_ids.filter((id): id is string => typeof id === "string" && id.length > 0)
				: [];

			if (teamIds.length === 0) {
				throw ApiError.badRequest("No team id passed in");
			}

			// Python: 逐个校验存在性，任一不存在即 404
			for (const teamId of teamIds) {
				const rows = await db.select().from(LiteLLM_TeamTable).where(eq(LiteLLM_TeamTable.teamId, teamId)).limit(1);
				if (rows.length === 0) {
					throw ApiError.notFound(`Team not found, passed team_id=${teamId}`);
				}
			}

			// Python: 级联删除团队名下 keys 与成员关系
			await db.delete(LiteLLM_VerificationToken).where(inArray(LiteLLM_VerificationToken.teamId, teamIds));
			await db.delete(LiteLLM_TeamMembership).where(inArray(LiteLLM_TeamMembership.teamId, teamIds));
			await db.delete(LiteLLM_TeamTable).where(inArray(LiteLLM_TeamTable.teamId, teamIds));

			logger.info(`团队已删除: count=${teamIds.length}`);

			return { deleted_teams: teamIds };
		}),
	);

	// ─── POST /team/block ──────────────────────────────────────
	registerRoute(
		router,
		{ method: "post", path: "/team/block" },
		authed(async (req) => {
			const { team_id } = req.body ?? {};

			if (!team_id) {
				throw ApiError.badRequest("必须提供 team_id");
			}

			const result = await db
				.update(LiteLLM_TeamTable)
				.set({ blocked: true, updatedAt: new Date() })
				.where(eq(LiteLLM_TeamTable.teamId, team_id));

			if (result.rowCount === 0) {
				throw ApiError.notFound(`团队不存在: ${team_id}`);
			}

			logger.info(`团队已阻止: ${team_id}`);

			return { success: true };
		}),
	);

	// ─── POST /team/unblock ────────────────────────────────────
	registerRoute(
		router,
		{ method: "post", path: "/team/unblock" },
		authed(async (req) => {
			const { team_id } = req.body ?? {};

			if (!team_id) {
				throw ApiError.badRequest("必须提供 team_id");
			}

			const result = await db
				.update(LiteLLM_TeamTable)
				.set({ blocked: false, updatedAt: new Date() })
				.where(eq(LiteLLM_TeamTable.teamId, team_id));

			if (result.rowCount === 0) {
				throw ApiError.notFound(`团队不存在: ${team_id}`);
			}

			logger.info(`团队已解封: ${team_id}`);

			return { success: true };
		}),
	);

	async function addTeamMember(req: Request): Promise<Record<string, unknown>> {
		const body = (req.body ?? {}) as Record<string, unknown>;
		const teamId = body.team_id as string | undefined;
		if (!teamId) {
			throw ApiError.badRequest("No team id passed in");
		}

		const team = await db.select().from(LiteLLM_TeamTable).where(eq(LiteLLM_TeamTable.teamId, teamId)).limit(1);
		if (team.length === 0) {
			throw ApiError.notFound(`Team not found for team_id=${teamId}`);
		}

		const updatedUsers: UserRow[] = [];
		const updatedTeamMemberships: TeamMembershipRow[] = [];
		for (const member of extractMembers(body)) {
			const user = await ensureUser(db, member);
			await db
				.insert(LiteLLM_TeamMembership)
				.values({ userId: user.userId, teamId: teamId, budgetId: (body.budget_id as string | undefined) ?? null })
				.onConflictDoNothing();
			updatedUsers.push(user);
			updatedTeamMemberships.push({
				userId: user.userId,
				teamId: teamId,
				spend: 0,
				budgetId: (body.budget_id as string | undefined) ?? null,
			});
		}

		logger.info(`成员已加入团队: count=${updatedUsers.length} -> ${teamId}`);

		return {
			...normalizeTeamRow(team[0]!, [], []),
			updated_users: updatedUsers,
			updated_team_memberships: updatedTeamMemberships.map(normalizeTeamMembershipRow),
		};
	}

	async function deleteTeamMember(req: Request): Promise<TeamMembershipRow | { readonly success: true }> {
		const { team_id, user_id } = req.body ?? {};

		if (!team_id || !user_id) {
			throw ApiError.badRequest("Either user_id or user_email needs to be passed in");
		}

		const existing = await db
			.select()
			.from(LiteLLM_TeamMembership)
			.where(and(eq(LiteLLM_TeamMembership.teamId, team_id), eq(LiteLLM_TeamMembership.userId, user_id)))
			.limit(1);
		const result = await db
			.delete(LiteLLM_TeamMembership)
			.where(and(eq(LiteLLM_TeamMembership.teamId, team_id), eq(LiteLLM_TeamMembership.userId, user_id)));

		if (result.rowCount === 0) {
			throw ApiError.notFound("团队成员关系不存在");
		}

		logger.info(`成员已从团队移除: ${user_id} -> ${team_id}`);

		return existing[0] ?? { success: true };
	}

	// ─── POST /team/member/add + Python /team/member_add ───────
	registerRoute(router, { method: "post", path: "/team/member/add" }, authed(addTeamMember));
	registerRoute(router, { method: "post", path: "/team/member_add" }, authed(addTeamMember));

	// ─── POST /team/member/delete + Python /team/member_delete ──
	registerRoute(router, { method: "post", path: "/team/member/delete" }, authed(deleteTeamMember));
	registerRoute(router, { method: "post", path: "/team/member_delete" }, authed(deleteTeamMember));

	// ─── GET /team/info ────────────────────────────────────────
	// 响应对齐 Python team_info 实测：
	// { team_id, team_info(26 键 + team_member_budget_table), keys(不含 token 的 47 键对象), team_memberships }
	registerRoute(
		router,
		{ method: "get", path: "/team/info" },
		authed(async (req) => {
			const teamId = (req.query.team_id as string) ?? req.body?.team_id;

			if (!teamId) {
				throw ApiError.badRequest("Malformed request. No team id passed in.");
			}

			const rows = await db.select().from(LiteLLM_TeamTable).where(eq(LiteLLM_TeamTable.teamId, teamId)).limit(1);
			if (rows.length === 0) {
				throw ApiError.notFound(`Team not found, passed team id: ${teamId}.`);
			}

			const keyRows = await db.select().from(LiteLLM_VerificationToken).where(eq(LiteLLM_VerificationToken.teamId, teamId));
			const membershipRows = await loadTeamMemberships(db, teamId);

			return {
				team_id: teamId,
				team_info: { ...toPythonTeamRow(rows[0]!), team_member_budget_table: null },
				// Python team_info 会 pop 掉 token 字段，避免 hash 外泄
				keys: keyRows.map((keyRow) => toPythonKeyManagementRow(keyRow, { includeToken: false })),
				team_memberships: membershipRows.map(normalizeTeamMembershipRow),
			};
		}),
	);

	// ─── GET /team/list ────────────────────────────────────────
	registerRoute(
		router,
		{ method: "get", path: "/team/list" },
		authed(async (req) => {
			const rows = await db.select().from(LiteLLM_TeamTable);
			const response = await buildTeamListResponse(req, db, rows);
			return response.teams;
		}),
	);

	// ─── GET /v2/team/list ─────────────────────────────────────
	registerRoute(
		router,
		{ method: "get", path: "/v2/team/list" },
		authed(async (req) => {
			const rows = await db.select().from(LiteLLM_TeamTable);
			return await buildTeamListResponse(req, db, rows);
		}),
	);

	// ─── POST /team/model/add ──────────────────────────────────
	registerRoute(
		router,
		{ method: "post", path: "/team/model/add" },
		authed(async (req) => {
			const { team_id, model, models } = req.body ?? {};
			const modelNames = Array.isArray(models) ? models : [model].filter((modelName) => modelName !== undefined);

			if (!team_id || modelNames.length === 0) {
				throw ApiError.badRequest("必须提供 team_id 和 model");
			}

			const team = await db.select().from(LiteLLM_TeamTable).where(eq(LiteLLM_TeamTable.teamId, team_id)).limit(1);
			if (team.length === 0) {
				throw ApiError.notFound(`团队不存在: ${team_id}`);
			}

			const currentModels = team[0]!.models ?? [];
			const mergedModels = Array.from(new Set([...currentModels, ...modelNames]));
			await db
				.update(LiteLLM_TeamTable)
				.set({ models: mergedModels, updatedAt: new Date() })
				.where(eq(LiteLLM_TeamTable.teamId, team_id));

			logger.info(`模型已添加到团队: count=${modelNames.length} -> ${team_id}`);

			return { success: true };
		}),
	);

	// ─── POST /team/model/delete ───────────────────────────────
	registerRoute(
		router,
		{ method: "post", path: "/team/model/delete" },
		authed(async (req) => {
			const { team_id, model, models } = req.body ?? {};
			const modelNames = Array.isArray(models) ? models : [model].filter((modelName) => modelName !== undefined);

			if (!team_id || modelNames.length === 0) {
				throw ApiError.badRequest("必须提供 team_id 和 model");
			}

			const team = await db.select().from(LiteLLM_TeamTable).where(eq(LiteLLM_TeamTable.teamId, team_id)).limit(1);
			if (team.length === 0) {
				throw ApiError.notFound(`团队不存在: ${team_id}`);
			}

			const modelNameSet = new Set(modelNames);
			const filtered = (team[0]!.models ?? []).filter((modelName: string) => !modelNameSet.has(modelName));

			await db
				.update(LiteLLM_TeamTable)
				.set({ models: filtered, updatedAt: new Date() })
				.where(eq(LiteLLM_TeamTable.teamId, team_id));

			logger.info(`模型已从团队移除: count=${modelNames.length} -> ${team_id}`);

			return { success: true };
		}),
	);
}
