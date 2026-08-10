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
import { sanitizeSensitiveValues } from "../core/api/sanitizeSensitiveValues";
import { dbConfigProvider } from "../core/config/DbConfigProvider";
import {
	BUILTIN_CAPABILITIES_CONFIG_PARAM,
	normalizeBuiltinCapabilitiesConfig,
	type BuiltinCapabilitiesConfig,
} from "../capabilities/BuiltinCapabilitiesConfig";
import { buildEnrichedModelInfo } from "./modelGroupBuilder";
import codexModelDefaults from "../data/codex_model_defaults.json";

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
	/** Effective input modalities available through this LiteLLM model. */
	input_modalities: Array<"text" | "image">;
	/** Whether image input is accepted natively or through built-in vision. */
	supports_vision: boolean;
}

/** OpenAI 兼容的模型列表响应 */
interface ModelListResponse {
	/** 对象类型，固定为 "list" */
	object: "list";
	/** 模型数据数组 */
	data: OpenAIModel[];
	/** Codex remote model-catalog shape, emitted alongside the OpenAI-compatible list. */
	models: CodexModelInfo[];
}

/** Rich model metadata consumed by Codex's remote `/models` catalog. */
interface CodexModelInfo {
	slug: string;
	display_name: string;
	description: string | null;
	supported_reasoning_levels: Array<{ effort: string; description: string }>;
	shell_type: "default";
	visibility: "list";
	supported_in_api: boolean;
	priority: number;
	additional_speed_tiers: string[];
	service_tiers: Array<{ id: string; name: string; description: string }>;
	availability_nux: null;
	upgrade: null;
	base_instructions: string;
	include_skills_usage_instructions: boolean;
	include_plugin_usage_instructions: boolean;
	include_apps_usage_instructions: boolean;
	supports_reasoning_summary_parameter: boolean;
	default_reasoning_summary: "none";
	support_verbosity: boolean;
	default_verbosity: null;
	apply_patch_tool_type: null;
	web_search_tool_type: "text";
	truncation_policy: { mode: "tokens"; limit: number };
	supports_parallel_tool_calls: boolean;
	supports_image_detail_original: boolean;
	context_window: number | null;
	max_context_window: number | null;
	effective_context_window_percent: number;
	experimental_supported_tools: string[];
	input_modalities: Array<"text" | "image">;
	supports_search_tool: boolean;
	use_responses_lite: boolean;
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
	private async _buildModelList(): Promise<ModelListResponse> {
		const data: OpenAIModel[] = [];
		const models: CodexModelInfo[] = [];
		const builtinCapabilities = await this._loadBuiltinCapabilities();
		const deployments = this._router.getDeployments?.() ?? [];
		const deploymentsByModel = new Map<string, Deployment[]>();
		for (const deployment of deployments) {
			const group = deploymentsByModel.get(deployment.model_name);
			if (group) {
				group.push(deployment);
			} else {
				deploymentsByModel.set(deployment.model_name, [deployment]);
			}
		}

		// 从 Router 的 deployment 列表中提取唯一模型名
		for (const [modelName, group] of deploymentsByModel) {
			const dep = group[0]!;
			const enrichedGroup = group.map((candidate) => this._enrichedModelInfo(candidate, builtinCapabilities));
			const supportsVision = enrichedGroup.some((info) => info["supports_vision"] === true);
			const inputModalities: Array<"text" | "image"> = supportsVision ? ["text", "image"] : ["text"];
			data.push({
				id: modelName,
				object: "model",
				created: Math.floor(Date.now() / 1000),
				owned_by: dep.litellm_params.custom_llm_provider ?? dep.litellm_params.model.split("/")[0] ?? "litellm",
				input_modalities: inputModalities,
				supports_vision: supportsVision,
			});
			models.push(this._buildCodexModelInfo(modelName, enrichedGroup, inputModalities, models.length));
		}

		return { object: "list", data: data, models: models };
	}

	/**
	 * 根据 model_id 查找模型详情
	 * @param modelId - 模型 ID（逻辑模型名称）
	 * @throws {ApiError} 模型不存在时抛出 404 错误
	 */
	private async _findModel(modelId: string): Promise<ModelDetailResponse> {
		const deployments = this._router.getDeployments?.() ?? [];
		const builtinCapabilities = await this._loadBuiltinCapabilities();

		// 允许通过完整的 model_name 或 litellm_params.model 匹配
		const dep = deployments.find((d) => d.model_name === modelId || d.litellm_params.model === modelId);

		if (!dep) {
			throw ApiError.notFound(`模型 "${modelId}" 不存在`);
		}

		const matchingDeployments = deployments.filter(
			(candidate) => candidate.model_name === dep.model_name || candidate.litellm_params.model === modelId,
		);
		const supportsVision = matchingDeployments.some((candidate) => this._supportsVision(candidate, builtinCapabilities));
		const publicModelInfo = sanitizeSensitiveValues(dep.model_info) as Deployment["model_info"];

		return {
			object: "model",
			id: modelId,
			created: Math.floor(Date.now() / 1000),
			owned_by: dep.litellm_params.custom_llm_provider ?? dep.litellm_params.model.split("/")[0] ?? "litellm",
			model_info: { ...publicModelInfo, supports_vision: supportsVision },
			litellm_params: sanitizeSensitiveValues(dep.litellm_params) as Deployment["litellm_params"],
		};
	}

	private async _loadBuiltinCapabilities(): Promise<BuiltinCapabilitiesConfig> {
		return normalizeBuiltinCapabilitiesConfig(await dbConfigProvider.getParam(BUILTIN_CAPABILITIES_CONFIG_PARAM));
	}

	private _supportsVision(dep: Deployment, builtinCapabilities: BuiltinCapabilitiesConfig): boolean {
		return this._enrichedModelInfo(dep, builtinCapabilities)["supports_vision"] === true;
	}

	private _enrichedModelInfo(dep: Deployment, builtinCapabilities: BuiltinCapabilitiesConfig): Record<string, unknown> {
		return buildEnrichedModelInfo(dep, "", undefined, builtinCapabilities);
	}

	private _buildCodexModelInfo(
		modelName: string,
		enrichedGroup: Record<string, unknown>[],
		inputModalities: Array<"text" | "image">,
		priority: number,
	): CodexModelInfo {
		const contextWindows = enrichedGroup
			.map((info) => info["max_input_tokens"])
			.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
		const contextWindow = contextWindows.length > 0 ? Math.max(...contextWindows) : null;
		return {
			slug: modelName,
			display_name: modelName,
			description: `LiteLLM logical model ${modelName}`,
			supported_reasoning_levels: [],
			shell_type: "default",
			visibility: "list",
			supported_in_api: true,
			priority: priority,
			additional_speed_tiers: [],
			service_tiers: [],
			availability_nux: null,
			upgrade: null,
			base_instructions: codexModelDefaults.base_instructions,
			include_skills_usage_instructions: false,
			include_plugin_usage_instructions: false,
			include_apps_usage_instructions: false,
			supports_reasoning_summary_parameter: false,
			default_reasoning_summary: "none",
			support_verbosity: false,
			default_verbosity: null,
			apply_patch_tool_type: null,
			web_search_tool_type: "text",
			truncation_policy: { mode: "tokens", limit: 10_000 },
			supports_parallel_tool_calls: enrichedGroup.some(
				(info) => info["supports_parallel_function_calling"] === true,
			),
			supports_image_detail_original: false,
			context_window: contextWindow,
			max_context_window: contextWindow,
			effective_context_window_percent: 95,
			experimental_supported_tools: [],
			input_modalities: inputModalities,
			supports_search_tool: false,
			use_responses_lite: false,
		};
	}
}
