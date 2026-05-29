/**
 * Router 执行链测试
 *
 * 拆分自 Router.test.ts：
 *   - _getRetryPolicyOverride per-error category
 *   - _executeWithFallback with mock fetch
 *   - DIFF-RT-02/RT-04: RouterRateLimitErrorBasic + cooldown_time/cooldown_list
 *   - DIFF-MOCK-01: mock_testing_* str-to-bool 转换
 *   - DIFF-004: per-deployment num_retries 覆盖
 *   - DIFF-015: mock_testing_fallbacks 抛 InternalServerError
 */
import { Router } from "./Router";
import type { Deployment } from "../types/router";
import { RoutingStrategyName } from "../types/router";
import { RateLimitError, AuthenticationError, BadRequestError } from "./RouterErrors";
import { installMockFetch, mkDeployment, okResponse, errorResponse } from "./RouterTestHelpers";
import { getRetryPolicyOverrideDelegate } from "./RouterTestDelegates";

let mockFetch: jest.Mock;

beforeEach(() => {
	mockFetch = installMockFetch();
});

describe("Router execution chain", () => {
	describe("_getRetryPolicyOverride", () => {
		it("AuthenticationError → AuthenticationErrorRetries", () => {
			const router = new Router({
				model_list: [mkDeployment("gpt-4")],
				routing_strategy: RoutingStrategyName.SimpleShuffle,
				num_retries: 0,
				retry_policy: {
					AuthenticationErrorRetries: 5,
					RateLimitErrorRetries: 3,
				},
			});
			const exc = new AuthenticationError("auth");
			const r = getRetryPolicyOverrideDelegate(
				exc,
				(router as unknown as { _retryPolicy: import("../types/router").RetryPolicy | undefined })._retryPolicy,
				"gpt-4",
				undefined,
			);
			expect(r).toBe(5);
		});

		it("RateLimitError → RateLimitErrorRetries", () => {
			const router = new Router({
				model_list: [mkDeployment("gpt-4")],
				routing_strategy: RoutingStrategyName.SimpleShuffle,
				num_retries: 0,
				retry_policy: { RateLimitErrorRetries: 7 },
			});
			const exc = new RateLimitError("rate");
			const r = getRetryPolicyOverrideDelegate(
				exc,
				(router as unknown as { _retryPolicy: import("../types/router").RetryPolicy | undefined })._retryPolicy,
				"gpt-4",
				undefined,
			);
			expect(r).toBe(7);
		});

		it("BadRequestError → BadRequestErrorRetries", () => {
			const router = new Router({
				model_list: [mkDeployment("gpt-4")],
				routing_strategy: RoutingStrategyName.SimpleShuffle,
				num_retries: 0,
				retry_policy: { BadRequestErrorRetries: 2 },
			});
			const exc = new BadRequestError("bad");
			const r = getRetryPolicyOverrideDelegate(
				exc,
				(router as unknown as { _retryPolicy: import("../types/router").RetryPolicy | undefined })._retryPolicy,
				"gpt-4",
				undefined,
			);
			expect(r).toBe(2);
		});

		it("ContextWindowExceededError → undefined (PY 无 CW 字段)", () => {
			const { ContextWindowExceededError } = require("./RouterErrors") as typeof import("./RouterErrors");
			const router = new Router({
				model_list: [mkDeployment("gpt-4")],
				routing_strategy: RoutingStrategyName.SimpleShuffle,
				num_retries: 0,
				retry_policy: { BadRequestErrorRetries: 5 },
			});
			const exc = new ContextWindowExceededError("cw");
			const r = getRetryPolicyOverrideDelegate(
				exc,
				(router as unknown as { _retryPolicy: import("../types/router").RetryPolicy | undefined })._retryPolicy,
				"gpt-4",
				undefined,
			);
			expect(r).toBeUndefined();
		});

		it("5xx 错误不通过 regex 检测 (RETRY-001: 5xx 走 BadRequestErrorRetries 当类型为 BadRequestError)", () => {
			const router = new Router({
				model_list: [mkDeployment("gpt-4")],
				routing_strategy: RoutingStrategyName.SimpleShuffle,
				num_retries: 0,
				retry_policy: { BadRequestErrorRetries: 4 },
			});
			// BadRequestError 兜底 5xx → 4
			const exc = new BadRequestError("Provider returned 503: something");
			const r = getRetryPolicyOverrideDelegate(
				exc,
				(router as unknown as { _retryPolicy: import("../types/router").RetryPolicy | undefined })._retryPolicy,
				"gpt-4",
				undefined,
			);
			expect(r).toBe(4);
		});

		it("5xx 裸 Error（无类型）→ undefined，RETRY-001 移除 regex 检测", () => {
			const router = new Router({
				model_list: [mkDeployment("gpt-4")],
				routing_strategy: RoutingStrategyName.SimpleShuffle,
				num_retries: 0,
				retry_policy: { BadRequestErrorRetries: 4 },
			});
			// message 含 503 字符串 — 之前会被 regex 误判
			const exc = new Error("Provider returned 503: something") as Error;
			const r = getRetryPolicyOverrideDelegate(
				exc,
				(router as unknown as { _retryPolicy: import("../types/router").RetryPolicy | undefined })._retryPolicy,
				"gpt-4",
				undefined,
			);
			// 裸 Error 不匹配任何 policy 类别 → undefined，回退到默认 maxRetries
			expect(r).toBeUndefined();
		});

		it("未配置 retry_policy → undefined (回退到默认 maxRetries)", () => {
			const router = new Router({
				model_list: [mkDeployment("gpt-4")],
				routing_strategy: RoutingStrategyName.SimpleShuffle,
				num_retries: 3,
			});
			const exc = new RateLimitError("rate");
			const r = getRetryPolicyOverrideDelegate(
				exc,
				(router as unknown as { _retryPolicy: import("../types/router").RetryPolicy | undefined })._retryPolicy,
				"gpt-4",
				undefined,
			);
			expect(r).toBeUndefined();
		});
	});
	describe("_executeWithFallback with mock fetch", () => {
		it("成功路径：返回 transformed response", async () => {
			mockFetch.mockResolvedValueOnce(
				okResponse({
					id: "chat-1",
					object: "chat.completion",
					created: 1,
					model: "gpt-4",
					choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
					usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
				}),
			);

			const router = new Router({
				model_list: [mkDeployment("gpt-4")],
				routing_strategy: RoutingStrategyName.SimpleShuffle,
				num_retries: 0,
			});

			const result = await router.completion("gpt-4", [{ role: "user", content: "hi" }]);
			expect(result.id).toBe("chat-1");
			const choices = result.choices as Array<{ message: { content: string } }>;
			expect(choices[0]!.message.content).toBe("hi");
		});

		it("mock_testing_fallbacks=true → 抛 InternalServerError 并触发 fallback chain", async () => {
			const router = new Router({
				model_list: [mkDeployment("gpt-4"), mkDeployment("gpt-4-fb")],
				routing_strategy: RoutingStrategyName.SimpleShuffle,
				num_retries: 0,
				fallbacks: [{ "gpt-4": ["gpt-4-fb"] }],
			});

			// 第二次 fetch (gpt-4-fb) 成功
			mockFetch.mockResolvedValueOnce(
				okResponse({
					id: "fb-1",
					object: "chat.completion",
					created: 1,
					model: "gpt-4-fb",
					choices: [{ index: 0, message: { role: "assistant", content: "fb-ok" }, finish_reason: "stop" }],
					usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
				}),
			);

			const result = await router.acompletion("gpt-4", [{ role: "user", content: "hi" }], {
				mock_testing_fallbacks: true,
			});
			expect(result.id).toBe("fb-1");
			// _provider 应是 fallback model_name
			expect((result as unknown as { _provider: string })._provider).toBe("gpt-4-fb");
		});

		it("mock_testing_context_fallbacks=true → 抛 ContextWindowExceededError 走 cw_fallbacks", async () => {
			const router = new Router({
				model_list: [mkDeployment("gpt-4"), mkDeployment("gpt-4-cw")],
				routing_strategy: RoutingStrategyName.SimpleShuffle,
				num_retries: 0,
				context_window_fallbacks: { "gpt-4": ["gpt-4-cw"] },
			});

			mockFetch.mockResolvedValueOnce(
				okResponse({
					id: "cw-1",
					object: "chat.completion",
					created: 1,
					model: "gpt-4-cw",
					choices: [{ index: 0, message: { role: "assistant", content: "cw-ok" }, finish_reason: "stop" }],
					usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
				}),
			);

			const result = await router.acompletion("gpt-4", [{ role: "user", content: "hi" }], {
				mock_testing_context_fallbacks: true,
			});
			expect(result.id).toBe("cw-1");
		});

		it("mock_testing_content_policy_fallbacks=true → 抛 ContentPolicyViolationError 走 cp_fallbacks", async () => {
			const router = new Router({
				model_list: [mkDeployment("gpt-4"), mkDeployment("gpt-4-cp")],
				routing_strategy: RoutingStrategyName.SimpleShuffle,
				num_retries: 0,
				content_policy_fallbacks: { "gpt-4": ["gpt-4-cp"] },
			});

			mockFetch.mockResolvedValueOnce(
				okResponse({
					id: "cp-1",
					object: "chat.completion",
					created: 1,
					model: "gpt-4-cp",
					choices: [{ index: 0, message: { role: "assistant", content: "cp-ok" }, finish_reason: "stop" }],
					usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
				}),
			);

			const result = await router.acompletion("gpt-4", [{ role: "user", content: "hi" }], {
				mock_testing_content_policy_fallbacks: true,
			});
			expect(result.id).toBe("cp-1");
		});
	});
	describe("DIFF-RT-02/RT-04: Router healthy=0 抛 RouterRateLimitErrorBasic 带 cooldown_time + cooldown_list", () => {
		it("无 deployment + 无 fallback → 抛 RouterRateLimitErrorBasic 带 cooldown_time", async () => {
			const router = new Router({
				model_list: [],
				routing_strategy: RoutingStrategyName.SimpleShuffle,
				num_retries: 0,
			});
			await expect(router.completion("nonexistent-model", [{ role: "user", content: "hi" }])).rejects.toMatchObject({
				name: "RouterRateLimitErrorBasic",
				model: "nonexistent-model",
			});
		});

		it("全部 deployment 冷却 + 无 fallback → cooldown_time > 0 + cooldown_list 存在", async () => {
			// 用 cooldown_time=1s 让 deployment 全部冷却
			const router = new Router({
				model_list: [mkDeployment("only-model")],
				routing_strategy: RoutingStrategyName.SimpleShuffle,
				num_retries: 0,
				cooldown_time: 1,
			});
			// 手动 markFailed 触发冷却
			(router as unknown as { _cooldownManager: { markFailed: (k: string, t: number) => void } })._cooldownManager.markFailed(
				"only-model",
				5000,
			);
			await expect(router.completion("only-model", [{ role: "user", content: "hi" }])).rejects.toMatchObject({
				name: "RouterRateLimitErrorBasic",
			});
			try {
				await router.completion("only-model", [{ role: "user", content: "hi" }]);
			} catch (err) {
				const e = err as { cooldown_time?: number; cooldown_list?: unknown[] };
				expect(e.cooldown_time).toBeGreaterThan(0);
				expect(Array.isArray(e.cooldown_list)).toBe(true);
				expect(e.cooldown_list!.length).toBeGreaterThan(0);
			}
		});
	});
	describe("DIFF-MOCK-01: mock_testing_* str-to-bool 转换", () => {
		it("mock_testing_fallbacks='true' 字符串被转 true boolean 并触发 fallback", async () => {
			const router = new Router({
				model_list: [mkDeployment("gpt-4"), mkDeployment("gpt-4-fb")],
				routing_strategy: RoutingStrategyName.SimpleShuffle,
				num_retries: 0,
				fallbacks: [{ "gpt-4": ["gpt-4-fb"] }],
			});
			mockFetch.mockResolvedValueOnce(
				okResponse({
					id: "str-mock-1",
					object: "chat.completion",
					created: 1,
					model: "gpt-4-fb",
					choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
					usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
				}),
			);
			// 'true' 字符串应被转为 true boolean
			const result = await router.acompletion("gpt-4", [{ role: "user", content: "hi" }], {
				mock_testing_fallbacks: "true" as unknown as boolean,
			});
			expect(result.id).toBe("str-mock-1");
		});

		it("mock_testing_fallbacks='1' 字符串被转 true boolean", async () => {
			const router = new Router({
				model_list: [mkDeployment("gpt-4"), mkDeployment("gpt-4-fb")],
				routing_strategy: RoutingStrategyName.SimpleShuffle,
				num_retries: 0,
				fallbacks: [{ "gpt-4": ["gpt-4-fb"] }],
			});
			mockFetch.mockResolvedValueOnce(
				okResponse({
					id: "str-mock-2",
					object: "chat.completion",
					created: 1,
					model: "gpt-4-fb",
					choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
					usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
				}),
			);
			const result = await router.acompletion("gpt-4", [{ role: "user", content: "hi" }], {
				mock_testing_fallbacks: "1" as unknown as boolean,
			});
			expect(result.id).toBe("str-mock-2");
		});

		it("mock_testing_fallbacks='False' 字符串保持 false (不触发)", async () => {
			const router = new Router({
				model_list: [mkDeployment("gpt-4")],
				routing_strategy: RoutingStrategyName.SimpleShuffle,
				num_retries: 0,
			});
			mockFetch.mockResolvedValueOnce(
				okResponse({
					id: "str-mock-3",
					object: "chat.completion",
					created: 1,
					model: "gpt-4",
					choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
					usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
				}),
			);
			// 'False' 字符串不转换（不在白名单 'true'/'1'/'True'）
			const result = await router.completion("gpt-4", [{ role: "user", content: "hi" }], {
				mock_testing_fallbacks: "False" as unknown as boolean,
			});
			expect(result.id).toBe("str-mock-3");
		});
	});
	describe("DIFF-004: per-deployment num_retries 覆盖（PY _set_deployment_num_retries_on_exception）", () => {
		it("exception 不带 num_retries 时回退到 deployment.litellm_params.num_retries", async () => {
			// DIFF-004: 单元测试 _executeWithFallback catch 块的 maxRetries 覆盖逻辑。
			// 不实际跑网络；用 mock fetch + 短 backoff（retry_after=0）走完 retry loop。
			const dep: Deployment = {
				model_name: "gpt-4",
				litellm_params: { model: "gpt-4", api_key: "k", num_retries: 2 },
				model_info: { id: "gpt-4" },
			};
			let callCount = 0;
			mockFetch.mockImplementation(() => {
				callCount++;
				return Promise.resolve(errorResponse(500));
			});
			const router = new Router({
				model_list: [dep],
				routing_strategy: RoutingStrategyName.SimpleShuffle,
				num_retries: 0, // 缺省 0；deployment 覆盖 2
				retry_after: 0,
			});
			await expect(router.completion("gpt-4", [{ role: "user", content: "hi" }])).rejects.toThrow();
			// 1 (首次) + 2 (deployment.litellm_params.num_retries) = 3 次
			expect(callCount).toBe(3);
		});

		it("exception 已带 num_retries 时优先用 exception 上的值", async () => {
			const dep: Deployment = {
				model_name: "gpt-4",
				litellm_params: { model: "gpt-4", api_key: "k", num_retries: 5 },
				model_info: { id: "gpt-4" },
			};
			// 自定义错误：仅允许 2 次重试
			let callCount = 0;
			mockFetch.mockImplementation(() => {
				callCount++;
				// 返回错误响应；categorizedError 会被设置 num_retries 通过 PY 路径
				return Promise.reject(Object.assign(new RateLimitError("rl"), { num_retries: 1 }));
			});
			const router = new Router({
				model_list: [dep],
				routing_strategy: RoutingStrategyName.SimpleShuffle,
				num_retries: 0,
				retry_after: 0,
			});
			await expect(router.completion("gpt-4", [{ role: "user", content: "hi" }])).rejects.toThrow();
			// exception.num_retries=1 应被保留（不被 deployment.litellm_params.num_retries=5 覆盖）
			// 1 (首次) + 1 (exception num_retries) = 2 次
			expect(callCount).toBe(2);
		});
	});
	describe("DIFF-015: mock_testing_fallbacks=true + no fallbacks 仍抛 InternalServerError", () => {
		it("mock_testing_fallbacks=true + 无 fallback chain → 抛 InternalServerError (对齐 PY router.py:5517-5526)", async () => {
			const { InternalServerError } = require("./RouterErrors") as typeof import("./RouterErrors");
			const router = new Router({
				model_list: [mkDeployment("gpt-4")],
				routing_strategy: RoutingStrategyName.SimpleShuffle,
				num_retries: 0,
				// 无 fallbacks
			});
			await expect(
				router.acompletion("gpt-4", [{ role: "user", content: "hi" }], { mock_testing_fallbacks: true }),
			).rejects.toBeInstanceOf(InternalServerError);
		});
	});
});
