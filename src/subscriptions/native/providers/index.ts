/**
 * 订阅 Provider 集合。
 *
 * 具体适配器由各来源模块提供；这里只负责组装查找表，避免运行时依赖具体列表。
 */

import type { SubscriptionProviderLookup } from "../bridge";
import type { SubscriptionProviderAdapter, SubscriptionSource } from "../types";
import { createAntigravityProvider } from "./antigravity";
import { createClaudeProvider } from "./claude";
import { createCodexProvider } from "./codex";
import { createCommandCodeProvider } from "./commandcode";
import { createKimiProvider } from "./kimi";
import { createOpenCodeProvider } from "./opencode";
import type { SubscriptionProviderDependencies } from "./types";
import { createXaiProvider } from "./xai";

/**
 * 固定适配器集合。
 */
export class StaticSubscriptionProviderLookup implements SubscriptionProviderLookup {
	private readonly _adapters: readonly SubscriptionProviderAdapter[];
	private readonly _bySource: ReadonlyMap<SubscriptionSource, SubscriptionProviderAdapter>;

	constructor(adapters: readonly SubscriptionProviderAdapter[]) {
		this._adapters = adapters;
		this._bySource = new Map(adapters.map((adapter) => [adapter.source, adapter]));
	}

	/**
	 * 按来源取适配器。
	 * @param source - 账号来源
	 */
	get(source: SubscriptionSource): SubscriptionProviderAdapter | undefined {
		return this._bySource.get(source);
	}

	/** 全部适配器。 */
	list(): readonly SubscriptionProviderAdapter[] {
		return this._adapters;
	}
}

/**
 * 组装订阅 Provider。
 * @param dependencies - 账号仓库与可注入 fetch
 */
export function createSubscriptionProviderLookup(
	dependencies: SubscriptionProviderDependencies,
): SubscriptionProviderLookup {
	return new StaticSubscriptionProviderLookup([
		createCodexProvider(dependencies),
		createClaudeProvider(dependencies),
		createKimiProvider(dependencies),
		createAntigravityProvider(dependencies),
		createXaiProvider(dependencies),
		createCommandCodeProvider(dependencies),
		createOpenCodeProvider(dependencies),
	]);
}
