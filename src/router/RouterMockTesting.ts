/**
 * RouterMockTesting — mock_testing_* 入口参数转换
 *
 * 抽离 Router 中 mock_testing 相关的 helper：
 *   - _normalizeMockTestingParams：str-to-bool 转换（"true"/"True"/"1" → true）
 *   - dispatchMockTesting：acompletion 入口的 mock_testing_* 异常派发
 *
 * 行为完全等价于 Router 内联版本 — 拆分以控制 Router.ts 行数。
 */

import type { FallbackHandler } from "./FallbackHandler";
import { RateLimitError } from "./RouterErrors";
import { MockTestingFallbacks, MockTestingContextFallbacks, MockTestingContentPolicyFallbacks } from "./MockTesting";

/**
 * 入口对 mock_testing_* 参数做 str-to-bool 转换。
 * 对齐 PY `router_helper_utils.py:1321` test_mock_router_testing_params_str_to_bool_conversion。
 * @param params - 可变副本（仅在确实转换时新建）
 */
export function normalizeMockTestingParams(params: Record<string, unknown>): Record<string, unknown> {
	const keys = [
		"mock_testing_fallbacks",
		"mock_testing_context_fallbacks",
		"mock_testing_content_policy_fallbacks",
		"mock_testing_rate_limit_error",
	];
	let mutated = false;
	const out = { ...params };
	for (const k of keys) {
		const v = out[k];
		if (typeof v === "string" && (v === "true" || v === "True" || v === "1")) {
			out[k] = true;
			mutated = true;
		}
	}
	return mutated ? out : params;
}

/**
 * 处理 mock_testing_rate_limit_error 钩子：返回 true 表示已派发 RateLimitError 让上层走 fallback chain。
 * 返回 false 表示未触发。
 * @param params
 * @param model
 */
export function shouldDispatchMockRateLimit(params: Record<string, unknown>, model: string): { dispatch: boolean; error?: RateLimitError } {
	if (params["mock_testing_rate_limit_error"] === true) {
		return { dispatch: true, error: new RateLimitError(`mock_testing_rate_limit_error triggered for model "${model}"`) };
	}
	return { dispatch: false };
}

/**
 * acompletion 入口 mock_testing_* 钩子派发。
 * 返回 true 表示触发了 mock exception（调用方应将其作为 previousError 投递到 _executeWithFallback）。
 * 返回 false 表示未触发。
 * @param params
 * @param model
 * @param fallbackHandler
 */
export function tryDispatchMockTestingExceptions(
	params: Record<string, unknown>,
	model: string,
	fallbackHandler: FallbackHandler,
): { triggered: boolean; error?: Error } {
	if (params["mock_testing_fallbacks"] === true) {
		MockTestingFallbacks.raiseIfRequested(fallbackHandler.getFallbackChain(model), model);
	}
	if (params["mock_testing_context_fallbacks"] === true) {
		MockTestingContextFallbacks.raiseIfRequested(fallbackHandler.getContextWindowFallbackChain(model), model);
	}
	if (params["mock_testing_content_policy_fallbacks"] === true) {
		MockTestingContentPolicyFallbacks.raiseIfRequested(fallbackHandler.getContentPolicyFallbackChain(model), model);
	}
	return { triggered: false };
}
