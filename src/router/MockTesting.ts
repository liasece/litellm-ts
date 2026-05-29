/**
 * Mock Testing — 模拟测试钩子
 *
 * 对齐 PY router.py:5517-5796 中 mock_testing_fallbacks /
 * mock_testing_context_fallbacks / mock_testing_content_policy_fallbacks /
 * mock_testing_rate_limit_error 系列钩子。
 *
 * GAP (MOCK-001): 之前用自定义 MockTestTriggerError（仅 throw-only，从不被 catch），
 * 现替换为标准 litellm 异常类：
 *   - mock_testing_fallbacks        → InternalServerError
 *   - mock_testing_context_fallbacks → ContextWindowExceededError
 *   - mock_testing_content_policy_fallbacks → ContentPolicyViolationError
 *   - mock_testing_rate_limit_error → RateLimitError
 *
 * Router._executeWithFallback 通过 instanceof 检测上述异常类型并触发对应的 fallback 链，
 * 与 Python `async_function_with_retries` 的语义一致。
 */

import { logger } from "../core/utils/logger";
import { ContentPolicyViolationError, ContextWindowExceededError, InternalServerError } from "./RouterErrors";

/** 模拟 mock_testing_fallbacks 钩子（PY router.py:5517-5526） */
export class MockTestingFallbacks {
	/**
	 * 当 optionalParams.mock_testing_fallbacks=true 时触发，模拟 fallback 流程
	 * PY: 始终抛 `litellm.InternalServerError`（router.py:5518-5526），无论 fallbacks 是否存在
	 * TS: 之前用自定义 MockTestTriggerError（throw-only，从不被 catch）；现改为 InternalServerError
	 *     让 Router._executeWithFallback 的 catch 分支通过 instanceof 检测并触发 fallback 链
	 * @param chain - 当前模型组的 fallback chain（仅用于日志）
	 * @param model - 触发模型名
	 * @throws {InternalServerError} 让上层 catch 块走 fallback 链
	 */
	static raiseIfRequested(chain: string[], model: string): void {
		const target = chain[0] ?? "(none)";
		logger.warn(`_mock_testing_fallbacks - Falling back from ${model} to ${target}`);
		throw new InternalServerError(`_mock_testing_fallbacks - Falling back to ${target} for ${model}`, { model: model });
	}
}

/** 模拟 mock_testing_context_fallbacks 钩子（PY router.py:5763-5796） */
export class MockTestingContextFallbacks {
	/**
	 * PY: 始终抛 (mock_testing_context_fallbacks=True)，与 chain 是否为空无关
	 * @param chain
	 * @param model
	 * @throws {ContextWindowExceededError} 触发 CW fallback 链
	 */
	static raiseIfRequested(chain: string[], model: string): void {
		logger.warn(`_mock_testing_context_fallbacks - Triggering CW fallback for ${model}`);
		throw new ContextWindowExceededError(`_mock_testing_context_fallbacks - Triggering CW fallback for ${model}`);
	}
}

/** 模拟 mock_testing_content_policy_fallbacks 钩子（PY router.py:5763-5796） */
export class MockTestingContentPolicyFallbacks {
	/**
	 * PY: 始终抛 (mock_testing_content_policy_fallbacks=True)
	 * @param chain
	 * @param model
	 * @throws {ContentPolicyViolationError} 触发 CP fallback 链
	 */
	static raiseIfRequested(chain: string[], model: string): void {
		logger.warn(`_mock_testing_content_policy_fallbacks - Triggering CP fallback for ${model}`);
		throw new ContentPolicyViolationError(`_mock_testing_content_policy_fallbacks - Triggering CP fallback for ${model}`);
	}
}
