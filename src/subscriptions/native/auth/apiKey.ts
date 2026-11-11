/**
 * API key 型订阅账号的鉴权：凭据直接来自 auth JSON 的 `api_key`。
 */

import { ApiError } from "../../../core/api/ApiError";
import type { SubscriptionAccount, SubscriptionAuthHandler, SubscriptionSource } from "../types";

/**
 * 读取账号上的 API key。
 * @param account - 账号
 * @throws {ApiError} 账号缺少 API key 时抛出
 */
export function accountApiKey(account: SubscriptionAccount): string {
	const value = account.raw["api_key"];
	if (typeof value !== "string" || !value.trim()) {
		throw ApiError.unavailable("订阅账号缺少 API key");
	}
	return value.trim();
}

/**
 * 为 CommandCode / OpenCode 这类静态 key 来源创建鉴权处理器。
 * @param source - 账号来源
 */
export function createApiKeyAuth(source: SubscriptionSource): SubscriptionAuthHandler {
	return {
		source: source,
		ensureCredential: async (account: SubscriptionAccount): Promise<string> => accountApiKey(account),
		refresh: async (): Promise<void> => {
			// 静态 key 没有刷新语义；上游 401 时保留原始错误。
		},
	};
}
