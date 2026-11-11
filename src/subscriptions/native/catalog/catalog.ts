/**
 * 订阅模型目录入口。
 *
 * 七家来源统一走这里：五家 OAuth 来源读静态文件（{@link staticCatalogForSource}），
 * CommandCode / OpenCode Go 的目录在上游 `/models`，这里提供内置回退项与刷新入口。
 * 目录刷新仍由调用方调度：本模块不持有定时器，也不保存刷新结果，只做一次纯分派。
 */

import type { SubscriptionCatalogModel, SubscriptionSource } from "../types";
import { builtinCatalogForSource, fetchCommandCodeCatalog, fetchOpenCodeCatalog } from "./dynamicCatalog";
import { staticCatalogForSource } from "./staticCatalog";

/**
 * 当前可用的同步目录。
 *
 * 静态来源直接返回过滤后的文件内容；动态来源返回内置回退项——它保证「目录」这件事
 * 对七家都成立，真实列表由 {@link refreshDynamicCatalog} 刷新后交给调用方自己保存。
 * @param source - 订阅来源
 * @returns 冻结的模型列表
 * @throws ApiError 静态数据文件缺失或格式无效时抛出
 */
export function catalogForSource(source: SubscriptionSource): readonly SubscriptionCatalogModel[] {
	if (source === "commandcode" || source === "opencode-go") {
		return builtinCatalogForSource(source);
	}
	return staticCatalogForSource(source);
}

/**
 * 刷新某一来源的目录。
 *
 * 动态来源拉取上游 `/models`，失败时回退内置列表；静态来源没有远端可拉，直接返回
 * 文件内容，调用方不必按来源分支。
 * @param source - 订阅来源
 * @param apiKey - API key；静态来源忽略
 * @param fetchImpl - 注入的 fetch；测试使用
 * @returns 该来源的模型列表
 * @throws ApiError 静态数据文件缺失或格式无效时抛出
 */
export async function refreshDynamicCatalog(
	source: SubscriptionSource,
	apiKey: string,
	fetchImpl: typeof fetch = fetch,
): Promise<readonly SubscriptionCatalogModel[]> {
	if (source === "commandcode") {
		return fetchCommandCodeCatalog(apiKey, fetchImpl);
	}
	if (source === "opencode-go") {
		return fetchOpenCodeCatalog(apiKey, fetchImpl);
	}
	return staticCatalogForSource(source);
}
