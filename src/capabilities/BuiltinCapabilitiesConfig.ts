/**
 * 内置能力执行链配置模型。
 *
 * 每个内置能力的执行者是一条**有序的、带类型的链**：链上每个元素要么是一个可
 * 路由的 LiteLLM 模型（`type: "model"`），要么是一个直连 HTTP 客户端
 * （目前为 DeepSeek 公开的 Search / Fetch 接口，`type: "deepseek_tools"`）。
 *
 * 不同类型携带各自的参数：
 * - model 元素可选 timeout / 最大输出 token；
 * - deepseek_tools 元素可选 api_base、凭据名（`credential_name`）、超时、
 *   搜索结果条数、是否附带正文、本地化提示。
 *
 * 兼容性约束：历史配置只有 `handler_model` + `fallback_models: string[]`。
 * 归一化时若存在这两项而缺少 `executors`，会自动折算为等价的 model 执行链，
 * 因此旧配置的语义、校验与运行行为完全不变，也不会隐式启用任何直连客户端。
 */
import type { Deployment } from "../types/router";

/** Database config row used by the built-in capability manager. */
export const BUILTIN_CAPABILITIES_CONFIG_PARAM = "builtin_capabilities";

/** 内置能力执行链中允许的元素类型。 */
export type BuiltinCapabilityExecutorType = "model" | "deepseek_tools";

/** 可执行的内置能力 ID。 */
export type BuiltinCapabilityId = "vision" | "image_generation" | "web";

/** 一个可路由模型执行者。 */
export interface BuiltinCapabilityModelExecutor {
	/** 判别键：交给 LiteLLM Router 执行。 */
	readonly type: "model";
	/** 逻辑模型名（model group 或 alias）。 */
	readonly model: string;
	/** 本次调用的最大输出 token；未给出时使用能力级默认值。 */
	readonly max_output_tokens?: number;
}

/** DeepSeek 直连 Search / Fetch 执行者。 */
export interface BuiltinCapabilityDeepSeekToolsExecutor {
	/** 判别键：直接调用 DeepSeek 公开工具接口。 */
	readonly type: "deepseek_tools";
	/** 上游基址；缺省为官方地址。 */
	readonly api_base: string;
	/** 保存 DeepSeek API key 的命名 Credential；唯一允许的密钥来源。 */
	readonly credential_name: string;
	/** 单次请求超时时间（毫秒）。 */
	readonly timeout_ms: number;
	/** 单次搜索请求的结果条数。 */
	readonly search_count: number;
	/** 搜索时是否要求上游返回完整正文。 */
	readonly search_need_content: boolean;
	/** 搜索本地化提示；空字符串表示不传。 */
	readonly localization: string;
}

/** 执行链上的一个元素。 */
export type BuiltinCapabilityExecutor = BuiltinCapabilityModelExecutor | BuiltinCapabilityDeepSeekToolsExecutor;

/** Settings shared by capability executors and the WebUI manager. */
export interface BuiltinCapabilitySettings {
	/** Global switch. Disabled capabilities are never injected. */
	enabled: boolean;
	/** Inject the capability even when the current request has no matching payload yet. */
	always_inject: boolean;
	/** 主执行者：链上第一个元素的模型名；直连执行者没有模型名时为空。 */
	handler_model: string;
	/** 有序执行链；链上元素按顺序尝试，失败后继续下一个。 */
	executors: BuiltinCapabilityExecutor[];
	/** Maximum number of private agent turns per client request. */
	max_iterations: number;
	/** Maximum output tokens for each capability worker call. */
	max_output_tokens: number;
}

/** Currently implemented built-in capabilities. */
export interface BuiltinCapabilitiesConfig {
	/** Private image-inspection capability. */
	vision: BuiltinCapabilitySettings;
	/** Private image creation and editing capability. */
	image_generation: BuiltinCapabilitySettings;
	/** Private web-search and webpage-fetch capability. */
	web: BuiltinCapabilitySettings;
}

/** DeepSeek 直连执行者的默认上游基址。 */
export const DEFAULT_DEEPSEEK_TOOLS_API_BASE = "https://api.deepseek.com";

/** 单次搜索默认结果条数。 */
const DEFAULT_DEEPSEEK_SEARCH_COUNT = 10;

/** 单次请求默认超时时间（毫秒）。 */
const DEFAULT_DEEPSEEK_TIMEOUT_MS = 15_000;

/**
 * 每种能力单次客户端请求允许的私有轮次上限。
 *
 * 一轮 = 一次主模型调用（其中可能发起私有工具调用）。上限随执行器可靠性提高而上调：
 * 4 轮时复杂调研任务经常在拿到证据前就耗尽预算（生产表现为 503「网络处理超过 4 轮仍未完成」），
 * 因此放到 20 轮，让主模型自行按需分配。上限只是护栏，实际轮次仍由主模型决定。
 */
export const MAX_BUILTIN_CAPABILITY_ITERATIONS = 20;

/** Safe defaults shown before an administrator configures the capability. */
export const DEFAULT_BUILTIN_CAPABILITIES_CONFIG: BuiltinCapabilitiesConfig = {
	vision: {
		enabled: false,
		always_inject: false,
		handler_model: "",
		executors: [],
		max_iterations: 4,
		max_output_tokens: 32_768,
	},
	image_generation: {
		enabled: false,
		always_inject: true,
		handler_model: "",
		executors: [],
		max_iterations: 4,
		max_output_tokens: 32_768,
	},
	web: {
		enabled: false,
		always_inject: true,
		handler_model: "",
		executors: [],
		max_iterations: 4,
		max_output_tokens: 32_768,
	},
};

function integer(value: unknown, fallback: number, min: number, max: number): number {
	return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.trunc(value))) : fallback;
}

function integerAtLeast(value: unknown, fallback: number, min: number): number {
	return typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.trunc(value)) : fallback;
}

function isRecordObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function trimmedString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

/**
 * 归一化一个执行链元素；无法识别的元素返回 undefined 并被丢弃。
 *
 * 丢弃而不是抛错是刻意的：能力配置在请求路径上读取，历史或人工编辑过的
 * 脏数据不应把整个能力打成不可用。
 * @param value - 持久化 JSON 中的单个元素
 * @param capability - 所属能力，用于限制合法类型
 */
function normalizeExecutor(value: unknown, capability: BuiltinCapabilityId): BuiltinCapabilityExecutor | undefined {
	if (!isRecordObject(value)) {
		return undefined;
	}
	const type = trimmedString(value["type"]);
	if (type === "model") {
		const model = trimmedString(value["model"]);
		if (model.length === 0) {
			return undefined;
		}
		const maxOutputTokens = value["max_output_tokens"];
		return {
			type: "model",
			model: model,
			...(typeof maxOutputTokens === "number" && Number.isFinite(maxOutputTokens)
				? { max_output_tokens: integerAtLeast(maxOutputTokens, 128, 128) }
				: {}),
		};
	}
	// 直连工具客户端只服务于 web capability；其他能力不会静默接受它。
	if (type === "deepseek_tools" && capability === "web") {
		const apiBase = trimmedString(value["api_base"]);
		const credentialName = trimmedString(value["credential_name"]);
		if (credentialName.length === 0) {
			return undefined;
		}
		return {
			type: "deepseek_tools",
			api_base: apiBase.length > 0 ? apiBase : DEFAULT_DEEPSEEK_TOOLS_API_BASE,
			credential_name: credentialName,
			timeout_ms: integer(value["timeout_ms"], DEFAULT_DEEPSEEK_TIMEOUT_MS, 1_000, 120_000),
			search_count: integer(value["search_count"], DEFAULT_DEEPSEEK_SEARCH_COUNT, 1, 50),
			search_need_content: value["search_need_content"] === true,
			localization: trimmedString(value["localization"]),
		};
	}
	return undefined;
}

/**
 * 把历史的 `handler_model` + `fallback_models` 折算成等价的 model 执行链。
 * @param handlerModel - 历史主执行模型
 * @param fallbackModels - 历史回退模型列表
 */
function legacyExecutors(handlerModel: string, fallbackModels: string[]): BuiltinCapabilityExecutor[] {
	const models = [...new Set([handlerModel, ...fallbackModels].map((model) => model.trim()).filter(Boolean))];
	return models.map((model) => ({ type: "model", model: model }));
}

/**
 * Normalize persisted JSON without silently enabling an incomplete capability.
 * @param value - 数据库或 YAML 中的 `builtin_capabilities` 原始值
 */
export function normalizeBuiltinCapabilitiesConfig(value: Record<string, unknown>): BuiltinCapabilitiesConfig {
	const rawVision = isRecordObject(value["vision"]) ? value["vision"] : {};
	const rawWeb = isRecordObject(value["web"]) ? value["web"] : {};
	const rawImageGeneration = isRecordObject(value["image_generation"]) ? value["image_generation"] : {};
	const normalizeSettings = (
		capability: BuiltinCapabilityId,
		raw: Record<string, unknown>,
		defaults: BuiltinCapabilitySettings,
	): BuiltinCapabilitySettings => {
		const handlerModel = trimmedString(raw["handler_model"]);
		const legacyFallbacks = Array.isArray(raw["fallback_models"])
			? [
					...new Set(
						raw["fallback_models"]
							.filter((model): model is string => typeof model === "string")
							.map((model) => model.trim())
							.filter(Boolean),
					),
				]
			: [];
		const rawExecutors = raw["executors"];
		let executors: BuiltinCapabilityExecutor[];
		if (Array.isArray(rawExecutors)) {
			const seen = new Set<string>();
			executors = [];
			for (const candidate of rawExecutors) {
				const executor = normalizeExecutor(candidate, capability);
				if (executor === undefined) {
					continue;
				}
				const identity = executor.type === "model" ? `model:${executor.model}` : `deepseek_tools:${executor.credential_name}`;
				if (seen.has(identity)) {
					continue;
				}
				seen.add(identity);
				executors.push(executor);
			}
		} else {
			executors = legacyExecutors(handlerModel, legacyFallbacks);
		}
		const primaryModel = executors.find((executor): executor is BuiltinCapabilityModelExecutor => executor.type === "model");
		return {
			enabled: raw["enabled"] === true,
			always_inject: typeof raw["always_inject"] === "boolean" ? raw["always_inject"] : defaults.always_inject,
			// handler_model 保持为「主模型执行者」的投影，供模型发现与历史读取路径使用。
			handler_model: primaryModel?.model ?? handlerModel,
			executors: executors,
			max_iterations: integer(raw["max_iterations"], defaults.max_iterations, 1, MAX_BUILTIN_CAPABILITY_ITERATIONS),
			max_output_tokens: integerAtLeast(raw["max_output_tokens"], defaults.max_output_tokens, 128),
		};
	};
	return {
		vision: normalizeSettings("vision", rawVision, DEFAULT_BUILTIN_CAPABILITIES_CONFIG.vision),
		image_generation: normalizeSettings("image_generation", rawImageGeneration, DEFAULT_BUILTIN_CAPABILITIES_CONFIG.image_generation),
		web: normalizeSettings("web", rawWeb, DEFAULT_BUILTIN_CAPABILITIES_CONFIG.web),
	};
}

/**
 * 执行链里第一个模型执行者；没有模型执行者时返回 undefined。
 * @param settings - 归一化后的能力配置
 */
export function primaryModelExecutor(settings: BuiltinCapabilitySettings): BuiltinCapabilityModelExecutor | undefined {
	return settings.executors.find((executor): executor is BuiltinCapabilityModelExecutor => executor.type === "model");
}

/**
 * 执行链里所有模型执行者的模型名（按顺序去重）。
 * @param settings - 归一化后的能力配置
 */
export function modelsFromExecutors(settings: BuiltinCapabilitySettings): string[] {
	const models = settings.executors.flatMap((executor) => (executor.type === "model" ? [executor.model] : []));
	return [...new Set(models)];
}

/**
 * Whether a deployment can actually execute the selected built-in capability.
 * This is deliberately stricter than checking the model binding alone so model
 * discovery never advertises a capability that the request path would reject.
 * @param deployment - Router deployment exposed through model discovery
 * @param capability - Built-in capability identifier
 * @param config - Normalized global capability settings
 */
export function isBuiltinCapabilityAvailable(
	deployment: Deployment,
	capability: BuiltinCapabilityId,
	config: BuiltinCapabilitiesConfig,
): boolean {
	const settings = config[capability];
	return (
		settings.enabled &&
		settings.executors.length > 0 &&
		deployment.model_info?.enabled_builtin_capabilities?.includes(capability) === true &&
		deployment.model_info?.supports_function_calling !== false
	);
}
