/**
 * 模型 info 推导与 /model_group/info 聚合逻辑
 *
 * 对齐 Python LiteLLM 两条链路：
 * - /v2/model/info：`proxy_server._enrich_model_info_with_litellm_data` —
 *   config model_info 与 cost map（litellm.model_cost）推导出的 ModelInfo 合并，
 *   config 优先；响应包含 Python `ModelInfo` 全 73 键（缺省 null）。
 * - /model_group/info：`Router._set_model_group_info` + `ModelGroupInfoProxy` —
 *   按 model_name 聚合，输出 22 键（supports_*、成本、tpm/rpm、health_* 等）。
 *
 * 推导数据源：`src/data/model_prices_and_context_window.json`（对齐 Python
 * litellm.model_cost 快照）。查找顺序对齐 Python `_get_model_info_helper`：
 * 先精确匹配完整模型串（含 provider 前缀），再取最后一个 `/` 后段（split_model）。
 *
 * 注：文件内 `supports_*` 等字段沿用 Python LiteLLM snake_case 协议命名，文件级
 * 关闭 camelcase 规则以避免每行重复 eslint-disable。
 */

import { modelCostMapService, type ModelCostMap } from "../cost/ModelCostMapService";
import type { Deployment } from "../types/router";

/**
 * Python `ModelInfo`（litellm/types/utils.py ModelInfoBase + supported_openai_params）
 * 序列化后的全字段，外加 deployment 级 `id` / `db_model`，共 73 键。
 * /v2/model/info 的 model_info 必须恰好包含这些键（缺省 null）。
 */
export const MODEL_INFO_CANONICAL_KEYS: readonly string[] = [
	"key",
	"max_tokens",
	"max_input_tokens",
	"max_output_tokens",
	"input_cost_per_token",
	"input_cost_per_token_flex",
	"input_cost_per_token_priority",
	"cache_creation_input_token_cost",
	"cache_creation_input_token_cost_above_200k_tokens",
	"cache_read_input_token_cost",
	"cache_read_input_token_cost_above_200k_tokens",
	"cache_read_input_token_cost_above_272k_tokens",
	"cache_read_input_token_cost_flex",
	"cache_read_input_token_cost_priority",
	"cache_creation_input_token_cost_above_1hr",
	"input_cost_per_character",
	"input_cost_per_token_above_128k_tokens",
	"input_cost_per_token_above_200k_tokens",
	"input_cost_per_token_above_272k_tokens",
	"input_cost_per_query",
	"input_cost_per_second",
	"input_cost_per_audio_token",
	"input_cost_per_image_token",
	"input_cost_per_image",
	"input_cost_per_audio_per_second",
	"input_cost_per_video_per_second",
	"input_cost_per_token_batches",
	"output_cost_per_token_batches",
	"output_cost_per_token",
	"output_cost_per_token_flex",
	"output_cost_per_token_priority",
	"output_cost_per_audio_token",
	"output_cost_per_character",
	"output_cost_per_reasoning_token",
	"output_cost_per_token_above_128k_tokens",
	"output_cost_per_character_above_128k_tokens",
	"output_cost_per_token_above_200k_tokens",
	"output_cost_per_token_above_272k_tokens",
	"output_cost_per_second",
	"output_cost_per_video_per_second",
	"output_cost_per_image",
	"output_cost_per_image_token",
	"output_vector_size",
	"citation_cost_per_token",
	"tiered_pricing",
	"litellm_provider",
	"mode",
	"supports_system_messages",
	"supports_response_schema",
	"supports_vision",
	"supports_function_calling",
	"supports_tool_choice",
	"supports_assistant_prefill",
	"supports_prompt_caching",
	"supports_audio_input",
	"supports_audio_output",
	"supports_pdf_input",
	"supports_embedding_image_input",
	"supports_native_streaming",
	"supports_web_search",
	"supports_url_context",
	"supports_reasoning",
	"supports_computer_use",
	"search_context_cost_per_query",
	"tpm",
	"rpm",
	"ocr_cost_per_page",
	"annotation_cost_per_page",
	"provider_specific_entry",
	"uses_embed_content",
	"supported_openai_params",
	"id",
	"db_model",
];

/** /model_group/info 单元素（对齐 Python ModelGroupInfoProxy，22 键） */
export interface ModelGroupInfoItem {
	/** 模型组名称（即 model_name） */
	model_group: string;
	/** 该模型组下所有 provider 去重列表 */
	providers: string[];
	/**
	 *
	 */
	max_input_tokens: number | null;
	/**
	 *
	 */
	max_output_tokens: number | null;
	/**
	 *
	 */
	input_cost_per_token: number | null;
	/**
	 *
	 */
	output_cost_per_token: number | null;
	/**
	 *
	 */
	input_cost_per_pixel: number | null;
	/**
	 *
	 */
	mode: string | null;
	/**
	 *
	 */
	tpm: number | null;
	/**
	 *
	 */
	rpm: number | null;
	/**
	 *
	 */
	supports_parallel_function_calling: boolean;
	/**
	 *
	 */
	supports_vision: boolean;
	/**
	 *
	 */
	supports_web_search: boolean;
	/**
	 *
	 */
	supports_url_context: boolean;
	/**
	 *
	 */
	supports_reasoning: boolean;
	/**
	 *
	 */
	supports_function_calling: boolean;
	/**
	 *
	 */
	supported_openai_params: string[] | null;
	/** Python LiteLLM_Params.configurable_clientside_auth_params；TS 未实现，恒 null */
	configurable_clientside_auth_params: unknown;
	/** Python litellm.public_model_groups 标记；TS 未实现公开模型组，恒 false */
	is_public_model_group: boolean;
	/** Python 健康检查状态；TS 不在此端点注入健康数据，恒 null */
	health_status: string | null;
	/**
	 *
	 */
	health_response_time: number | null;
	/**
	 *
	 */
	health_checked_at: string | null;
}

/** 成本映射条目（JSON 原始对象） */
type ModelCostEntry = Record<string, unknown>;
export type { ModelCostEntry };

/**
 * 模型成本映射（对齐 Python `litellm.model_cost` 快照）。
 * __dirname 布局：dist/proxy → ../data（生产）；src/proxy → ../data（ts-jest）。
 */

/**
 * 在成本映射中查找模型条目。
 * 对齐 Python `_get_model_info_helper` 的查找顺序（对本场景可命中者）：
 * 1. 完整模型串精确匹配（如 "anthropic/gpt-5.6-luna"）
 * 2. 最后一个 `/` 后段匹配（Python split_model，如 "gpt-4o"）
 * @param model - litellm_params.model（可含 provider 前缀）
 * @param modelCostMap
 */
export function lookupModelCostEntry(
	model: string,
	modelCostMap: ModelCostMap = modelCostMapService.getSnapshot().map,
): ModelCostEntry | undefined {
	const exact = modelCostMap[model];
	if (exact !== undefined) {
		return exact;
	}
	const segments = model.split("/");
	const splitModel = segments[segments.length - 1];
	if (segments.length > 1 && splitModel !== undefined) {
		return modelCostMap[splitModel];
	}
	return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/**
 * Anthropic provider 基础支持参数
 * （对齐 Python AnthropicConfig.get_supported_openai_params 静态部分，
 * litellm/llms/anthropic/chat/transformation.py）。
 */
const ANTHROPIC_BASE_SUPPORTED_PARAMS: readonly string[] = [
	"stream",
	"stop",
	"temperature",
	"top_p",
	"max_tokens",
	"max_completion_tokens",
	"tools",
	"tool_choice",
	"extra_headers",
	"parallel_tool_calls",
	"response_format",
	"user",
	"web_search_options",
	"speed",
	"context_management",
	"cache_control",
];

/**
 * OpenAI provider 支持参数
 * （对齐 Python OpenAIGPTConfig.get_supported_openai_params：30 个跨模型参数
 * + response_format，litellm/llms/openai/chat/gpt_transformation.py）。
 */
const OPENAI_BASE_SUPPORTED_PARAMS: readonly string[] = [
	"frequency_penalty",
	"logit_bias",
	"logprobs",
	"top_logprobs",
	"max_tokens",
	"max_completion_tokens",
	"modalities",
	"prediction",
	"n",
	"presence_penalty",
	"seed",
	"stop",
	"stream",
	"stream_options",
	"temperature",
	"top_p",
	"tools",
	"tool_choice",
	"function_call",
	"functions",
	"max_retries",
	"extra_headers",
	"parallel_tool_calls",
	"audio",
	"web_search_options",
	"service_tier",
	"safety_identifier",
	"prompt_cache_key",
	"prompt_cache_retention",
	"store",
	"response_format",
];

/** Claude 4.6 模型名片段（对齐 Python AnthropicConfig._is_claude_4_6_model） */
const CLAUDE_4_6_NAME_FRAGMENTS: readonly string[] = [
	"opus-4-6",
	"opus_4_6",
	"opus-4.6",
	"opus_4.6",
	"sonnet-4-6",
	"sonnet_4_6",
	"sonnet-4.6",
	"sonnet_4.6",
];

/**
 * 判断 Anthropic 模型是否支持 thinking（对齐 Python：claude-3-7-sonnet 名称匹配、
 * Claude 4.6 名称匹配或 cost map supports_reasoning=true）。
 * @param model - litellm_params.model
 * @param entry - 成本映射条目（可能为空）
 */
function anthropicSupportsThinking(model: string, entry: ModelCostEntry | undefined): boolean {
	const modelLower = model.toLowerCase();
	if (modelLower.includes("claude-3-7-sonnet")) {
		return true;
	}
	if (CLAUDE_4_6_NAME_FRAGMENTS.some((fragment) => modelLower.includes(fragment))) {
		return true;
	}
	return entry?.["supports_reasoning"] === true;
}

/**
 * 推导 supported_openai_params（对齐 Python `litellm.get_supported_openai_params`）。
 * 优先取成本映射条目自带列表（Python 响应中该字段由 provider transformation 实时计算，
 * 本仓库快照对已知模型已固化计算结果）；否则按 provider 静态表推导。
 * @param provider - 模型 provider
 * @param entry - 成本映射条目（可能为空）
 * @param model - litellm_params.model
 */
export function deriveSupportedOpenaiParams(provider: string, entry: ModelCostEntry | undefined, model: string): string[] | null {
	if (isStringArray(entry?.["supported_openai_params"])) {
		return entry["supported_openai_params"];
	}
	if (provider === "anthropic") {
		const params = [...ANTHROPIC_BASE_SUPPORTED_PARAMS];
		if (anthropicSupportsThinking(model, entry)) {
			params.push("thinking", "reasoning_effort");
		}
		return params;
	}
	if (provider === "openai") {
		return [...OPENAI_BASE_SUPPORTED_PARAMS];
	}
	return null;
}

/**
 * 解析 deployment 的 provider（对齐 Python `litellm.get_llm_provider` 的核心语义）：
 * 优先 cost map 条目的 litellm_provider，其次显式 custom_llm_provider，
 * 最后取 model 串的 `/` 前缀。
 * @param dep - deployment
 * @param entry - 成本映射条目（可能为空）
 */
function resolveProvider(dep: Deployment, entry: ModelCostEntry | undefined): string {
	if (typeof entry?.["litellm_provider"] === "string") {
		return entry["litellm_provider"];
	}
	if (typeof dep.litellm_params.custom_llm_provider === "string" && dep.litellm_params.custom_llm_provider.length > 0) {
		return dep.litellm_params.custom_llm_provider;
	}
	const segments = dep.litellm_params.model.split("/");
	const providerPrefix = segments[0];
	return segments.length > 1 && providerPrefix !== undefined ? providerPrefix : "";
}

/**
 * 构造 Python 风格的 model_info（73 键，缺省 null）。
 *
 * 对齐 `_enrich_model_info_with_litellm_data`：
 * 1. 以全键 null 模板起步（Python ModelInfo pydantic 序列化会输出全部字段）
 * 2. 填入 cost map 条目推导值（key、成本、supports 能力、mode、supported_openai_params 等）
 * 3. config model_info 覆盖（Python：`if k not in model_info` —— config 优先）；
 * config 中的额外键（如 metadata）同样透传，与 Python dict 合并行为一致
 * 4. id：config model_info.id > cost map 条目 id > fallbackId（调用方生成的稳定 id）
 * 5. db_model：config 未声明时恒 false（TS 端模型均来自 config 文件）
 * @param dep - Router deployment
 * @param fallbackId - cost map 与 config 均无 id 时的兜底 id
 * @param modelCostMap
 */
export function buildEnrichedModelInfo(
	dep: Deployment,
	fallbackId: string,
	modelCostMap: ModelCostMap = modelCostMapService.getSnapshot().map,
): Record<string, unknown> {
	const entry = lookupModelCostEntry(dep.litellm_params.model, modelCostMap);
	const provider = resolveProvider(dep, entry);

	const out: Record<string, unknown> = {};
	for (const canonicalKey of MODEL_INFO_CANONICAL_KEYS) {
		out[canonicalKey] = null;
	}
	if (entry !== undefined) {
		for (const [entryKey, entryValue] of Object.entries(entry)) {
			// 仅采纳 Python ModelInfo 声明的键：pydantic 序列化会丢弃未声明字段
			// （如 cost map 中的 supports_parallel_function_calling），id/key/
			// litellm_provider/supported_openai_params 由下方显式赋值。
			if (entryKey === "id" || entryKey === "key" || entryKey === "litellm_provider" || entryKey === "supported_openai_params") {
				continue;
			}
			if (!MODEL_INFO_CANONICAL_KEYS.includes(entryKey)) {
				continue;
			}
			out[entryKey] = entryValue;
		}
	}
	out["key"] = typeof entry?.["key"] === "string" ? entry["key"] : dep.litellm_params.model;
	out["litellm_provider"] = provider;
	out["supported_openai_params"] = deriveSupportedOpenaiParams(provider, entry, dep.litellm_params.model);

	const configInfo: Record<string, unknown> = isRecord(dep.model_info) ? (dep.model_info as Record<string, unknown>) : {};
	for (const [infoKey, infoValue] of Object.entries(configInfo)) {
		if (infoValue !== undefined) {
			out[infoKey] = infoValue;
		}
	}

	out["id"] =
		typeof configInfo["id"] === "string" ? configInfo["id"] : typeof entry?.["id"] === "string" ? (entry["id"] as string) : fallbackId;
	out["db_model"] = typeof configInfo["db_model"] === "boolean" ? configInfo["db_model"] : false;
	return out;
}

/**
 * 从 enriched model_info 读取 number 字段（非 number 一律 null）
 * @param info
 * @param fieldName
 */
function pickNumberField(info: Record<string, unknown>, fieldName: string): number | null {
	const value = info[fieldName];
	return typeof value === "number" ? value : null;
}

/**
 * max-ignoring-null 聚合（对齐 Python：后续 deployment 更大则替换）
 * @param current
 * @param next
 */
function mergeMax(current: number | null, next: number | null): number | null {
	if (next === null) {
		return current;
	}
	if (current === null || next > current) {
		return next;
	}
	return current;
}

/**
 * 提取单 deployment 的 tpm/rpm（对齐 Python `_set_model_group_info` 取值顺序）：
 * deployment 顶层 > litellm_params > config model_info > cost map 条目。
 * @param dep - deployment
 * @param info - enriched model_info（cost map 值已并入）
 * @param fieldName
 */
function pickDeploymentLimit(dep: Deployment, info: Record<string, unknown>, fieldName: "tpm" | "rpm"): number | null {
	if (typeof dep[fieldName] === "number") {
		return dep[fieldName];
	}
	const paramsValue = dep.litellm_params[fieldName];
	if (typeof paramsValue === "number") {
		return paramsValue;
	}
	return pickNumberField(info, fieldName);
}

interface GroupBucket {
	readonly providers: string[];
	maxInput: number | null;
	maxOutput: number | null;
	inputCost: number | null;
	outputCost: number | null;
	mode: string | null;
	tpm: number | null;
	rpm: number | null;
	supportsParallelFunctionCalling: boolean;
	supportsVision: boolean;
	supportsWebSearch: boolean;
	supportsUrlContext: boolean;
	supportsReasoning: boolean;
	supportsFunctionCalling: boolean;
	supportedOpenaiParams: string[] | null;
}

/**
 * 以首个 deployment 的 enriched info 播种聚合桶（对齐 Python 首次构造 ModelGroupInfo）
 * @param info
 * @param provider
 */
function seedGroupBucket(info: Record<string, unknown>, provider: string): GroupBucket {
	return {
		providers: provider.length > 0 ? [provider] : [],
		maxInput: pickNumberField(info, "max_input_tokens"),
		maxOutput: pickNumberField(info, "max_output_tokens"),
		inputCost: pickNumberField(info, "input_cost_per_token"),
		outputCost: pickNumberField(info, "output_cost_per_token"),
		mode: typeof info["mode"] === "string" ? (info["mode"] as string) : null,
		tpm: null,
		rpm: null,
		supportsParallelFunctionCalling: info["supports_parallel_function_calling"] === true,
		supportsVision: info["supports_vision"] === true,
		supportsWebSearch: info["supports_web_search"] === true,
		supportsUrlContext: info["supports_url_context"] === true,
		supportsReasoning: info["supports_reasoning"] === true,
		supportsFunctionCalling: info["supports_function_calling"] === true,
		supportedOpenaiParams: isStringArray(info["supported_openai_params"]) ? info["supported_openai_params"] : null,
	};
}

/**
 * 合并后续 deployment（对齐 Python：成本/token 取 max，supports_* 取 OR，params 后者覆盖）
 * @param bucket
 * @param info
 * @param provider
 */
function mergeDeploymentIntoBucket(bucket: GroupBucket, info: Record<string, unknown>, provider: string): void {
	if (provider.length > 0 && !bucket.providers.includes(provider)) {
		bucket.providers.push(provider);
	}
	bucket.maxInput = mergeMax(bucket.maxInput, pickNumberField(info, "max_input_tokens"));
	bucket.maxOutput = mergeMax(bucket.maxOutput, pickNumberField(info, "max_output_tokens"));
	bucket.inputCost = mergeMax(bucket.inputCost, pickNumberField(info, "input_cost_per_token"));
	bucket.outputCost = mergeMax(bucket.outputCost, pickNumberField(info, "output_cost_per_token"));
	if (info["supports_parallel_function_calling"] === true) {
		bucket.supportsParallelFunctionCalling = true;
	}
	if (info["supports_vision"] === true) {
		bucket.supportsVision = true;
	}
	if (info["supports_web_search"] === true) {
		bucket.supportsWebSearch = true;
	}
	if (info["supports_url_context"] === true) {
		bucket.supportsUrlContext = true;
	}
	if (info["supports_reasoning"] === true) {
		bucket.supportsReasoning = true;
	}
	if (info["supports_function_calling"] === true) {
		bucket.supportsFunctionCalling = true;
	}
	if (isStringArray(info["supported_openai_params"])) {
		bucket.supportedOpenaiParams = info["supported_openai_params"];
	}
}

/**
 * null 安全的限额累加（对齐 Python total_tpm/total_rpm 语义：全部为空则保持 null）
 * @param total
 * @param value
 */
function addLimit(total: number | null, value: number | null): number | null {
	if (value === null) {
		return total;
	}
	return (total ?? 0) + value;
}

/**
 * 把 deployments 数组按 model_name 聚合成 Python `/model_group/info` 形状（22 键）。
 * @param deployments - Router 全部 deployment
 * @param modelCostMap
 */
export function buildModelGroupInfoResponse(
	deployments: Deployment[],
	modelCostMap: ModelCostMap = modelCostMapService.getSnapshot().map,
): { data: ModelGroupInfoItem[] } {
	const groups = new Map<string, GroupBucket>();
	for (const dep of deployments) {
		const info = buildEnrichedModelInfo(dep, "", modelCostMap);
		const provider = typeof info["litellm_provider"] === "string" ? (info["litellm_provider"] as string) : "";
		let groupBucket = groups.get(dep.model_name);
		if (!groupBucket) {
			groupBucket = seedGroupBucket(info, provider);
			groups.set(dep.model_name, groupBucket);
		} else {
			mergeDeploymentIntoBucket(groupBucket, info, provider);
		}
		groupBucket.tpm = addLimit(groupBucket.tpm, pickDeploymentLimit(dep, info, "tpm"));
		groupBucket.rpm = addLimit(groupBucket.rpm, pickDeploymentLimit(dep, info, "rpm"));
	}

	const data: ModelGroupInfoItem[] = [];
	for (const [groupName, groupBucket] of groups) {
		data.push({
			model_group: groupName,
			providers: groupBucket.providers,
			max_input_tokens: groupBucket.maxInput,
			max_output_tokens: groupBucket.maxOutput,
			input_cost_per_token: groupBucket.inputCost,
			output_cost_per_token: groupBucket.outputCost,
			input_cost_per_pixel: null,
			mode: groupBucket.mode,
			tpm: groupBucket.tpm,
			rpm: groupBucket.rpm,
			supports_parallel_function_calling: groupBucket.supportsParallelFunctionCalling,
			supports_vision: groupBucket.supportsVision,
			supports_web_search: groupBucket.supportsWebSearch,
			supports_url_context: groupBucket.supportsUrlContext,
			supports_reasoning: groupBucket.supportsReasoning,
			supports_function_calling: groupBucket.supportsFunctionCalling,
			supported_openai_params: groupBucket.supportedOpenaiParams,
			configurable_clientside_auth_params: null,
			is_public_model_group: false,
			health_status: null,
			health_response_time: null,
			health_checked_at: null,
		});
	}

	return { data: data };
}
