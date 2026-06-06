/**
 * 密钥管理端点 — CRUD + 生命周期操作
 *
 * 工厂函数：createKeyManagementRoutes(router, db, authMiddleware)
 * 注册所有 /key/* 路由，包括生成、更新、删除、阻止、轮换等操作。
 * 协议源码：https://github.com/BerriAI/litellm/blob/main/litellm/proxy/proxy_server.py
 */

import type { Router, Request, RequestHandler } from "express";
import { eq, inArray, isNull, ne, or } from "drizzle-orm";
import type { DrizzleDb } from "../core/db/Database";
import { registerRoute } from "../core/api/registerRoute";
import { ApiError } from "../core/api/ApiError";
import { hashApiKey, generateApiKey } from "../core/utils/crypto";
import { LiteLLM_VerificationToken } from "../db/schema/verification-tokens";
import { liteLLM_DeprecatedVerificationToken } from "../db/schema/deprecated-tokens";
import { createModuleLogger } from "../core/utils/logger";
import { parsePositiveInt } from "../core/api/queryParams";
import { WEBUI_LOGIN_TEAM_ID } from "../types/webUiSession";

const logger = createModuleLogger("Management:Key");

/** 日志中 token/hash 只展示固定长度前缀，避免泄露完整密钥材料。 */
const TOKEN_LOG_PREFIX_LENGTH = 8;

/** /key/list 分页常量（消除散落魔法数字） */
const KEY_LIST_PAGINATION = {
	defaultPage: 1,
	defaultPageSize: 50,
	maxPageSize: 100,
	minPage: 1,
	minPageSize: 1,
	minTotalPages: 1,
} as const;

/**
 * VerificationToken 单行投影。
 * Drizzle 行对象是 TypeScript camelCase 字段；Python LiteLLM / WebUI 契约是 Prisma 字段名（snake_case）。
 */
type VerificationTokenRowLike = { token: unknown } & Record<string, unknown>;

const VERIFICATION_TOKEN_FIELD_ALIASES: Readonly<Record<string, string>> = {
	keyName: "key_name",
	keyAlias: "key_alias",
	softBudgetCooldown: "soft_budget_cooldown",
	routerSettings: "router_settings",
	userId: "user_id",
	teamId: "team_id",
	agentId: "agent_id",
	projectId: "project_id",
	maxParallelRequests: "max_parallel_requests",
	tpmLimit: "tpm_limit",
	rpmLimit: "rpm_limit",
	maxBudget: "max_budget",
	budgetDuration: "budget_duration",
	budgetResetAt: "budget_reset_at",
	allowedCacheControls: "allowed_cache_controls",
	allowedRoutes: "allowed_routes",
	accessGroupIds: "access_group_ids",
	modelSpend: "model_spend",
	modelMaxBudget: "model_max_budget",
	budgetId: "budget_id",
	organizationId: "organization_id",
	objectPermissionId: "object_permission_id",
	createdAt: "created_at",
	createdBy: "created_by",
	updatedAt: "updated_at",
	updatedBy: "updated_by",
	lastActive: "last_active",
	rotationCount: "rotation_count",
	autoRotate: "auto_rotate",
	rotationInterval: "rotation_interval",
	lastRotationAt: "last_rotation_at",
	keyRotationAt: "key_rotation_at",
};

/**
 * 转成 Python LiteLLM UserAPIKeyAuth / VerificationToken 响应字段名。
 * @param row - 原始 DB 行
 * @param includeToken - Python `return_full_object=true` 会返回 token 字段，WebUI 用它做 Key ID 与后续管理操作
 */
function toPythonVerificationTokenRow(row: VerificationTokenRowLike, includeToken: boolean): Record<string, unknown> {
	const output: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(row)) {
		if (key === "token" && !includeToken) {
			continue;
		}
		output[VERIFICATION_TOKEN_FIELD_ALIASES[key] ?? key] = value;
	}
	if (output["organization_id"] !== undefined && output["org_id"] === undefined) {
		// 当前复制版 WebUI 的 VirtualKeysTable 读取 org_id；Python 返回链路中也存在该兼容别名。
		output["org_id"] = output["organization_id"];
	}
	return output;
}

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
				throw ApiError.conflict("Key hash collision, please retry");
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

			logger.info(`Key generated: ${key_alias ?? "unnamed"}`);

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
				throw ApiError.badRequest("key or token is required");
			}

			const existing = await db.select().from(LiteLLM_VerificationToken).where(eq(LiteLLM_VerificationToken.token, tokenId)).limit(1);
			if (existing.length === 0) {
				throw ApiError.notFound("Key not found");
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

			logger.info(`Key updated: ${tokenId.slice(0, TOKEN_LOG_PREFIX_LENGTH)}...`);

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
				throw ApiError.badRequest("key or token is required");
			}

			const existing = await db.select().from(LiteLLM_VerificationToken).where(eq(LiteLLM_VerificationToken.token, tokenId)).limit(1);
			if (existing.length === 0) {
				throw ApiError.notFound("Key not found");
			}

			// 归档到 deprecated 表后删除
			await db.insert(liteLLM_DeprecatedVerificationToken).values({
				token: tokenId,
				activeTokenId: tokenId,
				revokeAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 天后彻底失效
			});

			await db.delete(LiteLLM_VerificationToken).where(eq(LiteLLM_VerificationToken.token, tokenId));

			logger.info(`Key deleted: ${tokenId.slice(0, TOKEN_LOG_PREFIX_LENGTH)}...`);

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
				throw ApiError.badRequest("key or token is required");
			}

			const rows = await db.select().from(LiteLLM_VerificationToken).where(eq(LiteLLM_VerificationToken.token, tokenId)).limit(1);
			if (rows.length === 0) {
				throw ApiError.notFound("Key not found");
			}

			return { success: true, data: rows[0] };
		}),
	);

	// ─── POST /v2/key/info ─────────────────────────────────────
	// WebUI 调用（见 ui/litellm-dashboard/src/components/networking.tsx::keyInfoCall）：
	//   POST { keys: string[] } → 返回指定 key 列表的元信息。
	//
	// 对齐 Python LiteLLM `info_key_fn_v2` (key_management_endpoints.py L3210)：
	//   - 请求体为 KeyRequest（含 keys 与可选 key_aliases）。
	//   - 按 token 数组 inArray 过滤查询 — 避免无 keys 时全表返回。
	//   - 响应 shape：{ key: 原 keys 数组, info: 匹配行（去掉 token 字段） }。
	//   - 鉴权：依赖 user_api_key_auth；TS 端由主 router 统一 `authed` 包装。
	//
	// 注意：当前 TS 端未实现 key_aliases 解析（不支持别名查 token），仅按 keys 过滤。
	registerRoute(
		router,
		{ method: "post", path: "/v2/key/info" },
		authed(async (req) => {
			const body = (req.body ?? {}) as { keys?: unknown; key_aliases?: unknown };
			const rawKeys = Array.isArray(body.keys) ? body.keys : [];
			const tokens = rawKeys.filter((k): k is string => typeof k === "string" && k.length > 0);

			if (tokens.length === 0) {
				return { key: rawKeys, info: [] };
			}

			// 客户端可能传入原始 key（sk-...）或 hashed token；当前实现直接用 inArray
			// 精确匹配存储的 token 字段 — 若存储为 hash，则需要 hashApiKey 预处理。
			// （WebUI 调用 keyInfoCall(accessToken, [accessToken]），accessToken 在
			//  /key/generate 之后会原样回写 LiteLLM_VerificationToken.token，因此
			//  inArray 精确匹配可命中。）
			const rows = await db.select().from(LiteLLM_VerificationToken).where(inArray(LiteLLM_VerificationToken.token, tokens));

			const info = rows.map((row) => toPythonVerificationTokenRow(row, false));

			return { key: rawKeys, info: info };
		}),
	);

	// ─── GET /key/list ─────────────────────────────────────────
	// WebUI 期望：{ keys, total_count, current_page, total_pages }
	// Python LiteLLM proxy_server.py::list_keys 行为一致
	registerRoute(
		router,
		{ method: "get", path: "/key/list" },
		authed(async (req) => {
			const page = parsePositiveInt(req.query.page, KEY_LIST_PAGINATION.defaultPage);
			const pageSize = Math.min(
				KEY_LIST_PAGINATION.maxPageSize,
				Math.max(KEY_LIST_PAGINATION.minPageSize, parsePositiveInt(req.query.size, KEY_LIST_PAGINATION.defaultPageSize)),
			);

			// 对齐 Python LiteLLM `_get_condition_to_filter_out_ui_session_tokens()`：
			//   team_id IS NULL OR team_id != UI_SESSION_TOKEN_TEAM_ID
			// UI_SESSION_TOKEN_TEAM_ID 在 Python 常量层为 "litellm-dashboard"，复用本仓库已存在的
			// WEBUI_LOGIN_TEAM_ID 保持单一事实来源。
			const notWebUiSession = or(isNull(LiteLLM_VerificationToken.teamId), ne(LiteLLM_VerificationToken.teamId, WEBUI_LOGIN_TEAM_ID));
			const allRows = await db.select().from(LiteLLM_VerificationToken).where(notWebUiSession);
			const totalCount = allRows.length;
			const startIndex = (page - 1) * pageSize;
			const pageRows = allRows.slice(startIndex, startIndex + pageSize);
			const totalPages =
				pageSize > 0
					? Math.max(KEY_LIST_PAGINATION.minTotalPages, Math.ceil(totalCount / pageSize))
					: KEY_LIST_PAGINATION.minTotalPages;

			const returnFullObject = req.query.return_full_object === "true";
			const keys = returnFullObject
				? pageRows.map((row) => toPythonVerificationTokenRow(row, true))
				: pageRows.map((row) => row.token);

			return {
				keys: keys,
				total_count: totalCount,
				current_page: page,
				total_pages: totalPages,
			};
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
				throw ApiError.badRequest("key or token is required");
			}

			const result = await db
				.update(LiteLLM_VerificationToken)
				.set({ blocked: true, updatedAt: new Date() })
				.where(eq(LiteLLM_VerificationToken.token, tokenId));

			if (result.rowCount === 0) {
				throw ApiError.notFound("Key not found");
			}

			logger.info(`Key blocked: ${tokenId.slice(0, TOKEN_LOG_PREFIX_LENGTH)}...`);

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
				throw ApiError.badRequest("key or token is required");
			}

			const result = await db
				.update(LiteLLM_VerificationToken)
				.set({ blocked: false, updatedAt: new Date() })
				.where(eq(LiteLLM_VerificationToken.token, tokenId));

			if (result.rowCount === 0) {
				throw ApiError.notFound("Key not found");
			}

			logger.info(`Key unblocked: ${tokenId.slice(0, TOKEN_LOG_PREFIX_LENGTH)}...`);

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
				throw ApiError.badRequest("key or token is required");
			}

			const existing = await db
				.select()
				.from(LiteLLM_VerificationToken)
				.where(eq(LiteLLM_VerificationToken.token, oldTokenId))
				.limit(1);
			if (existing.length === 0) {
				throw ApiError.notFound("Key not found");
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
				throw ApiError.conflict("New key hash collision, please retry");
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

			logger.info(
				`Key rotated: ${oldTokenId.slice(0, TOKEN_LOG_PREFIX_LENGTH)}... -> ${newTokenHash.slice(0, TOKEN_LOG_PREFIX_LENGTH)}...`,
			);

			return {
				success: true,
				key: newPlainKey,
				token: newTokenHash,
			};
		}),
	);
}
