/**
 * 组织管理端点 — CRUD + 成员管理
 *
 * 工厂函数：createOrganizationRoutes(router, db, authMiddleware)
 * 注册所有 /organization/* 路由，针对 LiteLLM_OrganizationTable。
 */

import { randomUUID } from "crypto";
import type { Router, Request, RequestHandler } from "express";
import { eq, and } from "drizzle-orm";
import type { DrizzleDb } from "../core/db/Database";
import { registerRoute } from "../core/api/registerRoute";
import { ApiError } from "../core/api/ApiError";
import { LiteLLM_OrganizationTable } from "../db/schema/organizations";
import { LiteLLM_OrganizationMembership } from "../db/schema/organization-memberships";
import { LiteLLM_BudgetTable } from "../db/schema/budgets";
import { LiteLLM_TeamTable } from "../db/schema/teams";
import { LiteLLM_UserTable } from "../db/schema/users";
import { createModuleLogger } from "../core/utils/logger";

const logger = createModuleLogger("Management:Organization");
const EMPTY_STRING_ARRAY: readonly string[] = [];
const EMPTY_METADATA: Readonly<Record<string, never>> = {};

type OrganizationRow = typeof LiteLLM_OrganizationTable.$inferSelect;
type OrganizationMembershipRow = typeof LiteLLM_OrganizationMembership.$inferSelect;
type TeamRow = typeof LiteLLM_TeamTable.$inferSelect;
type UserRow = typeof LiteLLM_UserTable.$inferSelect;

interface WebUiOrganizationMembershipInfo {
	readonly user_id: string;
	readonly organization_id: string;
	readonly user_role: string | null;
	readonly spend: number;
	readonly budget_id: string | null;
	readonly created_at: Date | null;
	readonly updated_at: Date | null;
}

interface WebUiOrganizationTeamInfo {
	readonly team_id: string;
	readonly team_alias: string | null;
	readonly organization_id: string | null;
	readonly spend: number;
	readonly models: readonly string[];
	readonly blocked: boolean;
	readonly created_at: Date | null;
	readonly updated_at: Date | null;
}

interface WebUiOrganizationInfo {
	readonly organization_id: string;
	readonly organization_alias: string;
	readonly budget_id: string;
	readonly metadata: unknown;
	readonly models: readonly string[];
	readonly spend: number;
	readonly model_spend: unknown;
	readonly object_permission_id: string | null;
	readonly created_at: Date | null;
	readonly created_by: string;
	readonly updated_at: Date | null;
	readonly updated_by: string;
	readonly max_budget: number | null;
	readonly soft_budget: number | null;
	readonly members: WebUiOrganizationMembershipInfo[];
	readonly teams: WebUiOrganizationTeamInfo[];
	readonly litellm_budget_table: null;
}

function firstQueryString(value: unknown): string | null {
	if (Array.isArray(value)) {
		const firstValue = value[0];
		return firstValue === undefined ? null : String(firstValue);
	}
	return value === undefined || value === null ? null : String(value);
}

function normalizeOrganizationMembership(row: OrganizationMembershipRow): WebUiOrganizationMembershipInfo {
	return {
		user_id: row.userId,
		organization_id: row.organizationId,
		user_role: row.userRole,
		spend: row.spend ?? 0,
		budget_id: row.budgetId,
		created_at: row.createdAt,
		updated_at: row.updatedAt,
	};
}

function normalizeOrganizationTeam(row: TeamRow): WebUiOrganizationTeamInfo {
	return {
		team_id: row.teamId,
		team_alias: row.teamAlias,
		organization_id: row.organizationId,
		spend: row.spend ?? 0,
		models: row.models ?? EMPTY_STRING_ARRAY,
		blocked: row.blocked ?? false,
		created_at: row.createdAt,
		updated_at: row.updatedAt,
	};
}

function normalizeOrganizationRow(row: OrganizationRow, memberships: OrganizationMembershipRow[], teams: TeamRow[]): WebUiOrganizationInfo {
	return {
		organization_id: row.organizationId,
		organization_alias: row.organizationAlias,
		budget_id: row.budgetId,
		metadata: row.metadata ?? EMPTY_METADATA,
		models: row.models ?? EMPTY_STRING_ARRAY,
		spend: row.spend ?? 0,
		model_spend: row.modelSpend ?? EMPTY_METADATA,
		object_permission_id: row.objectPermissionId,
		created_at: row.createdAt,
		created_by: row.createdBy,
		updated_at: row.updatedAt,
		updated_by: row.updatedBy,
		max_budget: null,
		soft_budget: null,
		members: memberships.map(normalizeOrganizationMembership),
		teams: teams.map(normalizeOrganizationTeam),
		litellm_budget_table: null,
	};
}

async function loadOrganizationMemberships(db: DrizzleDb, organizationId: string | null): Promise<OrganizationMembershipRow[]> {
	if (organizationId === null) {
		return await db.select().from(LiteLLM_OrganizationMembership);
	}
	return await db.select().from(LiteLLM_OrganizationMembership).where(eq(LiteLLM_OrganizationMembership.organizationId, organizationId));
}

async function loadOrganizationTeams(db: DrizzleDb, organizationId: string | null): Promise<TeamRow[]> {
	if (organizationId === null) {
		return await db.select().from(LiteLLM_TeamTable);
	}
	return await db.select().from(LiteLLM_TeamTable).where(eq(LiteLLM_TeamTable.organizationId, organizationId));
}

async function buildOrganizationInfo(db: DrizzleDb, organization: OrganizationRow): Promise<WebUiOrganizationInfo> {
	const organizationId = organization.organizationId;
	const memberships = await loadOrganizationMemberships(db, organizationId);
	const teams = await loadOrganizationTeams(db, organizationId);
	return normalizeOrganizationRow(organization, memberships, teams);
}

function matchesOrganizationQuery(row: OrganizationRow, orgId: string | null, orgAlias: string | null): boolean {
	const matchesId = orgId === null || row.organizationId === orgId;
	const matchesAlias = orgAlias === null || row.organizationAlias.toLowerCase().includes(orgAlias.toLowerCase());
	return matchesId && matchesAlias;
}

function extractMembers(
	body: Record<string, unknown>,
): Array<{ readonly user_id?: string; readonly user_email?: string; readonly role?: string; readonly user_role?: string }> {
	const memberValue = body.member;
	if (Array.isArray(memberValue)) {
		return memberValue as Array<{
			readonly user_id?: string;
			readonly user_email?: string;
			readonly role?: string;
			readonly user_role?: string;
		}>;
	}
	if (memberValue !== undefined && memberValue !== null) {
		return [
			memberValue as { readonly user_id?: string; readonly user_email?: string; readonly role?: string; readonly user_role?: string },
		];
	}
	return [
		{
			user_id: body.user_id as string | undefined,
			user_email: body.user_email as string | undefined,
			user_role: body.user_role as string | undefined,
		},
	];
}

async function ensureUser(
	db: DrizzleDb,
	member: { readonly user_id?: string; readonly user_email?: string; readonly role?: string; readonly user_role?: string },
): Promise<UserRow> {
	const userId = member.user_id ?? member.user_email;
	if (!userId) {
		throw ApiError.badRequest("Either user_id or user_email must be provided");
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
			userRole: member.role ?? member.user_role ?? null,
			models: [],
			metadata: {},
		})
		.returning();
	return inserted[0]! as UserRow;
}

/**
 * 创建组织管理路由
 * @param router - Express Router 实例
 * @param db - Drizzle 数据库实例
 * @param authMiddleware - 认证中间件（null 表示不要求认证）
 */
export function createOrganizationRoutes(router: Router, db: DrizzleDb, authMiddleware: RequestHandler | null): void {
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

	// ─── POST /organization/new ─────────────────────────────────
	registerRoute(
		router,
		{ method: "post", path: "/organization/new" },
		authed(async (req) => {
			const {
				organization_id,
				organization_alias,
				budget_id,
				metadata,
				models,
				created_by,
				updated_by,
				max_budget,
				soft_budget,
				tpm_limit,
				rpm_limit,
				max_parallel_requests,
				model_max_budget,
				budget_duration,
			} = req.body ?? {};

			if (!organization_alias) {
				throw ApiError.badRequest("必须提供 organization_alias");
			}

			let effectiveBudgetId = budget_id as string | undefined;
			if (effectiveBudgetId === undefined || effectiveBudgetId === null) {
				const budgetResult = await db
					.insert(LiteLLM_BudgetTable)
					.values({
						budget_id: randomUUID(),
						max_budget: max_budget ?? null,
						soft_budget: soft_budget ?? null,
						max_parallel_requests: max_parallel_requests ?? null,
						tpm_limit: tpm_limit ?? null,
						rpm_limit: rpm_limit ?? null,
						model_max_budget: model_max_budget ?? null,
						budget_duration: budget_duration ?? null,
						created_by: created_by ?? "admin",
						updated_by: updated_by ?? "admin",
					})
					.returning({ budget_id: LiteLLM_BudgetTable.budget_id });
				effectiveBudgetId = budgetResult[0]!.budget_id;
			}

			const result = await db
				.insert(LiteLLM_OrganizationTable)
				.values({
					organizationId: organization_id ?? randomUUID(),
					organizationAlias: organization_alias,
					budgetId: effectiveBudgetId,
					metadata: metadata ?? {},
					models: models ?? [],
					createdBy: created_by ?? "admin",
					updatedBy: updated_by ?? "admin",
				})
				.returning();

			const organization = result[0]! as OrganizationRow;
			logger.info(`组织已创建: ${organization_alias} (${organization.organizationId})`);

			return normalizeOrganizationRow(organization, [], []);
		}),
	);

	// ─── GET /organization/list ─────────────────────────────────
	registerRoute(
		router,
		{ method: "get", path: "/organization/list" },
		authed(async (req) => {
			const orgId = firstQueryString(req.query.org_id);
			const orgAlias = firstQueryString(req.query.org_alias);
			const rows = await db.select().from(LiteLLM_OrganizationTable);
			const memberships = await loadOrganizationMemberships(db, null);
			const teams = await loadOrganizationTeams(db, null);
			return rows
				.filter((row) => matchesOrganizationQuery(row, orgId, orgAlias))
				.map((row) =>
					normalizeOrganizationRow(
						row,
						memberships.filter((membership) => membership.organizationId === row.organizationId),
						teams.filter((team) => team.organizationId === row.organizationId),
					),
				);
		}),
	);

	// ─── GET /organization/info ─────────────────────────────────
	registerRoute(
		router,
		{ method: "get", path: "/organization/info" },
		authed(async (req) => {
			const orgId = (req.query.organization_id as string) ?? req.body?.organization_id;

			if (!orgId) {
				throw ApiError.badRequest("必须提供 organization_id");
			}

			const rows = await db
				.select()
				.from(LiteLLM_OrganizationTable)
				.where(eq(LiteLLM_OrganizationTable.organizationId, orgId))
				.limit(1);

			if (rows.length === 0) {
				throw ApiError.notFound("Organization not found");
			}

			return await buildOrganizationInfo(db, rows[0]!);
		}),
	);

	// ─── PATCH /organization/update ─────────────────────────────
	registerRoute(
		router,
		{ method: "patch", path: "/organization/update" },
		authed(async (req) => {
			const { organization_id, ...updates } = req.body ?? {};

			if (!organization_id) {
				throw ApiError.badRequest("必须提供 organization_id");
			}

			const existing = await db
				.select()
				.from(LiteLLM_OrganizationTable)
				.where(eq(LiteLLM_OrganizationTable.organizationId, organization_id))
				.limit(1);

			if (existing.length === 0) {
				throw ApiError.notFound(`组织不存在: ${organization_id}`);
			}

			const updateFields: Record<string, unknown> = {};
			if (updates.organization_alias !== undefined) {
				updateFields.organizationAlias = updates.organization_alias;
			}
			if (updates.budget_id !== undefined) {
				updateFields.budgetId = updates.budget_id;
			}
			if (updates.metadata !== undefined) {
				updateFields.metadata = updates.metadata;
			}
			if (updates.models !== undefined) {
				updateFields.models = updates.models;
			}
			if (updates.updated_by !== undefined) {
				updateFields.updatedBy = updates.updated_by;
			}
			const updated = await db
				.update(LiteLLM_OrganizationTable)
				.set({ ...updateFields, updatedAt: new Date() })
				.where(eq(LiteLLM_OrganizationTable.organizationId, organization_id))
				.returning();

			logger.info(`组织已更新: ${organization_id}`);

			return updated[0] === undefined ? { success: true } : normalizeOrganizationRow(updated[0] as OrganizationRow, [], []);
		}),
	);

	// ─── DELETE /organization/delete ────────────────────────────
	registerRoute(
		router,
		{ method: "delete", path: "/organization/delete" },
		authed(async (req) => {
			const organizationIds = Array.isArray(req.body?.organization_ids) ? (req.body.organization_ids as string[]) : [];
			const singleOrgId = (req.query.organization_id as string | undefined) ?? req.body?.organization_id;
			const orgIds =
				organizationIds.length > 0 ? organizationIds : [singleOrgId].filter((orgId): orgId is string => typeof orgId === "string");

			if (orgIds.length === 0) {
				throw ApiError.badRequest("必须提供 organization_id");
			}

			const deleted: unknown[] = [];
			for (const orgId of orgIds) {
				const existing = await db
					.select()
					.from(LiteLLM_OrganizationTable)
					.where(eq(LiteLLM_OrganizationTable.organizationId, orgId))
					.limit(1);
				const result = await db.delete(LiteLLM_OrganizationTable).where(eq(LiteLLM_OrganizationTable.organizationId, orgId));
				if (result.rowCount === 0) {
					throw ApiError.notFound(`Organization=${orgId} not found`);
				}
				deleted.push(existing[0] ?? { organization_id: orgId });
				logger.info(`组织已删除: ${orgId}`);
			}

			return deleted;
		}),
	);

	async function addOrganizationMember(req: Request): Promise<Record<string, unknown>> {
		const body = (req.body ?? {}) as Record<string, unknown>;
		const organizationId = body.organization_id as string | undefined;
		if (!organizationId) {
			throw ApiError.badRequest("必须提供 organization_id 和 user_id");
		}

		const existingOrganization = await db
			.select()
			.from(LiteLLM_OrganizationTable)
			.where(eq(LiteLLM_OrganizationTable.organizationId, organizationId))
			.limit(1);
		if (existingOrganization.length === 0) {
			throw ApiError.notFound(`Organization not found for organization_id=${organizationId}`);
		}

		const updatedUsers: UserRow[] = [];
		const updatedOrganizationMemberships: OrganizationMembershipRow[] = [];
		for (const member of extractMembers(body)) {
			const user = await ensureUser(db, member);
			const userRole = member.role ?? member.user_role ?? null;
			await db
				.insert(LiteLLM_OrganizationMembership)
				.values({
					userId: user.userId,
					organizationId: organizationId,
					userRole: userRole,
					budgetId: (body.budget_id as string | undefined) ?? null,
				})
				.onConflictDoNothing();
			updatedUsers.push(user);
			updatedOrganizationMemberships.push({
				userId: user.userId,
				organizationId: organizationId,
				userRole: userRole,
				spend: 0,
				budgetId: (body.budget_id as string | undefined) ?? null,
				createdAt: null,
				updatedAt: null,
			});
		}

		logger.info(`成员已加入组织: count=${updatedUsers.length} -> ${organizationId}`);

		return {
			organization_id: organizationId,
			updated_users: updatedUsers,
			updated_organization_memberships: updatedOrganizationMemberships.map(normalizeOrganizationMembership),
		};
	}

	async function deleteOrganizationMember(req: Request): Promise<WebUiOrganizationMembershipInfo | { readonly success: true }> {
		const { organization_id, user_id } = req.body ?? {};

		if (!organization_id || !user_id) {
			throw ApiError.badRequest("必须提供 organization_id 和 user_id");
		}

		const existing = await db
			.select()
			.from(LiteLLM_OrganizationMembership)
			.where(
				and(eq(LiteLLM_OrganizationMembership.organizationId, organization_id), eq(LiteLLM_OrganizationMembership.userId, user_id)),
			)
			.limit(1);
		const result = await db
			.delete(LiteLLM_OrganizationMembership)
			.where(
				and(eq(LiteLLM_OrganizationMembership.organizationId, organization_id), eq(LiteLLM_OrganizationMembership.userId, user_id)),
			);

		if (result.rowCount === 0) {
			throw ApiError.notFound("组织成员关系不存在");
		}

		logger.info(`成员已从组织移除: ${user_id} -> ${organization_id}`);

		return existing[0] === undefined ? { success: true } : normalizeOrganizationMembership(existing[0]);
	}

	// ─── POST /organization/member/add + Python /organization/member_add ───────
	registerRoute(router, { method: "post", path: "/organization/member/add" }, authed(addOrganizationMember));
	registerRoute(router, { method: "post", path: "/organization/member_add" }, authed(addOrganizationMember));

	// ─── DELETE /organization/member_delete + compatibility POST aliases ───────
	registerRoute(router, { method: "delete", path: "/organization/member_delete" }, authed(deleteOrganizationMember));
	registerRoute(router, { method: "post", path: "/organization/member/delete" }, authed(deleteOrganizationMember));
	registerRoute(router, { method: "post", path: "/organization/member_delete" }, authed(deleteOrganizationMember));
}
