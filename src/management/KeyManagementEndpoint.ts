/**
 * 密钥管理端点 — CRUD + 生命周期操作
 *
 * 工厂函数：createKeyManagementRoutes(router, db, authMiddleware)
 * 注册所有 /key/* 路由，包括生成、更新、删除、阻止、轮换等操作。
 */

import type { Router, Request, RequestHandler } from "express";
import { eq } from "drizzle-orm";
import type { DrizzleDb } from "../core/db/Database";
import { registerRoute } from "../core/api/registerRoute";
import { ApiError } from "../core/api/ApiError";
import { hashApiKey, generateApiKey } from "../core/utils/crypto";
import { LiteLLM_VerificationToken } from "../db/schema/verification-tokens";
import { liteLLM_DeprecatedVerificationToken } from "../db/schema/deprecated-tokens";
import { createModuleLogger } from "../core/utils/logger";

const logger = createModuleLogger("Management:Key");

/**
 * 创建密钥管理路由
 * @param router - Express Router 实例
 * @param db - Drizzle 数据库实例
 * @param authMiddleware - 认证中间件（可选，null 表示不要求认证）
 */
export function createKeyManagementRoutes(router: Router, db: DrizzleDb, authMiddleware: RequestHandler | null): void {
	/**
	 * 认证中间件包装 — 需要认证的端点自动加上 authMiddleware
	 * @param handler
	 */
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

	// ─── POST /key/generate ────────────────────────────────────
	registerRoute(
		router,
		{ method: "post", path: "/key/generate" },
		authed(async (req) => {
			const {
				key_alias,
				key_name,
				user_id,
				team_id,
				metadata,
				models,
				max_budget,
				tpm_limit,
				rpm_limit,
				expires,
				permissions,
				allowed_routes,
				budget_id,
				organization_id,
			} = req.body ?? {};

			// 生成 API 密钥并哈希
			const plainKey = generateApiKey();
			const tokenHash = hashApiKey(plainKey);

			// 检查哈希是否已存在（极小概率碰撞）
			const existing = await db
				.select()
				.from(LiteLLM_VerificationToken)
				.where(eq(LiteLLM_VerificationToken.token, tokenHash))
				.limit(1);
			if (existing.length > 0) {
				throw ApiError.conflict("密钥哈希冲突，请重试");
			}

			await db.insert(LiteLLM_VerificationToken).values({
				token: tokenHash,
				keyAlias: key_alias ?? null,
				keyName: key_name ?? null,
				userId: user_id ?? null,
				teamId: team_id ?? null,
				organizationId: organization_id ?? null,
				budgetId: budget_id ?? null,
				metadata: metadata ?? {},
				models: models ?? [],
				maxBudget: max_budget ?? null,
				tpmLimit: tpm_limit ?? null,
				rpmLimit: rpm_limit ?? null,
				expires: expires ? new Date(expires) : null,
				permissions: permissions ?? {},
				allowedRoutes: allowed_routes ?? [],
				blocked: false,
			});

			logger.info(`密钥已生成: ${key_alias ?? "unnamed"}`);

			return {
				success: true,
				key: plainKey,
				token: tokenHash,
			};
		}),
	);

	// ─── POST /key/update ──────────────────────────────────────
	registerRoute(
		router,
		{ method: "post", path: "/key/update" },
		authed(async (req) => {
			const { key, token, ...updates } = req.body ?? {};
			const tokenId = token ?? (key ? hashApiKey(key) : null);

			if (!tokenId) {
				throw ApiError.badRequest("必须提供 key 或 token");
			}

			const existing = await db.select().from(LiteLLM_VerificationToken).where(eq(LiteLLM_VerificationToken.token, tokenId)).limit(1);
			if (existing.length === 0) {
				throw ApiError.notFound("密钥不存在");
			}

			// 构建可更新字段
			const updateFields: Record<string, unknown> = {};
			if (updates.key_alias !== undefined) {
				updateFields.keyAlias = updates.key_alias;
			}
			if (updates.key_name !== undefined) {
				updateFields.keyName = updates.key_name;
			}
			if (updates.user_id !== undefined) {
				updateFields.userId = updates.user_id;
			}
			if (updates.team_id !== undefined) {
				updateFields.teamId = updates.team_id;
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
			if (updates.tpm_limit !== undefined) {
				updateFields.tpmLimit = updates.tpm_limit;
			}
			if (updates.rpm_limit !== undefined) {
				updateFields.rpmLimit = updates.rpm_limit;
			}
			if (updates.expires !== undefined) {
				updateFields.expires = updates.expires ? new Date(updates.expires) : null;
			}
			if (updates.permissions !== undefined) {
				updateFields.permissions = updates.permissions;
			}
			if (updates.allowed_routes !== undefined) {
				updateFields.allowedRoutes = updates.allowed_routes;
			}
			if (updates.budget_id !== undefined) {
				updateFields.budgetId = updates.budget_id;
			}

			await db
				.update(LiteLLM_VerificationToken)
				.set({ ...updateFields, updatedAt: new Date() })
				.where(eq(LiteLLM_VerificationToken.token, tokenId));

			logger.info(`密钥已更新: ${tokenId.slice(0, 8)}...`);

			return { success: true };
		}),
	);

	// ─── POST /key/delete ──────────────────────────────────────
	registerRoute(
		router,
		{ method: "post", path: "/key/delete" },
		authed(async (req) => {
			const { key, token } = req.body ?? {};
			const tokenId = token ?? (key ? hashApiKey(key) : null);

			if (!tokenId) {
				throw ApiError.badRequest("必须提供 key 或 token");
			}

			const existing = await db.select().from(LiteLLM_VerificationToken).where(eq(LiteLLM_VerificationToken.token, tokenId)).limit(1);
			if (existing.length === 0) {
				throw ApiError.notFound("密钥不存在");
			}

			// 归档到 deprecated 表后删除
			await db.insert(liteLLM_DeprecatedVerificationToken).values({
				token: tokenId,
				activeTokenId: tokenId,
				revokeAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 天后彻底失效
			});

			await db.delete(LiteLLM_VerificationToken).where(eq(LiteLLM_VerificationToken.token, tokenId));

			logger.info(`密钥已删除: ${tokenId.slice(0, 8)}...`);

			return { success: true };
		}),
	);

	// ─── POST /key/info ────────────────────────────────────────
	registerRoute(
		router,
		{ method: "post", path: "/key/info" },
		authed(async (req) => {
			const { key, token } = req.body ?? {};
			const tokenId = token ?? (key ? hashApiKey(key) : null);

			if (!tokenId) {
				throw ApiError.badRequest("必须提供 key 或 token");
			}

			const rows = await db.select().from(LiteLLM_VerificationToken).where(eq(LiteLLM_VerificationToken.token, tokenId)).limit(1);
			if (rows.length === 0) {
				throw ApiError.notFound("密钥不存在");
			}

			return { success: true, data: rows[0] };
		}),
	);

	// ─── GET /key/list ─────────────────────────────────────────
	registerRoute(
		router,
		{ method: "get", path: "/key/list" },
		authed(async () => {
			const rows = await db.select().from(LiteLLM_VerificationToken);
			return { success: true, data: rows };
		}),
	);

	// ─── POST /key/block ───────────────────────────────────────
	registerRoute(
		router,
		{ method: "post", path: "/key/block" },
		authed(async (req) => {
			const { key, token } = req.body ?? {};
			const tokenId = token ?? (key ? hashApiKey(key) : null);

			if (!tokenId) {
				throw ApiError.badRequest("必须提供 key 或 token");
			}

			const result = await db
				.update(LiteLLM_VerificationToken)
				.set({ blocked: true, updatedAt: new Date() })
				.where(eq(LiteLLM_VerificationToken.token, tokenId));

			if (result.rowCount === 0) {
				throw ApiError.notFound("密钥不存在");
			}

			logger.info(`密钥已阻止: ${tokenId.slice(0, 8)}...`);

			return { success: true };
		}),
	);

	// ─── POST /key/unblock ─────────────────────────────────────
	registerRoute(
		router,
		{ method: "post", path: "/key/unblock" },
		authed(async (req) => {
			const { key, token } = req.body ?? {};
			const tokenId = token ?? (key ? hashApiKey(key) : null);

			if (!tokenId) {
				throw ApiError.badRequest("必须提供 key 或 token");
			}

			const result = await db
				.update(LiteLLM_VerificationToken)
				.set({ blocked: false, updatedAt: new Date() })
				.where(eq(LiteLLM_VerificationToken.token, tokenId));

			if (result.rowCount === 0) {
				throw ApiError.notFound("密钥不存在");
			}

			logger.info(`密钥已解封: ${tokenId.slice(0, 8)}...`);

			return { success: true };
		}),
	);

	// ─── POST /key/regenerate ──────────────────────────────────
	registerRoute(
		router,
		{ method: "post", path: "/key/regenerate" },
		authed(async (req) => {
			const { key, token } = req.body ?? {};
			const oldTokenId = token ?? (key ? hashApiKey(key) : null);

			if (!oldTokenId) {
				throw ApiError.badRequest("必须提供 key 或 token");
			}

			const existing = await db
				.select()
				.from(LiteLLM_VerificationToken)
				.where(eq(LiteLLM_VerificationToken.token, oldTokenId))
				.limit(1);
			if (existing.length === 0) {
				throw ApiError.notFound("密钥不存在");
			}

			const record = existing[0]!;

			// 生成新密钥
			const newPlainKey = generateApiKey();
			const newTokenHash = hashApiKey(newPlainKey);

			// 检查新哈希碰撞
			const collision = await db
				.select()
				.from(LiteLLM_VerificationToken)
				.where(eq(LiteLLM_VerificationToken.token, newTokenHash))
				.limit(1);
			if (collision.length > 0) {
				throw ApiError.conflict("新密钥哈希冲突，请重试");
			}

			// 插入新密钥（复制旧密钥元数据）
			await db.insert(LiteLLM_VerificationToken).values({
				token: newTokenHash,
				keyAlias: record.keyAlias,
				keyName: record.keyName,
				userId: record.userId,
				teamId: record.teamId,
				organizationId: record.organizationId,
				budgetId: record.budgetId,
				metadata: record.metadata ?? {},
				models: record.models,
				maxBudget: record.maxBudget,
				tpmLimit: record.tpmLimit,
				rpmLimit: record.rpmLimit,
				expires: record.expires,
				permissions: record.permissions ?? {},
				allowedRoutes: record.allowedRoutes ?? [],
				blocked: false,
				createdBy: record.createdBy,
			});

			// 旧密钥标记为已轮换
			await db.insert(liteLLM_DeprecatedVerificationToken).values({
				token: oldTokenId,
				activeTokenId: newTokenHash,
				revokeAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
			});

			// 移除旧令牌
			await db.delete(LiteLLM_VerificationToken).where(eq(LiteLLM_VerificationToken.token, oldTokenId));

			logger.info(`密钥已轮换: ${oldTokenId.slice(0, 8)}... -> ${newTokenHash.slice(0, 8)}...`);

			return {
				success: true,
				key: newPlainKey,
				token: newTokenHash,
			};
		}),
	);
}
