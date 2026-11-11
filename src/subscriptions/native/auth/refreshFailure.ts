/**
 * 订阅账号刷新失败的终态判定与账号禁用。
 *
 * OAuth 刷新错误在不同 Provider 中被包装成文本；这里统一识别不可恢复的
 * `invalid_grant` 一类错误，避免每小时重复使用已作废的 refresh token。
 */

import type { SubscriptionAccountStore } from "../accountStore";
import type { SubscriptionAccount } from "../types";

/** 明确表示 refresh token 已不可恢复的错误片段。 */
const TERMINAL_PATTERNS = [
	"invalid_grant",
	"invalid_client",
	"unauthorized_client",
	"token_revoked",
	"refresh_token_reused",
	"refresh_token_expired",
	"refresh_token_invalidated",
	"invalid refresh token",
	"refresh token has expired",
	"refresh token is invalid",
	"refresh token 已被拒绝",
	"请重新登录",
] as const;

/**
 * 判断刷新错误是否属于需要禁用账号的终态。
 * @param value - 捕获的错误
 */
export function isTerminalRefreshFailure(value: unknown): boolean {
	const message = (value instanceof Error ? value.message : String(value)).toLowerCase();
	return TERMINAL_PATTERNS.some((pattern) => message.includes(pattern));
}

/**
 * 清洗错误文本，去掉可能被上游回显的 token 片段。
 * @param value - 捕获的错误
 */
export function refreshFailureMessage(value: unknown): string {
	const message = value instanceof Error ? value.message : String(value);
	return message
		.replace(/[A-Za-z0-9_-]{32,}/g, "***")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 500);
}

/**
 * 把终态刷新失败写入账号：禁用并记录状态、错误与失败次数。
 * @param accounts - 账号仓库
 * @param account - 账号
 * @param error - 刷新错误
 */
export async function disableInvalidAccount(
	accounts: SubscriptionAccountStore,
	account: SubscriptionAccount,
	error: unknown,
): Promise<void> {
	const current = await accounts.readRaw(account.fileName);
	const previous = typeof current["refresh_failures"] === "number" ? current["refresh_failures"] : 0;
	await accounts.patchRaw(account.fileName, {
		disabled: true,
		status: "disabled (invalid grant)",
		last_error: refreshFailureMessage(error),
		refresh_failures: previous + 1,
	});
}
