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
import { canAuthAccessModel } from "../auth/AuthChecks";
import { claudeCodeModelId, isClaudeCodeClient } from "./CodingClientModels";
import codexModelDefaults from "../data/codex_model_defaults.json";

/** OpenAI 兼容的模型对象定义 */
interface OpenAIModel {
	/** 模型唯一标识 */
	id: string;
	/** 对象类型，固定为 "model" */
	object: "model";
	/** 模型创建时间（Unix 时间戳，秒）；配置未提供时取进程启动时间 */
	created: number;
	/** 模型所属组织 */
	owned_by: string;
	/** 官方 OpenAI Model 的可选下线日期；没有公告时为 null。 */
	shutdown_date: string | null;
	/** 兼容扩展：最大输入 token 数；配置或成本表未提供时为 null。 */
	context_window: number | null;
	/** 兼容扩展：最大输出 token 数；配置或成本表未提供时为 null。 */
	max_output_tokens: number | null;
	/** Effective input modalities available through this LiteLLM model. */
	input_modalities: Array<"text" | "image">;
	/** Whether image input is accepted natively or through built-in vision. */
	supports_vision: boolean;
}

/** OpenAI 兼容的模型列表响应 */
interface OpenAIModelListResponse {
	/** 对象类型，固定为 "list" */
	object: "list";
	/** 模型数据数组 */
	data: OpenAIModel[];
	/** Codex remote model-catalog shape, emitted alongside the OpenAI-compatible list. */
	models: CodexModelInfo[];
}

interface AnthropicModelListResponse {
	data: Array<{ id: string; type: "model"; display_name: string; created_at: string }>;
	has_more: boolean;
	first_id: string | null;
	last_id: string | null;
}
type ModelListResponse = OpenAIModelListResponse | AnthropicModelListResponse;

/** Rich model metadata consumed by Codex's remote `/models` catalog. */
interface CodexModelInfo {
	slug: string;
	display_name: string;
	description: string | null;
	supported_reasoning_levels: Array<{ effort: string; description: string }>;
	shell_type: "unified_exec";
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
	truncation_policy: { mode: "bytes"; limit: number };
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
	/** 模型创建时间（Unix 时间戳，秒） */
	created: number;
	/** 模型所属组织 */
	owned_by: string;
	/** 官方 OpenAI Model 的可选下线日期；没有公告时为 null。 */
	shutdown_date: string | null;
	/** 兼容扩展：最大输入 token 数；未配置时为 null。 */
	context_window: number | null;
	/** 兼容扩展：最大输出 token 数；未配置时为 null。 */
	max_output_tokens: number | null;
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
	/** created 的稳定兜底值：进程启动时间，避免同一模型每次请求返回不同时间戳。 */
	private readonly _fallbackCreated: number;

	/**
	 * @param _router - LiteLLM Router 实例
	 */
	constructor(private _router: Router) {
		this._fallbackCreated = Math.floor(Date.now() / 1000);
	}

	/**
	 * 获取所有可用模型列表
	 * @returns OpenAI 兼容的模型列表响应
	 */
	listModels(): Promise<OpenAIModelListResponse>;

	/**
	 *
	 */
	listModels(request: Request): Promise<ModelListResponse>;

	/**
	 * @param request
	 */
	@noAuth()
	@get("/v1/models")
	async listModels(@req() request?: Request): Promise<ModelListResponse> {
		return this._buildModelList(request);
	}

	/**
	 * 简写路径的模型列表
	 * @returns OpenAI 兼容的模型列表响应
	 */
	listModelsShort(): Promise<OpenAIModelListResponse>;

	/**
	 *
	 */
	listModelsShort(request: Request): Promise<ModelListResponse>;

	/**
	 * @param request
	 */
	@noAuth()
	@get("/models")
	async listModelsShort(@req() request?: Request): Promise<ModelListResponse> {
		return this._buildModelList(request);
	}

	/**
	 * 查询单个模型详情
	 * @param req - Express 请求对象
	 * @returns 模型详细信息，404 时返回错误
	 */
	@noAuth()
	@get("/v1/models/:model_id")
	async getModel(@req() req: Request): Promise<ModelDetailResponse> {
		return this._findModel(String(req.params.model_id), req);
	}

	/**
	 * 简写路径的单个模型查询
	 * @param req - Express 请求对象
	 * @returns 模型详细信息
	 */
	@noAuth()
	@get("/models/:model_id")
	async getModelShort(@req() req: Request): Promise<ModelDetailResponse> {
		return this._findModel(String(req.params.model_id), req);
	}

	/**
	 * 构建模型列表响应
	 * @param request
	 */
	private async _buildModelList(request?: Request): Promise<ModelListResponse> {
		const data: OpenAIModel[] = [];
		const models: CodexModelInfo[] = [];
		const builtinCapabilities = await this._loadBuiltinCapabilities();
		const deployments = this._router.getDeployments?.() ?? [];
		const deploymentsByModel = new Map<string, Deployment[]>();
		for (const deployment of deployments) {
			if (
				deployment.model_info?.["discoverable"] === false ||
				(request?.auth && !canAuthAccessModel(request.auth, deployment.model_name))
			) {
				continue;
			}
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
				created: this._createdAt(dep),
				owned_by: this._ownedBy(dep),
				shutdown_date: this._shutdownDate(dep),
				context_window: this._maxNumericField(enrichedGroup, ["max_input_tokens", "context_window", "context_length"]),
				max_output_tokens: this._maxNumericField(enrichedGroup, ["max_output_tokens", "max_completion_tokens"]),
				input_modalities: inputModalities,
				supports_vision: supportsVision,
			});
			models.push(this._buildCodexModelInfo(modelName, enrichedGroup, inputModalities, models.length));
		}

		if (request?.get?.("anthropic-version") || isClaudeCodeClient(request)) {
			const listing = data.map((model) => ({
				id: isClaudeCodeClient(request) ? claudeCodeModelId(model.id) : model.id,
				type: "model" as const,
				display_name: models.find((entry) => entry.slug === model.id)?.display_name ?? model.id,
				created_at: new Date(model.created * 1000).toISOString(),
			}));
			// Decorator handlers serialize both negotiated protocol shapes directly.
			return { data: listing, has_more: false, first_id: listing[0]?.id ?? null, last_id: listing.at(-1)?.id ?? null };
		}
		return { object: "list", data: data, models: models };
	}

	/**
	 * 根据 model_id 查找模型详情
	 * @param modelId - 模型 ID（逻辑模型名称）
	 * @param request
	 * @throws {ApiError} 模型不存在时抛出 404 错误
	 */
	private async _findModel(modelId: string, request?: Request): Promise<ModelDetailResponse> {
		const deployments = this._router.getDeployments?.() ?? [];
		const builtinCapabilities = await this._loadBuiltinCapabilities();

		// 允许通过完整的 model_name 或 litellm_params.model 匹配
		const dep = deployments.find((d) => d.model_name === modelId || d.litellm_params.model === modelId);

		if (!dep || (request?.auth && !canAuthAccessModel(request.auth, dep.model_name))) {
			throw ApiError.notFound(`模型 "${modelId}" 不存在`);
		}

		const matchingDeployments = deployments.filter(
			(candidate) => candidate.model_name === dep.model_name || candidate.litellm_params.model === modelId,
		);
		const enrichedGroup = matchingDeployments.map((candidate) => this._enrichedModelInfo(candidate, builtinCapabilities));
		const supportsVision = enrichedGroup.some((info) => info["supports_vision"] === true);
		const publicModelInfo = sanitizeSensitiveValues(dep.model_info) as Deployment["model_info"];

		return {
			object: "model",
			id: modelId,
			created: this._createdAt(dep),
			owned_by: this._ownedBy(dep),
			shutdown_date: this._shutdownDate(dep),
			context_window: this._maxNumericField(enrichedGroup, ["max_input_tokens", "context_window", "context_length"]),
			max_output_tokens: this._maxNumericField(enrichedGroup, ["max_output_tokens", "max_completion_tokens"]),
			model_info: { ...publicModelInfo, supports_vision: supportsVision },
			litellm_params: sanitizeSensitiveValues(dep.litellm_params) as Deployment["litellm_params"],
		};
	}

	private async _loadBuiltinCapabilities(): Promise<BuiltinCapabilitiesConfig> {
		return normalizeBuiltinCapabilitiesConfig(await dbConfigProvider.getParam(BUILTIN_CAPABILITIES_CONFIG_PARAM));
	}

	private _enrichedModelInfo(dep: Deployment, builtinCapabilities: BuiltinCapabilitiesConfig): Record<string, unknown> {
		return buildEnrichedModelInfo(dep, "", undefined, builtinCapabilities);
	}

	/**
	 * OpenAI `owned_by`：优先部署的 custom_llm_provider，否则取模型前缀。
	 * @param dep - 部署
	 */
	private _ownedBy(dep: Deployment): string {
		return dep.litellm_params.custom_llm_provider ?? dep.litellm_params.model.split("/")[0] ?? "litellm";
	}

	/**
	 * 模型创建时间：读取配置的 created/created_at，缺省用进程启动时间，保证同一模型稳定。
	 * @param dep - 部署
	 */
	private _createdAt(dep: Deployment): number {
		const info = dep.model_info as Record<string, unknown> | undefined;
		const raw = info?.["created"] ?? info?.["created_at"];
		if (typeof raw === "number" && Number.isFinite(raw)) {
			return Math.floor(raw);
		}
		if (typeof raw === "string") {
			const parsed = Date.parse(raw);
			if (Number.isFinite(parsed)) {
				return Math.floor(parsed / 1000);
			}
		}
		return this._fallbackCreated;
	}

	/**
	 * 官方 OpenAI Model 的可选 shutdown_date；未配置时显式返回 null。
	 * @param dep - 部署
	 */
	private _shutdownDate(dep: Deployment): string | null {
		const raw = (dep.model_info as Record<string, unknown> | undefined)?.["shutdown_date"];
		return typeof raw === "string" && raw.trim().length > 0 ? raw : null;
	}

	/**
	 * 合并同组 deployment 的数值容量字段，取最大值；非正数和非数字忽略。
	 * @param group - 同组 enriched model_info
	 * @param keys - 候选字段名，按优先级排列
	 */
	private _maxNumericField(group: Record<string, unknown>[], keys: readonly string[]): number | null {
		let max: number | null = null;
		for (const info of group) {
			for (const key of keys) {
				const value = info[key];
				if (typeof value === "number" && Number.isFinite(value) && value > 0) {
					max = max === null ? value : Math.max(max, value);
				}
			}
		}
		return max;
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
		const info = enrichedGroup[0] ?? {};
		const tiers = Array.isArray(info["service_tiers"]) ? info["service_tiers"] : [];
		const serviceTiers = tiers.flatMap((tier: unknown) => {
			if (typeof tier === "string") {
				return [{ id: tier, name: tier, description: "" }];
			}
			if (typeof tier !== "object" || tier === null || typeof (tier as Record<string, unknown>)["id"] !== "string") {
				return [];
			}
			const row = tier as Record<string, unknown>;
			return [
				{
					id: row["id"] as string,
					name: typeof row["name"] === "string" ? row["name"] : (row["id"] as string),
					description: typeof row["description"] === "string" ? row["description"] : "",
				},
			];
		});
		return {
			slug: modelName,
			display_name: typeof info["display_name"] === "string" ? info["display_name"] : modelName,
			description: `LiteLLM logical model ${modelName}`,
			supported_reasoning_levels: Array.isArray(info["supported_reasoning_levels"])
				? (info["supported_reasoning_levels"] as Array<{ effort: string; description: string }>)
				: ["low", "medium", "high", "xhigh", "max"]
						.filter(
							(effort) =>
								info[`supports_${effort}_reasoning_effort`] === true ||
								(info["supports_reasoning"] === true && ["low", "medium", "high"].includes(effort)),
						)
						.map((effort) => ({ effort: effort, description: effort })),
			shell_type: "unified_exec",
			visibility: "list",
			supported_in_api: true,
			priority: priority,
			additional_speed_tiers: [],
			service_tiers: serviceTiers,
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
			truncation_policy: { mode: "bytes", limit: 10_000 },
			supports_parallel_tool_calls: enrichedGroup.some((info) => info["supports_parallel_function_calling"] === true),
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
