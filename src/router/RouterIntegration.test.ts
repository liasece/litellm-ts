/**
 * Router 集成测试（DIFF / 注入）
 *
 * 拆分自 Router.test.ts：
 *   - DIFF-012: Router 接受 redis_cooldown_client 注入 RedisCooldownBackend
 */
import { Router } from "./Router";
import { installMockFetch, mkDeployment } from "./RouterTestHelpers";
import { RoutingStrategyName } from "../types/router";

let mockFetch: jest.Mock;

beforeEach(() => {
	mockFetch = installMockFetch();
});

describe("Router integration", () => {
	describe("DIFF-012: Router 接受 redis_cooldown_client 注入 RedisCooldownBackend", () => {
		it("提供 redis client 后 CooldownManager._cacheBackend 是 RedisCooldownBackend", async () => {
			const { RedisCooldownBackend } = require("./RedisCooldownBackend") as typeof import("./RedisCooldownBackend");
			const mockRedis = {
				set: jest.fn().mockResolvedValue("OK"),
				get: jest.fn().mockResolvedValue(null),
				del: jest.fn().mockResolvedValue(1),
				expire: jest.fn().mockResolvedValue(1),
			};
			const router = new Router({
				model_list: [mkDeployment("gpt-4")],
				routing_strategy: RoutingStrategyName.SimpleShuffle,
				num_retries: 0,
				redis_cooldown_client: mockRedis,
			});
			const cm = (router as unknown as { _cooldownManager: { _cacheBackend?: unknown } })._cooldownManager;
			expect(cm._cacheBackend).toBeInstanceOf(RedisCooldownBackend);
		});

		it("未提供 redis client 时 _cacheBackend 为 undefined", () => {
			const router = new Router({
				model_list: [mkDeployment("gpt-4")],
				routing_strategy: RoutingStrategyName.SimpleShuffle,
				num_retries: 0,
			});
			const cm = (router as unknown as { _cooldownManager: { _cacheBackend?: unknown } })._cooldownManager;
			expect(cm._cacheBackend).toBeUndefined();
		});
	});
});
