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
import type { DeploymentSpendInfo } from "../types/spendInfo";

import { type CustomCostPerToken, type PeakPricingConfig } from "../cost/CostCalculator";
import { upstreamRefForDeployment } from "../subscriptions/native/upstream/lookup";
import { upstreamSnapshotForRef } from "../subscriptions/native/upstream/runtime";
import type { Deployment } from "../types/router";
import { getUpstreamIdentity } from "./UpstreamKeyIdentity";

/** 实际执行 deployment 的 spend 归因信息（挂在 Router 结果的 `_spendInfo` 字段） */

/**
 * 提取 deployment 的自定义价格（per-token）。
 * 优先级（低→高，后者覆盖，对齐 PY router.py:6604-6607 litellm_params 合并进 model_info）：
 *   model_info 价格 < litellm_params 平铺价格字段 < litellm_params.custom_cost_per_token 对象
 *
 * 订阅部署（能定位到上游来源）配置缺价时用上游目录价；价目表只有模糊匹配的启发式，
 * 与上游实际口径不一致时不采用。非订阅部署、或上游也没有价格的模型保持原逻辑
 * （价目表/PRICE_TABLE）。
 * @param deployment - 实际执行的 deployment
 */
export function extractDeploymentCustomCost(deployment: Deployment): CustomCostPerToken | undefined {
	const modelInfo = deployment.model_info;
	const params = deployment.litellm_params;
	const customObj = params.custom_cost_per_token;
	// 只认正价：模型编辑表单历史上会把留空的单价写成 0，这些 0 不是「免费」而是「还没定价」，
	// 当作已配置会让上游价永远进不来（glm-5.3 因此一直记 0 费用）。ops 要免费模型时把单价留空即可，
	// 上游价同样是 0。
	const configuredPrice = (value: unknown): number | undefined => {
		return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
	};
	const configCost: CustomCostPerToken = {
		input_cost_per_token:
			configuredPrice(customObj?.input_cost_per_token) ??
			configuredPrice(params.input_cost_per_token) ??
			configuredPrice(modelInfo?.input_cost_per_token),
		output_cost_per_token:
			configuredPrice(customObj?.output_cost_per_token) ??
			configuredPrice(params.output_cost_per_token) ??
			configuredPrice(modelInfo?.output_cost_per_token),
		cache_creation_input_token_cost:
			configuredPrice(customObj?.cache_creation_input_token_cost) ??
			configuredPrice(params["cache_creation_input_token_cost"]) ??
			configuredPrice(modelInfo?.cache_creation_input_token_cost),
		cache_read_input_token_cost:
			configuredPrice(customObj?.cache_read_input_token_cost) ??
			configuredPrice(params["cache_read_input_token_cost"]) ??
			configuredPrice(modelInfo?.cache_read_input_token_cost),
	};
	// 订阅部署的权威价格是上游目录：价目表只有按模型名模糊匹配的启发式（glm/deepseek 这类族名
	// 会命中整族价格），和上游实际计费口径常常不一致，所以配置缺价时直接让上游价接管，
	// 价目表只在上游也没有价格时兜底。
	const upstreamRef = upstreamRefForDeployment(deployment);
	const upstream = upstreamSnapshotForRef(upstreamRef)?.metadata;
	const merged: CustomCostPerToken = {
		input_cost_per_token: configCost.input_cost_per_token ?? upstream?.inputCostPerToken,
		output_cost_per_token: configCost.output_cost_per_token ?? upstream?.outputCostPerToken,
		cache_creation_input_token_cost: configCost.cache_creation_input_token_cost ?? upstream?.cacheWriteCostPerToken,
		cache_read_input_token_cost: configCost.cache_read_input_token_cost ?? upstream?.cacheReadCostPerToken,
	};
	// 记录哪些单价真来自上游：只有「配置没给、上游给了」的字段才算，用来在 Logs 页标注费用来源。
	const upstreamPricedFields = (
		[
			["input_cost_per_token", configCost.input_cost_per_token, upstream?.inputCostPerToken],
			["output_cost_per_token", configCost.output_cost_per_token, upstream?.outputCostPerToken],
			["cache_creation_input_token_cost", configCost.cache_creation_input_token_cost, upstream?.cacheWriteCostPerToken],
			["cache_read_input_token_cost", configCost.cache_read_input_token_cost, upstream?.cacheReadCostPerToken],
		] as const
	)
		.filter(([, configured, fromUpstream]) => configured === undefined && fromUpstream !== undefined)
		.map(([field]) => field);
	// 上游目录价与抓取时间一并随价格对象进入 spend 日志：上游之后调价，历史行仍能还原
	// 「这次请求当时的上游价是多少」，而不是拿今天的目录去解释昨天的账。
	const snapshot = upstreamSnapshotForRef(upstreamRef);
	const upstreamCatalog: CustomCostPerToken["upstream_catalog"] =
		snapshot === undefined
			? undefined
			: {
					source: snapshot.source,
					upstream_model: snapshot.upstreamModel,
					fetched_at: snapshot.fetchedAt,
					unit_prices: {
						...(snapshot.metadata.inputCostPerToken === undefined
							? {}
							: { input_cost_per_token: snapshot.metadata.inputCostPerToken }),
						...(snapshot.metadata.outputCostPerToken === undefined
							? {}
							: { output_cost_per_token: snapshot.metadata.outputCostPerToken }),
						...(snapshot.metadata.cacheReadCostPerToken === undefined
							? {}
							: { cache_read_input_token_cost: snapshot.metadata.cacheReadCostPerToken }),
						...(snapshot.metadata.cacheWriteCostPerToken === undefined
							? {}
							: { cache_creation_input_token_cost: snapshot.metadata.cacheWriteCostPerToken }),
					},
				};
	const peakPricing = extractDeploymentPeakPricing(deployment);
	if (
		merged.input_cost_per_token === undefined &&
		merged.output_cost_per_token === undefined &&
		merged.cache_creation_input_token_cost === undefined &&
		merged.cache_read_input_token_cost === undefined &&
		peakPricing === undefined
	) {
		return undefined;
	}
	const withSource: CustomCostPerToken = {
		...merged,
		...(upstreamPricedFields.length === 0 ? {} : { upstream_priced_fields: upstreamPricedFields }),
		...(upstreamCatalog === undefined ? {} : { upstream_catalog: upstreamCatalog }),
	};
	// 峰谷配置随价格一起透传：部分端点的 cost 计算只认 custom_cost_per_token
	return peakPricing === undefined ? withSource : { ...withSource, peak_pricing: peakPricing };
}

/**
 * 提取 deployment 的峰谷定价配置。
 * 与价格字段一致：model_info 优先，其次 litellm_params 平铺字段。
 * @param deployment - 实际执行的 deployment
 */
export function extractDeploymentPeakPricing(deployment: Deployment): PeakPricingConfig | undefined {
	const raw = deployment.model_info?.peak_pricing ?? deployment.litellm_params.peak_pricing;
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		return undefined;
	}
	const candidate = raw as PeakPricingConfig;
	return Array.isArray(candidate.windows) && typeof candidate.multiplier === "number" ? candidate : undefined;
}

/**
 * 解析 deployment 的 provider，与 ProviderRegistry.getProvider / SpendLogs.custom_llm_provider
 * 同一优先级：litellm_params.custom_llm_provider ?? parseProviderName(litellm_params.model)。
 * 费用折扣/保证金与预算预留都按这个值匹配 provider 配置。
 * @param deployment - deployment
 */
export function resolveDeploymentProvider(deployment: Deployment): string {
	const params = deployment.litellm_params;
	return params.custom_llm_provider ?? defaultProviderRegistry.parseProviderName(params.model);
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
	const customLlmProvider = resolveDeploymentProvider(deployment);
	const identity = getUpstreamIdentity(deployment);
	return {
		customLlmProvider: customLlmProvider,
		apiBase: apiBase,
		modelId: deployment.model_info?.id,
		deploymentModel: params.model,
		customCostPerToken: extractDeploymentCustomCost(deployment),
		peakPricing: extractDeploymentPeakPricing(deployment),
		...(identity?.keyHash === undefined ? {} : { upstreamKeyHash: identity.keyHash }),
		...(identity?.account === undefined ? {} : { upstreamAccount: identity.account }),
	};
}
