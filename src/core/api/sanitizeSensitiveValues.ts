/** HTTP 响应中的固定秘密掩码。 */
export const MASKED_SENSITIVE_VALUE = "********";

const SENSITIVE_KEY_NAMES = new Set([
	"api_key",
	"api_token",
	"authorization",
	"cookie",
	"credential_value",
	"credential_values",
	"master_key",
	"password",
	"secret",
	"token",
]);

/**
 * 判断字段名是否承载秘密，避免将 max_tokens 等普通配置误判为 secret。
 * @param key
 */
function isSensitiveKey(key: string): boolean {
	const normalized = key.toLowerCase().replaceAll("-", "_");
	if (normalized.endsWith("_cost_per_token")) {
		return false;
	}
	if (SENSITIVE_KEY_NAMES.has(normalized)) {
		return true;
	}
	return ["api_key", "token", "secret", "password", "authorization", "cookie"].some(
		(suffix) => normalized.endsWith(`_${suffix}`) || normalized.startsWith(`${suffix}_`),
	);
}

/**
 * 递归复制响应值，并将秘密字段替换为固定掩码。
 * 仅用于 HTTP 响应投影，不得用于 DB 持久化或 Router 运行时对象。
 * @param value - 待投影的响应值
 */
export function sanitizeSensitiveValues(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map((item) => sanitizeSensitiveValues(item));
	}
	if (value === null || typeof value !== "object") {
		return value;
	}

	const sanitized: Record<string, unknown> = {};
	for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
		sanitized[key] = isSensitiveKey(key) ? MASKED_SENSITIVE_VALUE : sanitizeSensitiveValues(nestedValue);
	}
	return sanitized;
}
