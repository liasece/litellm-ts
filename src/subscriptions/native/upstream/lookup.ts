/**
 * 部署 → 上游模型信息的定位。
 *
 * 订阅部署把「公开 Provider」放在 `litellm_params.custom_llm_provider`（或模型前缀），
 * 把真正的上游模型 ID 放在 `litellm_params.model`。上游元信息按（来源, 上游模型 ID）
 * 缓存，因此这里负责把部署翻译成这两个键；非订阅部署返回 undefined。
 */

import type { Deployment } from "../../../types/router";
import { SUBSCRIPTION_PROVIDERS, hostedProvider, withoutProvider } from "../../../subscriptions/SubscriptionProviders";
import type { SubscriptionSource } from "../types";

/** 一个部署对应的上游元信息键。 */
export interface UpstreamModelRef {
	/** 订阅来源（与缓存表的 source 列一致）。 */
	readonly source: SubscriptionSource;
	/** 上游模型 ID（与缓存表的 model_id 列一致）。 */
	readonly upstreamModel: string;
}

/**
 * 解析部署对应的上游元信息键。
 * @param deployment - 路由部署
 */
export function upstreamRefForDeployment(deployment: Deployment): UpstreamModelRef | undefined {
	const params = deployment.litellm_params;
	const provider = hostedProvider({ model: params.model, custom_llm_provider: params.custom_llm_provider });
	if (provider === undefined) {
		return undefined;
	}
	const source = SUBSCRIPTION_PROVIDERS[provider].source as SubscriptionSource;
	return { source: source, upstreamModel: withoutProvider(params.model, provider) };
}
