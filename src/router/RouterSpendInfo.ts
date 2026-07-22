/**
 * DeploymentSpendInfo — 实际执行 deployment 的 spend 计费/归因信息
 *
 * 生产干跑发现 TS 写入 LiteLLM_SpendLogs 的行 spend=0 且 model_group /
 * custom_llm_provider / api_base 全空：CostCalculator 只查内置 PRICE_TABLE，
 * 未接入 deployment model_info 的自定义价格（生产全部价格都在
 * model_info.input_cost_per_token / output_cost_per_token / cache_read_input_token_cost）。
 *
 * 对齐 Python：
 *   - Router 创建 deployment 时把 model_info + litellm_params 自定义价格注册进
 *     litellm.model_cost（router.py:6604-6612 register_model），cost 计算优先使用
 *   - SpendLogs.custom_llm_provider = 实际执行 deployment 的 provider
 *   - SpendLogs.api_base = 实际执行上游完整 URL（含 /v1/messages 路径）
 *   - SpendLogs.model_id = deployment model_info.id
 */

import { defaultProviderRegistry } from "../providers/ProviderRegistry";
import type { CustomCostPerToken } from "../cost/CostCalculator";
import type { Deployment } from "../types/router";

/** 实际执行 deployment 的 spend 归因信息（挂在 Router 结果的 `_spendInfo` 字段） */
export interface DeploymentSpendInfo {
	/** 实际执行 deployment 的 provider（custom_llm_provider ?? 从 litellm_params.model 前缀解析） */
	readonly customLlmProvider: string;
	/** 实际执行上游完整 URL（provider.transformRequest 产出，含路径） */
	readonly apiBase: string;
	/** deployment model_info.id（PY SpendLogs.model_id） */
	readonly modelId?: string;
	/**
	 * deployment litellm_params.model 完整模型名（含 provider 前缀）。
	 * PY reconstruct_model_name 的 metadata["deployment"] 等价物，
	 * 供 SpendLogs.model 列重建（SpendTracker.reconstructModelName）。
	 */
	readonly deploymentModel: string;
	/** deployment 自定义价格（per-token）；无任何价格配置时为 undefined */
	readonly customCostPerToken?: CustomCostPerToken;
}

/**
 * 提取 deployment 的自定义价格（per-token）。
 * 优先级（低→高，后者覆盖，对齐 PY router.py:6604-6607 litellm_params 合并进 model_info）：
 *   model_info 价格 < litellm_params 平铺价格字段 < litellm_params.custom_cost_per_token 对象
 * 四项全未配置时返回 undefined（回退内置 PRICE_TABLE / llmux 零计费）。
 * @param deployment - 实际执行的 deployment
 */
export function extractDeploymentCustomCost(deployment: Deployment): CustomCostPerToken | undefined {
	const modelInfo = deployment.model_info;
	const params = deployment.litellm_params;
	const customObj = params.custom_cost_per_token;
	const merged: CustomCostPerToken = {
		input_cost_per_token: customObj?.input_cost_per_token ?? params.input_cost_per_token ?? modelInfo?.input_cost_per_token,
		output_cost_per_token: customObj?.output_cost_per_token ?? params.output_cost_per_token ?? modelInfo?.output_cost_per_token,
		cache_creation_input_token_cost:
			customObj?.cache_creation_input_token_cost ??
			(params["cache_creation_input_token_cost"] as number | undefined) ??
			modelInfo?.cache_creation_input_token_cost,
		cache_read_input_token_cost:
			customObj?.cache_read_input_token_cost ??
			(params["cache_read_input_token_cost"] as number | undefined) ??
			modelInfo?.cache_read_input_token_cost,
	};
	if (
		merged.input_cost_per_token === undefined &&
		merged.output_cost_per_token === undefined &&
		merged.cache_creation_input_token_cost === undefined &&
		merged.cache_read_input_token_cost === undefined
	) {
		return undefined;
	}
	return merged;
}

/**
 * 构造实际执行 deployment 的 spend 归因信息。
 * provider 解析与 ProviderRegistry.getProvider 同一优先级：
 * litellm_params.custom_llm_provider ?? parseProviderName(litellm_params.model)。
 * @param deployment - 实际执行的 deployment
 * @param apiBase - 实际执行上游完整 URL（provider.transformRequest 产出的 url）
 */
export function buildDeploymentSpendInfo(deployment: Deployment, apiBase: string): DeploymentSpendInfo {
	const params = deployment.litellm_params;
	const customLlmProvider = params.custom_llm_provider ?? defaultProviderRegistry.parseProviderName(params.model);
	return {
		customLlmProvider: customLlmProvider,
		apiBase: apiBase,
		modelId: deployment.model_info?.id,
		deploymentModel: params.model,
		customCostPerToken: extractDeploymentCustomCost(deployment),
	};
}
