/**
 * 代理模型管理端点 — CRUD 操作
 *
 * 工厂函数：createModelManagementRoutes(router, db, authMiddleware)
 * 注册所有 /model/* 路由，针对 LiteLLM_ProxyModelTable。
 * 写操作响应逐字段对齐 Python 版实测结构（litellm/proxy/management_endpoints/model_management_endpoints.py）。
 */

import { randomUUID } from "crypto";
import type { Router, Request, RequestHandler } from "express";
import { eq } from "drizzle-orm";
import type { DrizzleDb } from "../core/db/Database";
import { registerRoute } from "../core/api/registerRoute";
import { ApiError, HTTP_STATUS, PYTHON_NONE_FILL } from "../core/api/ApiError";
import { LiteLLM_ProxyModelTable } from "../db/schema/proxyModels";
import type { Router as LiteLLMRouter } from "../router/Router";
import { proxyModelRowToDeployment } from "../router/ProxyModelDeployment";
import { createModuleLogger } from "../core/utils/logger";
import { PROXY_ADMIN_USER_ID } from "../types/webUiSession";

const logger = createModuleLogger("Management:Model");

type ProxyModelRow = typeof LiteLLM_ProxyModelTable.$inferSelect;

/** Python LiteLLM_Params pydantic 缺省值：/model/new 实测响应中自动补齐的布尔字段。 */
const LITELLM_PARAMS_DEFAULTS: Readonly<Record<string, boolean>> = {
	use_litellm_proxy: false,
	use_in_pass_through: false,
	merge_reasoning_content_in_choices: false,
};

/**
 * 补齐 litellm_params 的 Python pydantic 缺省字段（仅在缺省时填充 false）。
 * @param params - 请求/合并后的 litellm_params
 */
function withLitellmParamsDefaults(params: Record<string, unknown>): Record<string, unknown> {
	const output = { ...params };
	for (const [name, defaultValue] of Object.entries(LITELLM_PARAMS_DEFAULTS)) {
		if (output[name] === undefined || output[name] === null) {
			output[name] = defaultValue;
		}
	}
	return output;
}

/**
 * 模型行 → Python /model/new、/model/update 实测响应（8 键）。
 * @param row
 */
function toPythonProxyModelRow(row: ProxyModelRow): Record<string, unknown> {
	return {
		model_id: row.model_id,
		model_name: row.model_name,
		litellm_params: row.litellm_params,
		model_info: row.model_info,
		created_at: row.created_at,
		created_by: row.created_by,
		updated_at: row.updated_at,
		updated_by: row.updated_by,
	};
}

/**
 * 按 Python update_model 语义合并 litellm_params：新值非 null 覆盖，null 回退到既有值。
 * @param existingParams - DB 既有 litellm_params
 * @param newParams - 请求传入的 litellm_params
 */
function mergeLitellmParams(existingParams: Record<string, unknown>, newParams: Record<string, unknown>): Record<string, unknown> {
	const merged: Record<string, unknown> = { ...existingParams };
	for (const [name, value] of Object.entries(newParams)) {
		if (value !== null && value !== undefined) {
			merged[name] = value;
		}
	}
	return merged;
}

/**
 * 创建代理模型管理路由
 * @param router - Express Router 实例
 * @param db - Drizzle 数据库实例
 * @param authMiddleware - 认证中间件（null 表示不要求认证）
 * @param litellmRouter - 可选 LiteLLM Router；提供时写操作落库后同步热更新 deployments
 * （对齐 Python：/model/delete 调 llm_router.delete_deployment，
 * add/update 经 add_deployment → upsert_deployment 回灌，批次 C3）
 */
export function createModelManagementRoutes(
	router: Router,
	db: DrizzleDb,
	authMiddleware: RequestHandler | null,
	litellmRouter?: LiteLLMRouter,
): void {
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
	// 响应对齐 Python add_model 实测：完整模型行（8 键）。
	// model_id = model_info.id ?? 自动生成 uuid；litellm_params 补齐 pydantic 缺省布尔字段；
	// model_info 自动写入 id 与 db_model=false。
	registerRoute(
		router,
		{ method: "post", path: "/model/new" },
		authed(async (req) => {
			const body = (req.body ?? {}) as Record<string, unknown>;
			const modelName = body["model_name"];
			const litellmParams = body["litellm_params"];
			const modelInfo = body["model_info"];

			if (!modelName || !litellmParams) {
				throw ApiError.badRequest("必须提供 model_name 和 litellm_params");
			}

			const createdBy = req.auth?.user_id ?? PROXY_ADMIN_USER_ID;
			const requestModelInfo = modelInfo !== null && typeof modelInfo === "object" ? (modelInfo as Record<string, unknown>) : {};
			const requestModelId = requestModelInfo["id"];
			const modelId = typeof requestModelId === "string" && requestModelId.length > 0 ? requestModelId : randomUUID();

			const inserted = await db
				.insert(LiteLLM_ProxyModelTable)
				.values({
					model_id: modelId,
					model_name: modelName as string,
					litellm_params: withLitellmParamsDefaults(litellmParams as Record<string, unknown>),
					model_info: { ...requestModelInfo, id: modelId, db_model: false },
					created_by: createdBy,
					updated_by: createdBy,
				})
				.returning();

			logger.info(`代理模型已创建: ${String(modelName)} (${modelId})`);

			// 批次 C3：落库后同步热更新 Router，新模型无需重启即可路由
			litellmRouter?.upsertDeployment(proxyModelRowToDeployment(inserted[0]!));

			return toPythonProxyModelRow(inserted[0]!);
		}),
	);

	// ─── POST /model/update ─────────────────────────────────────
	// 对齐 Python update_model：必须提供 model_info.id；仅合并更新 litellm_params（非 null 覆盖），
	// 响应为更新后完整模型行（8 键）。
	registerRoute(
		router,
		{ method: "post", path: "/model/update" },
		authed(async (req) => {
			const body = (req.body ?? {}) as Record<string, unknown>;
			const modelInfo = body["model_info"];

			if (modelInfo === undefined || modelInfo === null || typeof modelInfo !== "object") {
				throw new ApiError(
					HTTP_STATUS.BAD_REQUEST,
					"Authentication Error, model_info not provided",
					"auth_error",
					PYTHON_NONE_FILL,
				);
			}
			const modelId = (modelInfo as Record<string, unknown>)["id"];
			if (typeof modelId !== "string" || modelId.length === 0) {
				throw new ApiError(
					HTTP_STATUS.BAD_REQUEST,
					"Authentication Error, model_info.id not provided",
					"auth_error",
					PYTHON_NONE_FILL,
				);
			}

			const existing = await db.select().from(LiteLLM_ProxyModelTable).where(eq(LiteLLM_ProxyModelTable.model_id, modelId)).limit(1);

			if (existing.length === 0) {
				throw new ApiError(HTTP_STATUS.BAD_REQUEST, "Authentication Error, model not found", "auth_error", PYTHON_NONE_FILL);
			}

			const newParams = body["litellm_params"];
			if (newParams === undefined || newParams === null || typeof newParams !== "object") {
				throw new ApiError(
					HTTP_STATUS.BAD_REQUEST,
					"Authentication Error, litellm_params not provided",
					"auth_error",
					PYTHON_NONE_FILL,
				);
			}

			const existingParams = (existing[0]!.litellm_params ?? {}) as Record<string, unknown>;
			const mergedParams = withLitellmParamsDefaults(mergeLitellmParams(existingParams, newParams as Record<string, unknown>));

			const updated = await db
				.update(LiteLLM_ProxyModelTable)
				.set({ litellm_params: mergedParams, updated_by: req.auth?.user_id ?? PROXY_ADMIN_USER_ID, updated_at: new Date() })
				.where(eq(LiteLLM_ProxyModelTable.model_id, modelId))
				.returning();

			logger.info(`代理模型已更新: ${modelId}`);

			// 批次 C3：参数变更热更新 Router（同 model_id 替换 deployment）
			litellmRouter?.upsertDeployment(proxyModelRowToDeployment(updated[0]!));

			return toPythonProxyModelRow(updated[0]!);
		}),
	);

	// ─── POST /model/delete ─────────────────────────────────────
	// 对齐 Python delete_model：请求 { id }，响应 { message: "Model: <id> deleted successfully" }。
	registerRoute(
		router,
		{ method: "post", path: "/model/delete" },
		authed(async (req) => {
			const body = (req.body ?? {}) as Record<string, unknown>;
			const modelId = (body["id"] as string | undefined) ?? (body["model_id"] as string | undefined);

			if (!modelId) {
				throw ApiError.badRequest("必须提供 id");
			}

			const result = await db.delete(LiteLLM_ProxyModelTable).where(eq(LiteLLM_ProxyModelTable.model_id, modelId));

			if (result.rowCount === 0) {
				throw ApiError.badRequest(`Model with id=${modelId} not found in db`);
			}

			logger.info(`代理模型已删除: ${modelId}`);

			// 批次 C3：同步从 Router 移除（对齐 Python llm_router.delete_deployment）
			litellmRouter?.removeDeployment(modelId);

			return { message: `Model: ${modelId} deleted successfully` };
		}),
	);
}
