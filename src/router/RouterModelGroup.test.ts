/**
 * Router 模型组缓存测试
 *
 * 拆分自 Router.test.ts：
 *   - DIFF-ROUTER-EDGE-01: countSameGroupDeployments model_info.model_name 别名
 *   - DIFF-008: model_group_info 缓存
 *   - DIFF-001: shouldRetryThisError raises categorizedError
 *
 * DIFF-T18: 测试通过 RouterTestDelegates 访问原 _xxx helper 逻辑，不再依赖 Router 私有方法。
 */
import { Router } from "./Router";
import type { Deployment } from "../types/router";
import { RoutingStrategyName } from "../types/router";
import {
	RateLimitError,
	AuthenticationError,
	BadRequestError,
	NotFoundError,
	ContextWindowExceededError,
	ContentPolicyViolationError,
} from "./RouterErrors";
import { installMockFetch, mkDeployment } from "./RouterTestHelpers";
import { shouldRetryThisErrorDelegate, countSameGroupDeploymentsDelegate, getDeploymentKeyDelegate } from "./RouterTestDelegates";

let mockFetch: jest.Mock;

beforeEach(() => {
	mockFetch = installMockFetch();
});

describe("Router model group cache", () => {
	describe("DIFF-ROUTER-EDGE-01: countSameGroupDeployments model_info.model_name 别名", () => {
		it("deployment 有 model_info.model_name 别名时按别名分组", () => {
			const dep1 = mkDeployment("gpt-4-actual-1", "gpt-4");
			const dep2 = mkDeployment("gpt-4-actual-2", "gpt-4");
			(dep1.model_info as unknown as { model_name: string }).model_name = "gpt-4-group";
			(dep2.model_info as unknown as { model_name: string }).model_name = "gpt-4-group";
			const deployments = [dep1, dep2];
			const count = countSameGroupDeploymentsDelegate(dep1, deployments);
			expect(count).toBe(2);
		});

		it("无 model_info.model_name 时回退到 deployment.model_name", () => {
			const deployments = [mkDeployment("gpt-4"), mkDeployment("gpt-4-other")];
			const count = countSameGroupDeploymentsDelegate(deployments[0]!, deployments);
			expect(count).toBe(1);
		});
	});
	describe("DIFF-008: model_group_info 缓存（PY test_cached_get_model_group_info）", () => {
		it("缓存 hit 后多次 countSameGroupDeployments 返回一致", () => {
			const deployments = [mkDeployment("gpt-4", "gpt-4"), mkDeployment("gpt-4-b", "gpt-4"), mkDeployment("gpt-3.5", "gpt-3.5")];
			const dep = deployments[0]!;
			const count1 = countSameGroupDeploymentsDelegate(dep, deployments);
			expect(count1).toBe(1);
			const count2 = countSameGroupDeploymentsDelegate(dep, deployments);
			expect(count2).toBe(1);
		});
	});
	describe("DIFF-001: shouldRetryThisError raises categorizedError (PY raise 行为)", () => {
		it("CW + 有 cw_fallbacks → 抛 ContextWindowExceededError", () => {
			const router = new Router({
				model_list: [mkDeployment("gpt-4"), mkDeployment("gpt-4-fb")],
				routing_strategy: RoutingStrategyName.SimpleShuffle,
				num_retries: 0,
				context_window_fallbacks: { "gpt-4": ["gpt-4-fb"] },
			});
			const exc = new ContextWindowExceededError("cw error");
			const fb = (router as unknown as { _fallbackHandler: unknown })._fallbackHandler;
			expect(() => {
				shouldRetryThisErrorDelegate(400, "gpt-4", fb as never, 2, 2, exc);
			}).toThrow(ContextWindowExceededError);
		});

		it("CP + 有 cp_fallbacks → 抛 ContentPolicyViolationError", () => {
			const router = new Router({
				model_list: [mkDeployment("gpt-4"), mkDeployment("gpt-4-cp")],
				routing_strategy: RoutingStrategyName.SimpleShuffle,
				num_retries: 0,
				content_policy_fallbacks: { "gpt-4": ["gpt-4-cp"] },
			});
			const exc = new ContentPolicyViolationError("cp error");
			const fb = (router as unknown as { _fallbackHandler: unknown })._fallbackHandler;
			expect(() => {
				shouldRetryThisErrorDelegate(400, "gpt-4", fb as never, 2, 2, exc);
			}).toThrow(ContentPolicyViolationError);
		});

		it("422 (非白名单) → 抛 BadRequestError (保留 categorizedError)", () => {
			const router = new Router({
				model_list: [mkDeployment("gpt-4")],
				routing_strategy: RoutingStrategyName.SimpleShuffle,
				num_retries: 3,
			});
			const exc = new BadRequestError("unprocessable");
			const fb = (router as unknown as { _fallbackHandler: unknown })._fallbackHandler;
			expect(() => {
				shouldRetryThisErrorDelegate(422, "gpt-4", fb as never, 1, 1, exc);
			}).toThrow(BadRequestError);
		});

		it("NotFound (404) → 抛 NotFoundError", () => {
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

		it("Auth + 单部署 → 抛 AuthenticationError", () => {
			const router = new Router({
				model_list: [mkDeployment("gpt-4")],
				routing_strategy: RoutingStrategyName.SimpleShuffle,
				num_retries: 3,
			});
			const exc = new AuthenticationError("auth fail");
			const fb = (router as unknown as { _fallbackHandler: unknown })._fallbackHandler;
			expect(() => {
				shouldRetryThisErrorDelegate(401, "gpt-4", fb as never, 1, 1, exc);
			}).toThrow(AuthenticationError);
		});

		it("5xx → return true (重试)", () => {
			const router = new Router({
				model_list: [mkDeployment("gpt-4"), mkDeployment("gpt-4-b")],
				routing_strategy: RoutingStrategyName.SimpleShuffle,
				num_retries: 3,
			});
			const exc = new Error("server error") as Error;
			const fb = (router as unknown as { _fallbackHandler: unknown })._fallbackHandler;
			const result = shouldRetryThisErrorDelegate(500, "gpt-4", fb as never, 2, 2, exc);
			expect(result).toBe(true);
		});

		it("getDeploymentKey 回退：model_info.id 缺省时使用 model_name", () => {
			const depNoId: Deployment = {
				model_name: "no-id-model",
				litellm_params: { model: "gpt-4", api_key: "k" },
				model_info: {},
			};
			const key = getDeploymentKeyDelegate(depNoId);
			expect(key).toBe("no-id-model");
		});
	});
});

// Suppress unused warning
void RateLimitError;
void installMockFetch;
