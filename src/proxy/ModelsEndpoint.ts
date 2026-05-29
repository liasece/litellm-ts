/**
 * Models 端点 — 列出可用模型和查询单个模型信息
 *
 * 对应 LiteLLM Python 的 /v1/models 和 /models 路由。
 * 模型数据来源于 Router 配置中的 deployment 列表。
 */

import { get, noAuth, req } from "../core/api/decorators";
import { ApiError } from "../core/api/ApiError";
import type { Router } from "../router/Router";
import type { Request } from "express";
import type { Deployment } from "../types/router";

/** OpenAI 兼容的模型对象定义 */
interface OpenAIModel {
	/** 模型唯一标识 */
	id: string;
	/** 对象类型，固定为 "model" */
	object: "model";
	/** 创建时间（Unix 时间戳，秒） */
	created: number;
	/** 模型所属组织 */
	owned_by: string;
}

/** OpenAI 兼容的模型列表响应 */
interface ModelListResponse {
	/** 对象类型，固定为 "list" */
	object: "list";
	/** 模型数据数组 */
	data: OpenAIModel[];
}

/** 单个模型详细信息 */
interface ModelDetailResponse {
	/** 对象类型，固定为 "model" */
	object: "model";
	/** 模型唯一标识 */
	id: string;
	/** 创建时间 */
	created: number;
	/** 模型所属组织 */
	owned_by: string;
	/** 模型元信息 */
	model_info: Deployment["model_info"];
	/** 部署配置 */
	litellm_params: Deployment["litellm_params"];
}

/**
 * Models 控制器
 *
 * 提供 OpenAI 兼容的 /v1/models 端点。
 * GET /v1/models — 返回可用模型列表
 * GET /models — 同上（简写）
 * GET /v1/models/:model_id — 查询单个模型详情
 * GET /models/:model_id — 同上（简写）
 */
export class ModelsController {
	/**
	 * @param _router - LiteLLM Router 实例
	 */
	constructor(private _router: Router) {}

	/**
	 * 获取所有可用模型列表
	 * @returns OpenAI 兼容的模型列表响应
	 */
	@noAuth()
	@get("/v1/models")
	async listModels(): Promise<ModelListResponse> {
		return this._buildModelList();
	}

	/**
	 * 简写路径的模型列表
	 * @returns OpenAI 兼容的模型列表响应
	 */
	@noAuth()
	@get("/models")
	async listModelsShort(): Promise<ModelListResponse> {
		return this._buildModelList();
	}

	/**
	 * 查询单个模型详情
	 * @param req - Express 请求对象
	 * @returns 模型详细信息，404 时返回错误
	 */
	@noAuth()
	@get("/v1/models/:model_id")
	async getModel(@req() req: Request): Promise<ModelDetailResponse> {
		return this._findModel(String(req.params.model_id));
	}

	/**
	 * 简写路径的单个模型查询
	 * @param req - Express 请求对象
	 * @returns 模型详细信息
	 */
	@noAuth()
	@get("/models/:model_id")
	async getModelShort(@req() req: Request): Promise<ModelDetailResponse> {
		return this._findModel(String(req.params.model_id));
	}

	/**
	 * 构建模型列表响应
	 */
	private _buildModelList(): ModelListResponse {
		const data: OpenAIModel[] = [];

		// 从 Router 的 deployment 列表中提取唯一模型名
		const seen = new Set<string>();
		for (const dep of this._router.getDeployments?.() ?? []) {
			if (seen.has(dep.model_name)) {
				continue;
			}
			seen.add(dep.model_name);
			data.push({
				id: dep.model_name,
				object: "model",
				created: Math.floor(Date.now() / 1000),
				owned_by: dep.litellm_params.custom_llm_provider ?? dep.litellm_params.model.split("/")[0] ?? "litellm",
			});
		}

		return { object: "list", data: data };
	}

	/**
	 * 根据 model_id 查找模型详情
	 * @param modelId - 模型 ID（逻辑模型名称）
	 * @throws {ApiError} 模型不存在时抛出 404 错误
	 */
	private _findModel(modelId: string): ModelDetailResponse {
		const deployments = this._router.getDeployments?.() ?? [];

		// 允许通过完整的 model_name 或 litellm_params.model 匹配
		const dep = deployments.find((d) => d.model_name === modelId || d.litellm_params.model === modelId);

		if (!dep) {
			throw ApiError.notFound(`模型 "${modelId}" 不存在`);
		}

		return {
			object: "model",
			id: modelId,
			created: Math.floor(Date.now() / 1000),
			owned_by: dep.litellm_params.custom_llm_provider ?? dep.litellm_params.model.split("/")[0] ?? "litellm",
			model_info: dep.model_info,
			litellm_params: dep.litellm_params,
		};
	}
}
