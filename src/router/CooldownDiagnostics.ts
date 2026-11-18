/**
 * CooldownDiagnostics — 把冷却条目整理成可写入日志的诊断快照。
 *
 * 背景：预检阶段全部署冷却时，请求不会发往任何上游，最终错误只能是 router 自己的
 * "No deployments available for selected model" 文案。之前这条日志据此成为孤证——看不到
 * 是哪个部署、因为什么错误（429 / 超时 / 5xx）、多久前进入冷却，只能等冷却窗口自然过期。
 *
 * 冷却条目（CooldownCacheValue）本来就保存了触发冷却的 status_code 与 exception_received，
 * 这里把它们投影成日志友好的结构，随错误一起落进 metadata.error_information.cooldown_context。
 * 仅用于观测：`mapToApiError` 只消费 message/status/type/param，不会进入客户端响应体。
 */

import type { CooldownCacheValue } from "./CooldownCacheTypes";
import type { CooldownDiagnostic } from "./RouterErrors";

/**
 * 把 `getActiveCooldowns()` 的结果投影成诊断快照。
 * @param entries - `[deploymentKey, CooldownCacheValue]` 列表（已由 CooldownManager 清理过期项）
 * @returns 诊断快照；输入为空时返回空数组，调用方据此决定是否落字段
 */
export function buildCooldownDiagnostics(entries: ReadonlyArray<[string, CooldownCacheValue]>): CooldownDiagnostic[] {
	return entries.map(([deploymentKey, value]) => ({
		deployment_id: deploymentKey,
		status_code: value.status_code,
		// exception_received 在 markFailed 之前已按部署参数脱敏；这里保持原文，
		// 否则 50 字符截断会把 429 的具体原因切掉，诊断价值归零。
		error_message: value.exception_received,
		cooldown_seconds: Math.round(value.cooldown_time / 1000),
		started_at: new Date(value.timestamp).toISOString(),
	}));
}
