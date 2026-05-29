/**
 * CooldownMasking — 敏感数据脱敏 helpers
 *
 * 抽离自 CooldownManager，避免主类充斥调试/打印工具函数。
 * 对齐 PY `cooldown_handlers.py:323-328` 的 `visible_prefix=50` 截断。
 */

import type { CooldownCacheValue } from "./CooldownCacheTypes";

/**
 * DIFF-RT-04: 对齐 PY `cooldown_handlers.py:323-328` 的 `visible_prefix=50` masking。
 * 把 deploymentName (api_key/api_base/model_name 等) 透传给上层异常或日志时，
 * 截断前 50 字符 + 星号，避免敏感凭证泄漏。
 *
 *   - 长度 <= 50: 不截断
 *   - 长度  > 50: 返回 `${前50字符}*****`
 * @param value - 待 mask 的原始字符串
 */
export function maskSensitiveData(value: string): string {
	const VISIBLE_PREFIX = 50;
	if (value.length <= VISIBLE_PREFIX) {
		return value;
	}
	return `${value.slice(0, VISIBLE_PREFIX)}*****`;
}

/**
 * DIFF-RT-04: 对 CooldownCacheValue 列表应用 mask。
 * 对齐 PY `_get_cooldown_deployments` 返回 `List[Tuple[model_id, masked_value]]` 语义。
 * @param entries - getActiveCooldowns() 返回的 [(name, CooldownCacheValue)]
 */
export function maskCooldownEntries(entries: Array<[string, CooldownCacheValue]>): Array<[string, string]> {
	return entries.map(([name, value]) => [maskSensitiveData(name), maskSensitiveData(JSON.stringify(value))] as [string, string]);
}
