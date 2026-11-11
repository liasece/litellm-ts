/**
 * 订阅 OAuth 账号文件的公共辅助。
 *
 * 账号 JSON 是跨运行时共享的持久化格式：旧 Go 运行时、当前 Node 实现与回滚后的
 * Go 运行时都读取同一批文件。这里只补写 OAuth 相关字段，其余键原样保留。
 */

import { ApiError } from "../../../core/api/ApiError";
import type { SubscriptionAccountStore } from "../accountStore";
import { parseJwtPayload } from "./http";

/** access token 到期前的刷新窗口（毫秒）。 */
export const SUBSCRIPTION_REFRESH_LEAD_MS = 5 * 60 * 1000;

/** 账号文件锁等待上限（毫秒）。 */
export const SUBSCRIPTION_FILE_LOCK_TIMEOUT_MS = 35 * 1000;

/**
 * 读取非空字符串字段。
 * @param raw - auth JSON
 * @param key - 字段名
 */
export function readStringField(raw: Record<string, unknown>, key: string): string | undefined {
	const value = raw[key];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * 读取嵌套对象字段。
 * @param raw - auth JSON
 * @param key - 字段名
 */
export function readRecordField(raw: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
	const value = raw[key];
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return undefined;
	}
	return value as Record<string, unknown>;
}

/**
 * 读取正数数值字段；字符串形式的数字也接受。
 * @param raw - auth JSON
 * @param key - 字段名
 */
export function readPositiveNumberField(raw: Record<string, unknown>, key: string): number | undefined {
	const value = raw[key];
	if (typeof value === "number" && Number.isFinite(value) && value > 0) {
		return value;
	}
	if (typeof value === "string" && value.trim()) {
		const parsed = Number(value);
		if (Number.isFinite(parsed) && parsed > 0) {
			return parsed;
		}
	}
	return undefined;
}

/**
 * 解析 access token 到期时间（毫秒时间戳）。
 *
 * 依次检查 `expires_at`、`expired`、`expiry`、`expires`，最后回退到 JWT 的 `exp`。
 * 数字大于 1e10 视为毫秒，否则视为秒。
 * @param raw - auth JSON
 */
export function credentialExpiryMs(raw: Record<string, unknown>): number | undefined {
	for (const key of ["expires_at", "expired", "expiry", "expires"]) {
		const value = raw[key];
		if (typeof value === "number" && Number.isFinite(value)) {
			return value > 10_000_000_000 ? value : value * 1000;
		}
		if (typeof value === "string" && value.trim()) {
			const parsed = Date.parse(value);
			if (Number.isFinite(parsed)) {
				return parsed;
			}
			const numeric = Number(value);
			if (Number.isFinite(numeric) && numeric > 0) {
				return numeric > 10_000_000_000 ? numeric : numeric * 1000;
			}
		}
	}
	const accessToken = readStringField(raw, "access_token");
	if (accessToken) {
		const exp = parseJwtPayload(accessToken)?.["exp"];
		if (typeof exp === "number" && Number.isFinite(exp)) {
			return exp * 1000;
		}
	}
	return undefined;
}

/**
 * 格式化为秒精度的 RFC3339（UTC），与 Go 运行时写出的 `expired`/`last_refresh` 兼容。
 * @param timestampMs - 毫秒时间戳
 */
export function formatRfc3339(timestampMs: number): string {
	return new Date(timestampMs).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * 读取已有账号 JSON；文件不存在时返回 undefined。
 * @param accounts - 账号仓库
 * @param fileName - 文件名
 */
export async function readAccountFile(
	accounts: SubscriptionAccountStore,
	fileName: string,
): Promise<Record<string, unknown> | undefined> {
	try {
		return await accounts.readRaw(fileName);
	} catch (error) {
		if (error instanceof ApiError && error.statusCode === 404) {
			return undefined;
		}
		throw error;
	}
}

/**
 * 在文件锁内合并写入账号 JSON，保留已有字段。
 *
 * 返回合并后的完整 JSON；写入失败时旧文件保持不变。
 * @param accounts - 账号仓库
 * @param fileName - 文件名
 * @param patch - 需要覆盖的字段
 */
export async function mergeWriteAccountFile(
	accounts: SubscriptionAccountStore,
	fileName: string,
	patch: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	await accounts.ensureDirectories();
	return await accounts.withFileLock(fileName, SUBSCRIPTION_FILE_LOCK_TIMEOUT_MS, async () => {
		const existing = await readAccountFile(accounts, fileName);
		const merged: Record<string, unknown> = existing ? { ...existing, ...patch } : { ...patch };
		await accounts.writeRaw(fileName, merged);
		return merged;
	});
}

/**
 * 将任意异常转成可展示的错误文本。
 * @param error - 异常
 */
export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
