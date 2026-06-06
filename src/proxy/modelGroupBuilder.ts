/**
 * /model_group/info 聚合逻辑
 *
 * 从 `ModelsPageSupportEndpoints.ts` 拆出：把"按 model_name 聚合 deployments
 * 得到 ModelGroupInfoItem 数组"的纯函数独立出来，便于单独测试和复用。
 * 保持与原实现完全等价（不改变 WebUI 消费契约）。
 *
 * 注：文件内 `supports_*` 字段沿用 Python LiteLLM snake_case 协议命名，文件级
 * 关闭 camelcase 规则以避免每行重复 eslint-disable。
 */

import type { Deployment } from "../types/router";
import type { ModelInfo } from "../types/config";

/** ModelInfo 中所有 supports_* 布尔能力字段，驱动聚合与输出。 */
export type SupportsFlag = Extract<keyof ModelInfo, `supports_${string}`>;

/**
 * 从 model_info / litellm_params 提取 TPM 限速。
 * 优先 model_info.tpm（来自 config model_info 节），fallback 到 litellm_params.tpm。
 * @param info - model_info（可能 undefined）
 * @param deployment - deployment（提供 litellm_params fallback）
 */
export function pickTpm(info: ModelInfo | undefined, deployment: Deployment): number | undefined {
	return info?.tpm ?? deployment.litellm_params.tpm;
}

/**
 * 从 model_info / litellm_params 提取 RPM 限速。
 * 优先 model_info.rpm（来自 config model_info 节），fallback 到 litellm_params.rpm。
 * @param info - model_info（可能 undefined）
 * @param deployment - deployment（提供 litellm_params fallback）
 */
export function pickRpm(info: ModelInfo | undefined, deployment: Deployment): number | undefined {
	return info?.rpm ?? deployment.litellm_params.rpm;
}

/** 全局 SUPPORTS_FLAGS 列表 */
export const SUPPORTS_FLAGS: readonly SupportsFlag[] = [
	"supports_function_calling",
	"supports_vision",
	"supports_tool_choice",
	"supports_parallel_function_calling",
	"supports_system_messages",
	"supports_response_format",
];

/** 模型组项响应（对齐 Python LiteLLM /model_group/info 返回结构） */
export interface ModelGroupInfoItem {
	/** 模型组名称（即 model_name） */
	model_group: string;
	/** 该模型组下所有 provider 去重列表 */
	providers: string[];
	/** 输入 token 单价（取首个非空 deployment 值） */
	input_cost_per_token?: number;
	/** 输出 token 单价（取首个非空 deployment 值） */
	output_cost_per_token?: number;
	/** 最大输入 token 数 */
	max_input_tokens?: number;
	/** 最大输出 token 数 */
	max_output_tokens?: number;
	/** 模型模式：chat / completion / embedding 等 */
	mode?: string;
	/** 每分钟 token 限制 */
	tpm?: number;
	/** 每分钟请求限制 */
	rpm?: number;
	/** 是否支持函数调用 */
	supports_function_calling?: boolean;
	/** 是否支持视觉输入 */
	supports_vision?: boolean;
	/** 是否支持工具选择 */
	supports_tool_choice?: boolean;
	/** 是否支持并行函数调用 */
	supports_parallel_function_calling?: boolean;
	/** 是否支持 system 消息 */
	supports_system_messages?: boolean;
	/** 是否支持 response_format（OpenAI structured outputs 兼容） */
	supports_response_format?: boolean;
	/** 模型组内首个 deployment 的 litellm_params（兼容 Python 协议占位） */
	litellm_params?: Record<string, unknown>;
	/** 该模型组下 deployment 数量 */
	deployment_count?: number;
}

/**
 * 把单个 `SupportsFlag` 写入 `ModelGroupInfoItem` 对应字段。
 *
 * 类型安全：每个 case 都对应 `ModelGroupInfoItem` 中声明的 supports_* 字段；
 * default 分支使用 `never` 强制穷举，新加 `SUPPORTS_FLAGS` 成员但忘了登记
 * case 时编译器会立即报错，避免静默漏赋值。
 * @param item - 聚合结果项
 * @param flag - SupportsFlag 成员
 * @param value - 是否启用该能力
 * @throws {Error} 收到未在 SUPPORTS_FLAGS 中登记的成员时（编译期应已捕获，运行时为防御性兜底）
 */
function applySupportFlag(item: ModelGroupInfoItem, flag: SupportsFlag, value: boolean): void {
	if (!value) {
		return;
	}
	switch (flag) {
		case "supports_function_calling":
			item.supports_function_calling = true;
			return;
		case "supports_vision":
			item.supports_vision = true;
			return;
		case "supports_tool_choice":
			item.supports_tool_choice = true;
			return;
		case "supports_parallel_function_calling":
			item.supports_parallel_function_calling = true;
			return;
		case "supports_system_messages":
			item.supports_system_messages = true;
			return;
		case "supports_response_format":
			// eslint-disable-next-line camelcase -- Python LiteLLM 协议字段保持 snake_case
			item.supports_response_format = true;
			return;
		default: {
			const exhaustive: never = flag;
			throw new Error(`Unhandled SupportsFlag member: ${String(exhaustive)}`);
		}
	}
}

interface GroupBucket {
	readonly providers: Set<string>;
	readonly modes: Set<string>;
	readonly supports: Partial<Record<SupportsFlag, boolean>>;
	readonly sample: Deployment;
	deploymentCount: number;
	tpm?: number;
	rpm?: number;
	inputCost?: number;
	outputCost?: number;
	maxInput?: number;
	maxOutput?: number;
}

/**
 * 把 deployments 数组按 model_name 聚合成 ModelGroupInfoItem[]。
 * @param deployments
 */
export function buildModelGroupInfoResponse(deployments: Deployment[]): { data: ModelGroupInfoItem[] } {
	const groups = new Map<string, GroupBucket>();
	for (const dep of deployments) {
		let groupBucket = groups.get(dep.model_name);
		if (!groupBucket) {
			groupBucket = {
				providers: new Set(),
				modes: new Set(),
				supports: {},
				deploymentCount: 0,
				sample: dep,
			};
			groups.set(dep.model_name, groupBucket);
		}
		// 累计 deploymentCount：避免在 group 输出阶段再做 O(n) filter
		groupBucket.deploymentCount += 1;
		const provider = dep.litellm_params.custom_llm_provider ?? dep.litellm_params.model?.split("/")[0] ?? "";
		if (provider) {
			groupBucket.providers.add(provider);
		}
		const info = dep.model_info;
		if (info?.mode) {
			groupBucket.modes.add(info.mode);
		}
		const tpm = pickTpm(info, dep);
		if (typeof tpm === "number") {
			groupBucket.tpm = tpm;
		}
		const rpm = pickRpm(info, dep);
		if (typeof rpm === "number") {
			groupBucket.rpm = rpm;
		}
		if (typeof info?.input_cost_per_token === "number") {
			groupBucket.inputCost = info.input_cost_per_token;
		} else if (typeof dep.litellm_params.input_cost_per_token === "number") {
			groupBucket.inputCost = dep.litellm_params.input_cost_per_token;
		}
		if (typeof info?.output_cost_per_token === "number") {
			groupBucket.outputCost = info.output_cost_per_token;
		} else if (typeof dep.litellm_params.output_cost_per_token === "number") {
			groupBucket.outputCost = dep.litellm_params.output_cost_per_token;
		}
		if (typeof info?.max_input_tokens === "number") {
			groupBucket.maxInput = info.max_input_tokens;
		}
		if (typeof info?.max_output_tokens === "number") {
			groupBucket.maxOutput = info.max_output_tokens;
		}
		for (const flag of SUPPORTS_FLAGS) {
			if (info?.[flag] === true) {
				groupBucket.supports[flag] = true;
			}
		}
	}

	const data: ModelGroupInfoItem[] = [];
	for (const [groupName, groupBucket] of groups) {
		const item: ModelGroupInfoItem = {
			model_group: groupName,
			providers: Array.from(groupBucket.providers),
		};
		if (groupBucket.inputCost !== undefined) {
			item.input_cost_per_token = groupBucket.inputCost;
		}
		if (groupBucket.outputCost !== undefined) {
			item.output_cost_per_token = groupBucket.outputCost;
		}
		if (groupBucket.maxInput !== undefined) {
			item.max_input_tokens = groupBucket.maxInput;
		}
		if (groupBucket.maxOutput !== undefined) {
			item.max_output_tokens = groupBucket.maxOutput;
		}
		// mode 单值：保持 Python LiteLLM 语义（mode 是字符串字段，不是列表）。
		// 同一 model_name 下不同 deployment 若有不同 mode，取首个非空值（按遍历顺序）。
		if (groupBucket.modes.size > 0) {
			const firstMode = groupBucket.modes.values().next().value;
			if (typeof firstMode === "string") {
				item.mode = firstMode;
			}
		}
		if (groupBucket.tpm !== undefined) {
			item.tpm = groupBucket.tpm;
		}
		if (groupBucket.rpm !== undefined) {
			item.rpm = groupBucket.rpm;
		}
		// supports_*：用同一 SUPPORTS_FLAGS 驱动赋值，避免与聚合阶段重复维护白名单
		for (const flag of SUPPORTS_FLAGS) {
			if (groupBucket.supports[flag] === true) {
				// ModelGroupInfoItem 接口已包含全部 SUPPORTS_FLAGS 字段（含 supports_response_format），
				// 避免使用 `as unknown as Record<string, boolean>` 双重断言；TS 在编译期保证赋值合法。
				applySupportFlag(item, flag, groupBucket.supports[flag] === true);
			}
		}
		item.deployment_count = groupBucket.deploymentCount;
		data.push(item);
	}

	return { data: data };
}
