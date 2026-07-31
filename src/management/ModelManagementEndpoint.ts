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
const MANAGED_CLIPROXY_CONNECTION_FIELDS = ["litellm_credential_name", "credential_name", "api_base", "api_key"] as const;

/**
 * The built-in CLIProxy provider owns its loopback endpoint and internal key.
 * Deployment-level credentials must never override or depend on that boundary.
 */
function normalizeManagedProviderParams(params: Record<string, unknown>): Record<string, unknown> {
	const output = { ...params };
	const model = output["model"];
	const isCliProxy =
		output["custom_llm_provider"] === "cliproxy" || (typeof model === "string" && model.startsWith("cliproxy/"));
	if (isCliProxy) {
		output["custom_llm_provider"] = "cliproxy";
		for (const field of MANAGED_CLIPROXY_CONNECTION_FIELDS) {
			delete output[field];
		}
	}
	return output;
}

/**
 * 补齐 litellm_params 的 Python pydantic 缺省字段（仅在缺省时填充 false）。
 * @param params - 请求/合并后的 litellm_params
 */
function withLitellmParamsDefaults(params: Record<string, unknown>): Record<string, unknown> {
	const output = normalizeManagedProviderParams(params);
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
		litellm_params: structuredClone(row.litellm_params),
		model_info: structuredClone(row.model_info),
		created_at: row.created_at,
		created_by: row.created_by,
		updated_at: row.updated_at,
		updated_by: row.updated_by,
	};
}

/**
 * 深合并模型 JSON 字段。PATCH 中 null 删除；legacy POST 中 null 不覆盖。
 * @param existing - DB 现有对象
 * @param patch - 请求更新对象
 * @param deleteNull - 是否将 null 解释为删除
 */
function mergeObjectPatch(existing: Record<string, unknown>, patch: Record<string, unknown>, deleteNull: boolean): Record<string, unknown> {
	const merged: Record<string, unknown> = { ...existing };
	for (const [name, value] of Object.entries(patch)) {
		if (value === undefined || (value === null && !deleteNull)) {
			continue;
		}
		if (value === null) {
			delete merged[name];
			continue;
		}
		const existingValue = merged[name];
		if (
			typeof value === "object" &&
			!Array.isArray(value) &&
			typeof existingValue === "object" &&
			existingValue !== null &&
			!Array.isArray(existingValue)
		) {
			merged[name] = mergeObjectPatch(existingValue as Record<string, unknown>, value as Record<string, unknown>, deleteNull);
		} else {
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

			const insertedRow = inserted.at(0);
			if (insertedRow === undefined) {
				throw new Error("Model insert did not return a row");
			}
			logger.info(`代理模型已创建: ${String(modelName)} (${modelId})`);

			// 批次 C3：落库后同步热更新 Router，新模型无需重启即可路由
			litellmRouter?.upsertDeployment(proxyModelRowToDeployment(insertedRow));

			return toPythonProxyModelRow(insertedRow);
		}),
	);

	async function updateModelById(
		modelId: string,
		body: Record<string, unknown>,
		updatedBy: string,
		deleteNull: boolean,
	): Promise<Record<string, unknown>> {
		const existingRows = await db.select().from(LiteLLM_ProxyModelTable).where(eq(LiteLLM_ProxyModelTable.model_id, modelId)).limit(1);
		const existing = existingRows[0];
		if (existing === undefined) {
			if (deleteNull) {
				throw ApiError.notFound("Model not found");
			}
			throw new ApiError(HTTP_STATUS.BAD_REQUEST, "Authentication Error, model not found", "auth_error", PYTHON_NONE_FILL);
		}

		if (
			deleteNull &&
			!["model_name", "litellm_params", "model_info"].some((fieldName) => Object.prototype.hasOwnProperty.call(body, fieldName))
		) {
			throw ApiError.badRequest("At least one model field must be provided");
		}

		const values: Record<string, unknown> = { updated_by: updatedBy, updated_at: new Date() };
		const requestedModelName = body["model_name"];
		if (requestedModelName !== undefined && !(requestedModelName === null && !deleteNull)) {
			if (typeof requestedModelName !== "string" || requestedModelName.length === 0) {
				throw ApiError.badRequest("model_name must be a non-empty string");
			}
			values["model_name"] = requestedModelName;
		}

		const paramsPatch = body["litellm_params"];
		if (paramsPatch !== undefined) {
			if (paramsPatch === null || typeof paramsPatch !== "object" || Array.isArray(paramsPatch)) {
				throw ApiError.badRequest("litellm_params must be an object");
			}
			if (deleteNull && (paramsPatch as Record<string, unknown>)["model"] === null) {
				throw ApiError.badRequest("litellm_params.model cannot be deleted");
			}
			const mergedParams = mergeObjectPatch(
				(existing.litellm_params ?? {}) as Record<string, unknown>,
				paramsPatch as Record<string, unknown>,
				deleteNull,
			);
			if (typeof mergedParams["model"] !== "string" || mergedParams["model"].length === 0) {
				throw ApiError.badRequest("litellm_params.model is required");
			}
			values["litellm_params"] = withLitellmParamsDefaults(mergedParams);
		}

		const modelInfoPatch = body["model_info"];
		if (modelInfoPatch !== undefined) {
			if (modelInfoPatch === null || typeof modelInfoPatch !== "object" || Array.isArray(modelInfoPatch)) {
				throw ApiError.badRequest("model_info must be an object");
			}
			const requestedId = (modelInfoPatch as Record<string, unknown>)["id"];
			if (requestedId === null || (requestedId !== undefined && requestedId !== modelId)) {
				throw ApiError.badRequest("model_info.id must match modelId");
			}
			values["model_info"] = {
				...mergeObjectPatch(
					(existing.model_info ?? {}) as Record<string, unknown>,
					modelInfoPatch as Record<string, unknown>,
					deleteNull,
				),
				id: modelId,
			};
		}

		const updated = await db
			.update(LiteLLM_ProxyModelTable)
			.set(values)
			.where(eq(LiteLLM_ProxyModelTable.model_id, modelId))
			.returning();
		const updatedRow = updated.at(0);
		if (updatedRow === undefined) {
			if (deleteNull) {
				throw ApiError.notFound("Model not found");
			}
			throw new ApiError(HTTP_STATUS.BAD_REQUEST, "Authentication Error, model not found", "auth_error", PYTHON_NONE_FILL);
		}
		logger.info(`代理模型已更新: ${modelId}`);
		litellmRouter?.upsertDeployment(proxyModelRowToDeployment(updatedRow));
		return toPythonProxyModelRow(updatedRow);
	}

	// ─── POST /model/update ─────────────────────────────────────
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
			if (body["litellm_params"] === undefined || body["litellm_params"] === null || typeof body["litellm_params"] !== "object") {
				throw new ApiError(
					HTTP_STATUS.BAD_REQUEST,
					"Authentication Error, litellm_params not provided",
					"auth_error",
					PYTHON_NONE_FILL,
				);
			}
			return updateModelById(modelId, body, req.auth?.user_id ?? PROXY_ADMIN_USER_ID, false);
		}),
	);

	// ─── PATCH /model/:modelId/update ───────────────────────────
	registerRoute(
		router,
		{ method: "patch", path: "/model/:modelId/update" },
		authed(async (req) => {
			const modelId = req.params["modelId"];
			if (typeof modelId !== "string" || modelId.length === 0) {
				throw ApiError.badRequest("必须提供 modelId");
			}
			return updateModelById(modelId, (req.body ?? {}) as Record<string, unknown>, req.auth?.user_id ?? PROXY_ADMIN_USER_ID, true);
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
