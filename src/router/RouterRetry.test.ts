/**
 * Router 重试策略测试
 *
 * 拆分自 Router.test.ts：
 *   - calculateBackoff (exponential + jitter + 60s cap)
 *   - shouldRetryThisError 分支
 *   - timeToSleepBeforeRetry 单部署豁免
 *   - parseRetryAfterSeconds 60s cap
 *   - DIFF-RT-01: max/min 顺序
 *
 * DIFF-T18: 测试通过 RouterTestDelegates 访问原 _xxx helper 逻辑，不再依赖 Router 私有方法。
 */
import { Router } from "./Router";
import { RoutingStrategyName } from "../types/router";
import { RateLimitError, AuthenticationError, BadRequestError, NotFoundError, ContextWindowExceededError } from "./RouterErrors";
import { installMockFetch, mkDeployment } from "./RouterTestHelpers";
import {
	shouldRetryThisErrorDelegate,
	timeToSleepBeforeRetryDelegate,
	parseRetryAfterSecondsDelegate,
	calculateBackoffDelegate,
} from "./RouterTestDelegates";

let mockFetch: jest.Mock;

beforeEach(() => {
	mockFetch = installMockFetch();
});

describe("Router retry policy", () => {
	describe("calculateBackoff (tested via timeToSleepBeforeRetry)", () => {
		it("exponential + jitter + 60s cap (对齐 PY _calculate_retry_after)", () => {
			const router = new Router({
				model_list: [mkDeployment("gpt-4")],
				routing_strategy: RoutingStrategyName.SimpleShuffle,
				num_retries: 0,
			});
			const exc = new RateLimitError("rate");
			const retryAfter = (router as unknown as { _retryAfter: number })._retryAfter;
			const t1 = timeToSleepBeforeRetryDelegate({
				error: exc,
				_remainingRetries: 0,
				numRetries: 0,
				healthyDeployments: [],
				allDeployments: [mkDeployment("gpt-4")],
				retryAfterHeader: undefined,
				retryAfterSec: retryAfter,
			});
			expect(t1).toBeGreaterThanOrEqual(0.5);
			expect(t1).toBeLessThan(1.5);
		});
	});
	describe("shouldRetryThisError (对齐 PY should_retry_this_error)", () => {
		it("CW + 有 cw_fallbacks → throw（不重试，让 fallback 处理）", () => {
			const router = new Router({
				model_list: [mkDeployment("gpt-4"), mkDeployment("gpt-4-fallback")],
				routing_strategy: RoutingStrategyName.SimpleShuffle,
				num_retries: 3,
				context_window_fallbacks: { "gpt-4": ["gpt-4-fallback"] },
			});
			const exc = new ContextWindowExceededError("context_length_exceeded");
			const fb = (router as unknown as { _fallbackHandler: unknown })._fallbackHandler;
			expect(() => {
				shouldRetryThisErrorDelegate(400, "gpt-4", fb as never, 2, 2, exc);
			}).toThrow(ContextWindowExceededError);
		});

		it("CW + 无 cw_fallbacks → throw", () => {
			const router = new Router({
				model_list: [mkDeployment("gpt-4")],
				routing_strategy: RoutingStrategyName.SimpleShuffle,
				num_retries: 3,
			});
			const exc = new ContextWindowExceededError("context window");
			const fb = (router as unknown as { _fallbackHandler: unknown })._fallbackHandler;
			expect(() => {
				shouldRetryThisErrorDelegate(400, "gpt-4", fb as never, 1, 1, exc);
			}).toThrow(ContextWindowExceededError);
		});

		it("4xx (非 401/403/404/408/429) → throw BadRequestError", () => {
			const router = new Router({
				model_list: [mkDeployment("gpt-4")],
				routing_strategy: RoutingStrategyName.SimpleShuffle,
				num_retries: 3,
			});
			const exc = new BadRequestError("bad request");
			const fb = (router as unknown as { _fallbackHandler: unknown })._fallbackHandler;
			expect(() => {
				shouldRetryThisErrorDelegate(400, "gpt-4", fb as never, 1, 1, exc);
			}).toThrow(BadRequestError);
		});

		it("NotFoundError (404) → throw NotFoundError", () => {
			const router = new Router({
				model_list: [mkDeployment("gpt-4")],
				routing_strategy: RoutingStrategyName.SimpleShuffle,
				num_retries: 3,
			});
			const exc = new NotFoundError("not found");
			const fb = (router as unknown as { _fallbackHandler: unknown })._fallbackHandler;
			expect(() => {
				shouldRetryThisErrorDelegate(404, "gpt-4", fb as never, 1, 1, exc);
			}).toThrow(NotFoundError);
		});

		it("429 + 无 healthy deployment + 有 fallbacks → throw RateLimitError (raise 让 fallback 处理)", () => {
			const router = new Router({
				model_list: [mkDeployment("gpt-4")],
				routing_strategy: RoutingStrategyName.SimpleShuffle,
				num_retries: 3,
				fallbacks: [{ "gpt-4": ["gpt-4-fallback"] }],
			});
			const exc = new RateLimitError("rate");
			router.markFailed("gpt-4");
			const fb = (router as unknown as { _fallbackHandler: unknown })._fallbackHandler;
			expect(() => {
				shouldRetryThisErrorDelegate(429, "gpt-4", fb as never, 1, 0, exc);
			}).toThrow(RateLimitError);
		});

		it("Auth + 单部署 → throw AuthenticationError", () => {
			const router = new Router({
				model_list: [mkDeployment("gpt-4")],
				routing_strategy: RoutingStrategyName.SimpleShuffle,
				num_retries: 3,
			});
			const exc = new AuthenticationError("auth");
			const fb = (router as unknown as { _fallbackHandler: unknown })._fallbackHandler;
			expect(() => {
				shouldRetryThisErrorDelegate(401, "gpt-4", fb as never, 1, 1, exc);
			}).toThrow(AuthenticationError);
		});

		it("healthy=0 + 任何错误 → throw（保留原异常）", () => {
			const router = new Router({
				model_list: [mkDeployment("gpt-4")],
				routing_strategy: RoutingStrategyName.SimpleShuffle,
				num_retries: 3,
			});
			router.markFailed("gpt-4");
			const exc = new Error("server error") as Error;
			const fb = (router as unknown as { _fallbackHandler: unknown })._fallbackHandler;
			expect(() => {
				shouldRetryThisErrorDelegate(500, "gpt-4", fb as never, 1, 0, exc);
			}).toThrow();
		});
	});
	describe("timeToSleepBeforeRetry 单部署豁免", () => {
		it("单部署 + healthy=1 → 走 backoff (不返回 0)", () => {
			const router = new Router({
				model_list: [mkDeployment("gpt-4")],
				routing_strategy: RoutingStrategyName.SimpleShuffle,
				num_retries: 3,
			});
			const retryAfter = (router as unknown as { _retryAfter: number })._retryAfter;
			const allDeps = [mkDeployment("gpt-4")];
			const healthyDeps = [mkDeployment("gpt-4")];
			const t = timeToSleepBeforeRetryDelegate({
				error: new Error("err"),
				_remainingRetries: 2,
				numRetries: 0,
				healthyDeployments: healthyDeps,
				allDeployments: allDeps,
				retryAfterHeader: undefined,
				retryAfterSec: retryAfter,
			});
			expect(t).toBeGreaterThan(0);
		});

		it("多部署 + healthy>0 → 立即重试 (return 0)", () => {
			const router = new Router({
				model_list: [mkDeployment("gpt-4"), mkDeployment("gpt-4-b")],
				routing_strategy: RoutingStrategyName.SimpleShuffle,
				num_retries: 3,
			});
			const retryAfter = (router as unknown as { _retryAfter: number })._retryAfter;
			const allDeps = [mkDeployment("gpt-4"), mkDeployment("gpt-4-b")];
			const healthyDeps = [mkDeployment("gpt-4-b")];
			const t = timeToSleepBeforeRetryDelegate({
				error: new Error("err"),
				_remainingRetries: 2,
				numRetries: 0,
				healthyDeployments: healthyDeps,
				allDeployments: allDeps,
				retryAfterHeader: undefined,
				retryAfterSec: retryAfter,
			});
			expect(t).toBe(0);
		});
	});
	describe("parseRetryAfterSeconds (60s cap)", () => {
		it("整数 <= 60s 接受", () => {
			expect(parseRetryAfterSecondsDelegate("30")).toBe(30);
		});

		it("整数 > 60s 返回 null (60s cap)", () => {
			expect(parseRetryAfterSecondsDelegate("120")).toBeNull();
		});

		it("DIFF-RT-RETRY-01: Retry-After: 0 返回 null (无效值，走指数退避)", () => {
			expect(parseRetryAfterSecondsDelegate("0")).toBeNull();
		});

		it("DIFF-RT-RETRY-01: Retry-After: 9999 远超 60s 上限返回 null", () => {
			expect(parseRetryAfterSecondsDelegate("9999")).toBeNull();
		});

		it("DIFF-RT-RETRY-01: Retry-After: 60 边界值 (恰好 60s) 接受", () => {
			expect(parseRetryAfterSecondsDelegate("60")).toBe(60);
		});

		it("DIFF-RT-RETRY-01: HTTP-date 格式（10s 后）解析后接受", () => {
			const future = new Date(Date.now() + 30_000);
			const httpDate = future.toUTCString();
			const r = parseRetryAfterSecondsDelegate(httpDate);
			expect(r).not.toBeNull();
			expect(r!).toBeGreaterThan(0);
			expect(r!).toBeLessThanOrEqual(60);
		});
	});
	describe("DIFF-RT-01: calculateBackoff max/min 顺序（floor 先于 cap）", () => {
		it("retry_after=10 + numRetries=0 → baseMs floor 到 10000ms (max(500,10000))", () => {
			// PY 顺序：sleep = 500*2^0 = 500; sleep = max(500, 10000) = 10000;
			//         sleep = min(10000, 8000) = 8000 (cap); + jitter
			// TS 旧版颠倒顺序 max 后 min，结果是 min(500, 8000) → 500 (错)
			// 修正后：baseMs 应该是 min(max(500, 10000), 8000) = 8000ms
			const r = calculateBackoffDelegate(0, 10);
			// sleep = 8.0 + jitter[0..0.75] = 8.0..8.75 秒
			expect(r).toBeGreaterThanOrEqual(8.0);
			expect(r).toBeLessThan(8.8);
		});

		it("retry_after=2 (min_timeoutMs=2000) 提升下限（floor）", () => {
			const r = calculateBackoffDelegate(0, 2);
			// baseMs = max(500, 2000) = 2000; min(2000, 8000) = 2000ms
			// sleep = 2.0 + jitter[0..0.75] = 2.0..2.75 秒
			expect(r).toBeGreaterThanOrEqual(2.0);
			expect(r).toBeLessThan(2.8);
		});
	});
});

// Suppress unused warnings
void installMockFetch;
