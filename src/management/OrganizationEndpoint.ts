/**
 * 组织管理端点 — CRUD + 成员管理
 *
 * 工厂函数：createOrganizationRoutes(router, db, authMiddleware)
 * 注册所有 /organization/* 路由，针对 LiteLLM_OrganizationTable。
 */

import type { Router, Request, RequestHandler } from "express";
import { eq, and } from "drizzle-orm";
import type { DrizzleDb } from "../core/db/Database";
import { registerRoute } from "../core/api/registerRoute";
import { ApiError } from "../core/api/ApiError";
import { LiteLLM_OrganizationTable } from "../db/schema/organizations";
import { LiteLLM_OrganizationMembership } from "../db/schema/organization-memberships";
import { createModuleLogger } from "../core/utils/logger";

const logger = createModuleLogger("Management:Organization");

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
			const { organization_alias, budget_id, metadata, models, created_by, updated_by } = req.body ?? {};

			if (!organization_alias) {
				throw ApiError.badRequest("必须提供 organization_alias");
			}

			const result = await db
				.insert(LiteLLM_OrganizationTable)
				.values({
					organizationAlias: organization_alias,
					budgetId: budget_id ?? "",
					metadata: metadata ?? {},
					models: models ?? [],
					createdBy: created_by ?? "admin",
					updatedBy: updated_by ?? "admin",
				})
				.returning({ organizationId: LiteLLM_OrganizationTable.organizationId });

			const orgId = result[0]!.organizationId;
			logger.info(`组织已创建: ${organization_alias} (${orgId})`);

			return { success: true, organization_id: orgId };
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
				throw ApiError.notFound(`组织不存在: ${orgId}`);
			}

			return { success: true, data: rows[0] };
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

			await db
				.update(LiteLLM_OrganizationTable)
				.set({ ...updateFields, updatedAt: new Date() })
				.where(eq(LiteLLM_OrganizationTable.organizationId, organization_id));

			logger.info(`组织已更新: ${organization_id}`);

			return { success: true };
		}),
	);

	// ─── DELETE /organization/delete ────────────────────────────
	registerRoute(
		router,
		{ method: "delete", path: "/organization/delete" },
		authed(async (req) => {
			const orgId = (req.query.organization_id as string) ?? req.body?.organization_id;

			if (!orgId) {
				throw ApiError.badRequest("必须提供 organization_id");
			}

			const result = await db.delete(LiteLLM_OrganizationTable).where(eq(LiteLLM_OrganizationTable.organizationId, orgId));

			if (result.rowCount === 0) {
				throw ApiError.notFound(`组织不存在: ${orgId}`);
			}

			logger.info(`组织已删除: ${orgId}`);

			return { success: true };
		}),
	);

	// ─── POST /organization/member/add ──────────────────────────
	registerRoute(
		router,
		{ method: "post", path: "/organization/member/add" },
		authed(async (req) => {
			const { organization_id, user_id, user_role, budget_id } = req.body ?? {};

			if (!organization_id || !user_id) {
				throw ApiError.badRequest("必须提供 organization_id 和 user_id");
			}

			await db
				.insert(LiteLLM_OrganizationMembership)
				.values({
					userId: user_id,
					organizationId: organization_id,
					userRole: user_role ?? null,
					budgetId: budget_id ?? null,
				})
				.onConflictDoNothing();

			logger.info(`成员已加入组织: ${user_id} -> ${organization_id}`);

			return { success: true };
		}),
	);

	// ─── POST /organization/member/delete ───────────────────────
	registerRoute(
		router,
		{ method: "post", path: "/organization/member/delete" },
		authed(async (req) => {
			const { organization_id, user_id } = req.body ?? {};

			if (!organization_id || !user_id) {
				throw ApiError.badRequest("必须提供 organization_id 和 user_id");
			}

			const result = await db
				.delete(LiteLLM_OrganizationMembership)
				.where(
					and(
						eq(LiteLLM_OrganizationMembership.organizationId, organization_id),
						eq(LiteLLM_OrganizationMembership.userId, user_id),
					),
				);

			if (result.rowCount === 0) {
				throw ApiError.notFound("组织成员关系不存在");
			}

			logger.info(`成员已从组织移除: ${user_id} -> ${organization_id}`);

			return { success: true };
		}),
	);
}
