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

const logger = createModuleLogger("Management:User");

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
				throw ApiError.badRequest("必须提供 user_id");
			}

			// 检查重复
			const existing = await db.select().from(LiteLLM_UserTable).where(eq(LiteLLM_UserTable.userId, user_id)).limit(1);
			if (existing.length > 0) {
				throw ApiError.conflict(`用户已存在: ${user_id}`);
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

			logger.info(`用户已创建: ${user_id}`);

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
				throw ApiError.badRequest("必须提供 user_id");
			}

			const existing = await db.select().from(LiteLLM_UserTable).where(eq(LiteLLM_UserTable.userId, user_id)).limit(1);
			if (existing.length === 0) {
				throw ApiError.notFound(`用户不存在: ${user_id}`);
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

			logger.info(`用户已更新: ${user_id}`);

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
				throw ApiError.badRequest("必须提供 user_id");
			}

			const result = await db.delete(LiteLLM_UserTable).where(eq(LiteLLM_UserTable.userId, user_id));

			if (result.rowCount === 0) {
				throw ApiError.notFound(`用户不存在: ${user_id}`);
			}

			logger.info(`用户已删除: ${user_id}`);

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
				throw ApiError.badRequest("必须提供 user_id");
			}

			const rows = await db.select().from(LiteLLM_UserTable).where(eq(LiteLLM_UserTable.userId, userId)).limit(1);
			if (rows.length === 0) {
				throw ApiError.notFound(`用户不存在: ${userId}`);
			}

			return { success: true, data: rows[0] };
		}),
	);

	// ─── GET /user/list ────────────────────────────────────────
	registerRoute(
		router,
		{ method: "get", path: "/user/list" },
		authed(async () => {
			const rows = await db.select().from(LiteLLM_UserTable);
			return { success: true, data: rows };
		}),
	);
}
