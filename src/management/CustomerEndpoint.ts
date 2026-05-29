/**
 * 端用户管理端点 — CRUD + 阻止/解封
 *
 * 工厂函数：createCustomerRoutes(router, db, authMiddleware)
 * 注册所有 /customer/* 路由，针对 LiteLLM_EndUserTable。
 */

import type { Router, Request, RequestHandler } from "express";
import { eq } from "drizzle-orm";
import type { DrizzleDb } from "../core/db/Database";
import { registerRoute } from "../core/api/registerRoute";
import { ApiError } from "../core/api/ApiError";
import { LiteLLM_EndUserTable } from "../db/schema/end-users";
import { createModuleLogger } from "../core/utils/logger";

const logger = createModuleLogger("Management:Customer");

/**
 * 创建端用户管理路由
 * @param router - Express Router 实例
 * @param db - Drizzle 数据库实例
 * @param authMiddleware - 认证中间件（null 表示不要求认证）
 */
export function createCustomerRoutes(router: Router, db: DrizzleDb, authMiddleware: RequestHandler | null): void {
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

	// ─── POST /customer/new ─────────────────────────────────────
	registerRoute(
		router,
		{ method: "post", path: "/customer/new" },
		authed(async (req) => {
			const { user_id, alias, allowed_model_region, default_model, budget_id, blocked } = req.body ?? {};

			if (!user_id) {
				throw ApiError.badRequest("必须提供 user_id");
			}

			// 检查重复
			const existing = await db.select().from(LiteLLM_EndUserTable).where(eq(LiteLLM_EndUserTable.userId, user_id)).limit(1);

			if (existing.length > 0) {
				throw ApiError.conflict(`端用户已存在: ${user_id}`);
			}

			await db.insert(LiteLLM_EndUserTable).values({
				userId: user_id,
				alias: alias ?? null,
				allowedModelRegion: allowed_model_region ?? null,
				defaultModel: default_model ?? null,
				budgetId: budget_id ?? null,
				blocked: blocked ?? false,
			});

			logger.info(`端用户已创建: ${user_id}`);

			return { success: true, user_id: user_id };
		}),
	);

	// ─── POST /customer/update ──────────────────────────────────
	registerRoute(
		router,
		{ method: "post", path: "/customer/update" },
		authed(async (req) => {
			const { user_id, ...updates } = req.body ?? {};

			if (!user_id) {
				throw ApiError.badRequest("必须提供 user_id");
			}

			const existing = await db.select().from(LiteLLM_EndUserTable).where(eq(LiteLLM_EndUserTable.userId, user_id)).limit(1);

			if (existing.length === 0) {
				throw ApiError.notFound(`端用户不存在: ${user_id}`);
			}

			const updateFields: Record<string, unknown> = {};
			if (updates.alias !== undefined) {
				updateFields.alias = updates.alias;
			}
			if (updates.allowed_model_region !== undefined) {
				updateFields.allowedModelRegion = updates.allowed_model_region;
			}
			if (updates.default_model !== undefined) {
				updateFields.defaultModel = updates.default_model;
			}
			if (updates.budget_id !== undefined) {
				updateFields.budgetId = updates.budget_id;
			}

			await db.update(LiteLLM_EndUserTable).set(updateFields).where(eq(LiteLLM_EndUserTable.userId, user_id));

			logger.info(`端用户已更新: ${user_id}`);

			return { success: true };
		}),
	);

	// ─── POST /customer/block ───────────────────────────────────
	registerRoute(
		router,
		{ method: "post", path: "/customer/block" },
		authed(async (req) => {
			const { user_id } = req.body ?? {};

			if (!user_id) {
				throw ApiError.badRequest("必须提供 user_id");
			}

			const result = await db.update(LiteLLM_EndUserTable).set({ blocked: true }).where(eq(LiteLLM_EndUserTable.userId, user_id));

			if (result.rowCount === 0) {
				throw ApiError.notFound(`端用户不存在: ${user_id}`);
			}

			logger.info(`端用户已阻止: ${user_id}`);

			return { success: true };
		}),
	);

	// ─── POST /customer/unblock ─────────────────────────────────
	registerRoute(
		router,
		{ method: "post", path: "/customer/unblock" },
		authed(async (req) => {
			const { user_id } = req.body ?? {};

			if (!user_id) {
				throw ApiError.badRequest("必须提供 user_id");
			}

			const result = await db.update(LiteLLM_EndUserTable).set({ blocked: false }).where(eq(LiteLLM_EndUserTable.userId, user_id));

			if (result.rowCount === 0) {
				throw ApiError.notFound(`端用户不存在: ${user_id}`);
			}

			logger.info(`端用户已解封: ${user_id}`);

			return { success: true };
		}),
	);

	// ─── GET /customer/info ─────────────────────────────────────
	registerRoute(
		router,
		{ method: "get", path: "/customer/info" },
		authed(async (req) => {
			const userId = (req.query.user_id as string) ?? req.body?.user_id;

			if (!userId) {
				throw ApiError.badRequest("必须提供 user_id");
			}

			const rows = await db.select().from(LiteLLM_EndUserTable).where(eq(LiteLLM_EndUserTable.userId, userId)).limit(1);

			if (rows.length === 0) {
				throw ApiError.notFound(`端用户不存在: ${userId}`);
			}

			return { success: true, data: rows[0] };
		}),
	);

	// ─── GET /customer/list ─────────────────────────────────────
	registerRoute(
		router,
		{ method: "get", path: "/customer/list" },
		authed(async () => {
			const rows = await db.select().from(LiteLLM_EndUserTable);
			return { success: true, data: rows };
		}),
	);
}
