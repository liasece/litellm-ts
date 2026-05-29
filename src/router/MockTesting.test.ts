/**
 * MockTesting 测试
 *
 * 对齐 Python litellm/tests/test_router.py::test_mock_router_testing_fallbacks
 * 验证四个 mock_testing_* 钩子抛出的异常类型与 PY 完全一致。
 *
 * GAP (MOCK-001): 之前抛自定义 MockTestTriggerError，从不被 Router catch；
 * 现改为标准 litellm 异常类，让 Router._executeWithFallback 通过 instanceof 派发到 fallback 链。
 */
import { MockTestingFallbacks, MockTestingContextFallbacks, MockTestingContentPolicyFallbacks } from "./MockTesting";
import { InternalServerError, ContextWindowExceededError, ContentPolicyViolationError, RateLimitError } from "./RouterErrors";

describe("MockTesting", () => {
	describe("MockTestingFallbacks (mock_testing_fallbacks)", () => {
		it("抛出 InternalServerError (对齐 PY router.py:5522-5526)", () => {
			expect(() => MockTestingFallbacks.raiseIfRequested(["model-b"], "model-a")).toThrow(InternalServerError);
		});

		it("链为空时也抛 InternalServerError (PY: 无论 chain 是否存在都抛)", () => {
			expect(() => MockTestingFallbacks.raiseIfRequested([], "model-a")).toThrow(InternalServerError);
		});

		it("抛出的异常携带 model 字段", () => {
			try {
				MockTestingFallbacks.raiseIfRequested(["model-b"], "model-a");
				fail("expected to throw");
			} catch (err) {
				expect(err).toBeInstanceOf(InternalServerError);
				expect((err as InternalServerError).model).toBe("model-a");
			}
		});

		it("InternalServerError 继承自 LitellmError，可被 Router._executeWithFallback 派发", () => {
			try {
				MockTestingFallbacks.raiseIfRequested(["model-b"], "model-a");
				fail("expected to throw");
			} catch (err) {
				// 模拟 Router 的 catch 块：instanceof 分发
				const handledBy =
					err instanceof InternalServerError
						? "fallback_chain"
						: err instanceof ContextWindowExceededError
							? "cw_fallback"
							: "unknown";
				expect(handledBy).toBe("fallback_chain");
			}
		});
	});

	describe("MockTestingContextFallbacks (mock_testing_context_fallbacks)", () => {
		it("抛出 ContextWindowExceededError (对齐 PY router.py:5763-5796)", () => {
			expect(() => MockTestingContextFallbacks.raiseIfRequested(["model-b"], "model-a")).toThrow(ContextWindowExceededError);
		});

		it("抛出的异常是 BadRequestError 子类（PY: 继承 BadRequestError）", () => {
			try {
				MockTestingContextFallbacks.raiseIfRequested(["model-b"], "model-a");
				fail("expected to throw");
			} catch (err) {
				expect(err).toBeInstanceOf(ContextWindowExceededError);
				// PY: ContextWindowExceededError 继承自 BadRequestError；TS 同理
				const { BadRequestError } = require("./RouterErrors") as typeof import("./RouterErrors");
				expect(err).toBeInstanceOf(BadRequestError);
			}
		});
	});

	describe("MockTestingContentPolicyFallbacks (mock_testing_content_policy_fallbacks)", () => {
		it("抛出 ContentPolicyViolationError (对齐 PY router.py:5763-5796)", () => {
			expect(() => MockTestingContentPolicyFallbacks.raiseIfRequested(["model-b"], "model-a")).toThrow(ContentPolicyViolationError);
		});
	});
});
