/**
 * 代理模型管理端点 — CRUD 操作
 *
 * 工厂函数：createModelManagementRoutes(router, db, authMiddleware)
 * 注册所有 /model/* 路由，针对 LiteLLM_ProxyModelTable。
 */

import type { Router, Request, RequestHandler } from "express";
import { eq } from "drizzle-orm";
import type { DrizzleDb } from "../core/db/Database";
import { registerRoute } from "../core/api/registerRoute";
import { ApiError } from "../core/api/ApiError";
import { LiteLLM_ProxyModelTable } from "../db/schema/proxyModels";
import { createModuleLogger } from "../core/utils/logger";

const logger = createModuleLogger("Management:Model");

/**
 * 创建代理模型管理路由
 * @param router - Express Router 实例
 * @param db - Drizzle 数据库实例
 * @param authMiddleware - 认证中间件（null 表示不要求认证）
 */
export function createModelManagementRoutes(router: Router, db: DrizzleDb, authMiddleware: RequestHandler | null): void {
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

	// ─── POST /model/new ────────────────────────────────────────
	registerRoute(
		router,
		{ method: "post", path: "/model/new" },
		authed(async (req) => {
			const { model_name, litellm_params, model_info, created_by, updated_by } = req.body ?? {};

			if (!model_name || !litellm_params) {
				throw ApiError.badRequest("必须提供 model_name 和 litellm_params");
			}

			const result = await db
				.insert(LiteLLM_ProxyModelTable)
				.values({
					model_name: model_name,
					litellm_params: litellm_params,
					model_info: model_info ?? null,
					created_by: created_by ?? "admin",
					updated_by: updated_by ?? "admin",
				})
				.returning({ modelId: LiteLLM_ProxyModelTable.model_id });

			const modelId = result[0]!.modelId;
			logger.info(`代理模型已创建: ${model_name} (${modelId})`);

			return { success: true, model_id: modelId };
		}),
	);

	// ─── POST /model/update ─────────────────────────────────────
	registerRoute(
		router,
		{ method: "post", path: "/model/update" },
		authed(async (req) => {
			const { model_id, ...updates } = req.body ?? {};

			if (!model_id) {
				throw ApiError.badRequest("必须提供 model_id");
			}

			const existing = await db.select().from(LiteLLM_ProxyModelTable).where(eq(LiteLLM_ProxyModelTable.model_id, model_id)).limit(1);

			if (existing.length === 0) {
				throw ApiError.notFound(`模型不存在: ${model_id}`);
			}

			const updateFields: Record<string, unknown> = {};
			if (updates.model_name !== undefined) {
				updateFields.model_name = updates.model_name;
			}
			if (updates.litellm_params !== undefined) {
				updateFields.litellm_params = updates.litellm_params;
			}
			if (updates.model_info !== undefined) {
				updateFields.model_info = updates.model_info;
			}
			if (updates.updated_by !== undefined) {
				updateFields.updated_by = updates.updated_by;
			}

			await db
				.update(LiteLLM_ProxyModelTable)
				.set({ ...updateFields, updated_at: new Date() })
				.where(eq(LiteLLM_ProxyModelTable.model_id, model_id));

			logger.info(`代理模型已更新: ${model_id}`);

			return { success: true };
		}),
	);

	// ─── POST /model/delete ─────────────────────────────────────
	registerRoute(
		router,
		{ method: "post", path: "/model/delete" },
		authed(async (req) => {
			const { model_id } = req.body ?? {};

			if (!model_id) {
				throw ApiError.badRequest("必须提供 model_id");
			}

			const result = await db.delete(LiteLLM_ProxyModelTable).where(eq(LiteLLM_ProxyModelTable.model_id, model_id));

			if (result.rowCount === 0) {
				throw ApiError.notFound(`模型不存在: ${model_id}`);
			}

			logger.info(`代理模型已删除: ${model_id}`);

			return { success: true };
		}),
	);
}
