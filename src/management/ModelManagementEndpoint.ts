import { subscriptionModelInfo, subscriptionModelParams } from "../subscriptions/SubscriptionProviders";
/**
 * 代理模型管理端点 — CRUD 操作
 *
 * 工厂函数：createModelManagementRoutes(router, db, authMiddleware)
 * 注册所有 /model/* 路由；模型行统一经 ModelRepository 读写。
 * 写操作响应逐字段对齐 Python 版实测结构（litellm/proxy/management_endpoints/model_management_endpoints.py）。
 */

import { randomUUID } from "crypto";
import type { Router, Request, RequestHandler } from "express";
import type { DrizzleDb } from "../core/db/Database";
import { registerRoute } from "../core/api/registerRoute";
import { ApiError, HTTP_STATUS, PYTHON_NONE_FILL } from "../core/api/ApiError";
import { modelRepositoryFor, type ModelRow, type ModelUpdateValues } from "../repositories/ModelRepository";
import {
	auditModelReferences,
	collectModelReferences,
	loadModelReferenceState,
	persistModelReferenceChanges,
	planModelReferenceRename,
} from "./ModelReferences";
import type { Router as LiteLLMRouter } from "../router/Router";
import { proxyModelRowToDeployment } from "../router/ProxyModelDeployment";
import { buildModelGroupOverrides } from "../router/ModelOverrides";
import { createModuleLogger } from "../core/utils/logger";
import { PROXY_ADMIN_USER_ID } from "../types/webUiSession";

const logger = createModuleLogger("Management:Model");

type ProxyModelRow = ModelRow;

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
	const output = { ...subscriptionModelParams(params) };
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

function validateModelOverrides(rows: ProxyModelRow[]): void {
	try {
		buildModelGroupOverrides(rows.map(proxyModelRowToDeployment));
	} catch (error) {
		throw ApiError.badRequest(error instanceof Error ? error.message : "Invalid model override");
	}
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
			const params = withLitellmParamsDefaults(litellmParams as Record<string, unknown>);
			const candidate = {
				model_id: modelId,
				model_name: modelName as string,
				litellm_params: params,
				model_info: { ...subscriptionModelInfo(requestModelInfo, params), id: modelId, db_model: false },
				created_at: new Date(),
				created_by: createdBy,
				updated_at: new Date(),
				updated_by: createdBy,
			} satisfies ProxyModelRow;
			const modelRepository = modelRepositoryFor(db);
			const currentRows = await modelRepository.snapshotRows();
			validateModelOverrides([...currentRows, candidate]);

			const insertedRow = await modelRepository.create({
				model_id: candidate.model_id,
				model_name: candidate.model_name,
				litellm_params: candidate.litellm_params,
				model_info: candidate.model_info,
				created_by: candidate.created_by,
				updated_by: candidate.updated_by,
			});
			logger.info(`代理模型已创建: ${String(modelName)} (${modelId})`);

			// 批次 C3：落库后同步热更新 Router，新模型无需重启即可路由
			litellmRouter?.upsertDeployment(proxyModelRowToDeployment(insertedRow));

			return toPythonProxyModelRow(insertedRow);
		}),
	);

	/**
	 * 改名级联：行改名成功后重写所有引用面（fallback 键与目标、alias 目标、
	 * override/fallbacks、团队/密钥/权限白名单、websearch 与能力执行模型）。
	 * 失败不回滚行改名——悬空引用由审计端点暴露，POST /model/rename 可补齐。
	 * @param from - 旧模型组名
	 * @param to - 新模型组名
	 * @param updatedBy - 写入者（模型行 updated_by）
	 */
	async function cascadeModelRenameReferences(from: string, to: string, updatedBy: string): Promise<void> {
		const state = await loadModelReferenceState(db);
		const changes = planModelReferenceRename(state, from, to);
		if (changes.counts.length === 0) {
			return;
		}
		await persistModelReferenceChanges(db, changes, updatedBy);
		logger.info(`模型改名 ${from} -> ${to} 已级联重写引用: ${JSON.stringify(changes.counts)}`);
	}

	async function updateModelById(
		modelId: string,
		body: Record<string, unknown>,
		updatedBy: string,
		deleteNull: boolean,
	): Promise<Record<string, unknown>> {
		const modelRepository = modelRepositoryFor(db);
		const existing = await modelRepository.findById(modelId);
		if (existing === null) {
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
				...subscriptionModelInfo(
					mergeObjectPatch(
						(existing.model_info ?? {}) as Record<string, unknown>,
						modelInfoPatch as Record<string, unknown>,
						deleteNull,
					),
					(values["litellm_params"] ?? existing.litellm_params) as Record<string, unknown>,
				),
				id: modelId,
			};
		}

		const allRows = await modelRepository.snapshotRows();
		validateModelOverrides(
			allRows.map((row) => {
				if (row.model_id !== modelId) {
					return row;
				}
				return {
					...row,
					...(values["model_name"] === undefined ? {} : { model_name: values["model_name"] }),
					...(values["litellm_params"] === undefined ? {} : { litellm_params: values["litellm_params"] }),
					...(values["model_info"] === undefined ? {} : { model_info: values["model_info"] }),
				} as ProxyModelRow;
			}),
		);

		const updatedRow = await modelRepository.update(modelId, values as ModelUpdateValues);
		if (updatedRow === null) {
			if (deleteNull) {
				throw ApiError.notFound("Model not found");
			}
			throw new ApiError(HTTP_STATUS.BAD_REQUEST, "Authentication Error, model not found", "auth_error", PYTHON_NONE_FILL);
		}
		logger.info(`代理模型已更新: ${modelId}`);
		litellmRouter?.upsertDeployment(proxyModelRowToDeployment(updatedRow));
		if (typeof values["model_name"] === "string" && values["model_name"] !== existing.model_name) {
			try {
				await cascadeModelRenameReferences(existing.model_name, values["model_name"], updatedBy);
			} catch (error) {
				logger.error(
					`模型改名 ${existing.model_name} -> ${String(values["model_name"])} 的引用级联失败；用 POST /model/rename 补齐`,
					{
						error: error instanceof Error ? error.message : String(error),
					},
				);
			}
		}
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

	// ─── GET /model/:modelId/raw ───────────────────────────────
	// Dashboard Raw JSON intentionally returns the exact database row, including
	// secrets and fields that are not part of the enriched list projection.
	registerRoute(
		router,
		{ method: "get", path: "/model/:modelId/raw" },
		authed(async (req) => {
			const modelId = req.params["modelId"];
			if (typeof modelId !== "string" || modelId.length === 0) {
				throw ApiError.badRequest("必须提供 modelId");
			}
			const row = await modelRepositoryFor(db).findById(modelId);
			if (row === null) {
				throw ApiError.notFound("Model not found");
			}
			return toPythonProxyModelRow(row);
		}),
	);

	// ─── POST /model/delete ─────────────────────────────────────
	// 对齐 Python delete_model：请求 { id }，响应 { message: "Model: <id> deleted successfully" }。
	// 删除守卫：这是组内最后一个部署行时，先查引用面；仍被 fallback 链、alias 目标、
	// 密钥白名单等引用的组直接删除会留下悬空引用（生产上一次改名残留让旧名请求
	// 静默改道后变 400）。需要带着引用删除时传 force=true。
	registerRoute(
		router,
		{ method: "post", path: "/model/delete" },
		authed(async (req) => {
			const body = (req.body ?? {}) as Record<string, unknown>;
			const modelId = (body["id"] as string | undefined) ?? (body["model_id"] as string | undefined);

			if (!modelId) {
				throw ApiError.badRequest("必须提供 id");
			}

			const modelRepository = modelRepositoryFor(db);
			const row = await modelRepository.findById(modelId);
			if (row !== null) {
				const sameGroupRows = (await modelRepository.snapshotRows()).filter((candidate) => candidate.model_name === row.model_name);
				if (sameGroupRows.length <= 1 && body["force"] !== true) {
					const state = await loadModelReferenceState(db);
					const blocking = collectModelReferences(state).filter(
						(reference) =>
							reference.name === row.model_name &&
							!(reference.surface.startsWith("model_info.") && reference.path === row.model_name),
					);
					if (blocking.length > 0) {
						const surfaces = [...new Set(blocking.map((reference) => reference.surface))].join(", ");
						throw new ApiError(
							HTTP_STATUS.CONFLICT,
							`模型组 ${row.model_name} 仍被 ${blocking.length} 处引用（${surfaces}）。改名请先 POST /model/rename；确认无引用后传 force=true 删除`,
							"conflict",
						);
					}
				}
			}

			const deleted = await modelRepository.remove(modelId);

			if (!deleted) {
				throw ApiError.badRequest(`Model with id=${modelId} not found in db`);
			}

			logger.info(`代理模型已删除: ${modelId}`);

			// 批次 C3：同步从 Router 移除（对齐 Python llm_router.delete_deployment）
			litellmRouter?.removeDeployment(modelId);

			return { message: `Model: ${modelId} deleted successfully` };
		}),
	);

	// ─── POST /model/rename ─────────────────────────────────────
	// 改名级联的补齐入口，三种语义按 from 的身份区分：
	//   - from 是别名键：别名改名——键与所有引用一起改写，to 不能与现行名字冲突；
	//   - from 是模型组名：行已由 /model/update 改名（那里会自动级联），此处只把
	//     引用重写到 to，to 必须是现行名字；
	//   - from 已不存在：手工善后——把残留引用重写到现行名字 to。
	registerRoute(
		router,
		{ method: "post", path: "/model/rename" },
		authed(async (req) => {
			const body = (req.body ?? {}) as Record<string, unknown>;
			const from = body["from"];
			const to = body["to"];
			if (typeof from !== "string" || from.length === 0 || typeof to !== "string" || to.length === 0) {
				throw ApiError.badRequest("必须提供 from 与 to");
			}
			if (from === to) {
				throw ApiError.badRequest("from 与 to 不能相同");
			}
			const state = await loadModelReferenceState(db);
			const audit = auditModelReferences(state);
			const live = new Set(audit.liveNames);
			const isAlias = audit.aliasKeys.includes(from);
			if (isAlias && live.has(to)) {
				throw new ApiError(HTTP_STATUS.CONFLICT, `to=${to} 已是现行模型组或别名；别名改名不能与现有名字冲突`, "conflict");
			}
			if (!isAlias && !live.has(to)) {
				throw new ApiError(HTTP_STATUS.CONFLICT, `to=${to} 不是现行模型组或别名；重写引用会造成新的悬空引用`, "conflict");
			}
			const changes = planModelReferenceRename(state, from, to, isAlias);
			if (changes.counts.length > 0) {
				await persistModelReferenceChanges(db, changes, req.auth?.user_id ?? PROXY_ADMIN_USER_ID);
			}
			logger.info(`模型引用改名 ${from} -> ${to}（${isAlias ? "别名" : "组名/善后"}）: ${JSON.stringify(changes.counts)}`);
			return { from: from, to: to, kind: isAlias ? "alias" : "references", rewritten: changes.counts };
		}),
	);

	// ─── GET /model/references/audit ────────────────────────────
	// 悬空引用审计：模型/别名改名前后各跑一次，确认没有引用面掉队。
	registerRoute(
		router,
		{ method: "get", path: "/model/references/audit" },
		authed(async () => {
			const state = await loadModelReferenceState(db);
			const audit = auditModelReferences(state);
			return {
				groups: [...new Set(state.groups)],
				aliases: audit.aliasKeys,
				references: audit.references,
				dangling: audit.dangling,
			};
		}),
	);
}
