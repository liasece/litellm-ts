/**
 * 订阅 Provider 适配器的构造契约。
 */

import type { SubscriptionAccountStore } from "../accountStore";
import type { SubscriptionProviderAdapter } from "../types";

/** 适配器构造依赖。 */
export interface SubscriptionProviderDependencies {
	/** 账号仓库。 */
	readonly accounts: SubscriptionAccountStore;
	/** 可注入的 fetch；测试使用。 */
	readonly fetch?: typeof fetch;
}

/** 适配器工厂。 */
export type SubscriptionProviderFactory = (dependencies: SubscriptionProviderDependencies) => SubscriptionProviderAdapter;
