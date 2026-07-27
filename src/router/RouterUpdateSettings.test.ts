/**
 * Router 运行时更新测试（批次 C1/C3）
 *
 * 锁定 Python Router.update_settings（router.py:8491-8540）与
 * upsert_deployment / delete_deployment 的 TS 对齐行为：
 * - updateSettings 白名单热更新（fallbacks 链缓存失效后走新链）
 * - 整型设置 int 转换（num_retries / cooldown_time / retry_after）
 * - routing_strategy 热切换；未知策略抛错（对齐 PY routing_strategy_init 失败）
 * - 非白名单键忽略（PY 仅 debug 日志）
 * - upsertDeployment 同 model_id 替换 / 同参数 no-op；removeDeployment 按 id 移除
 */
import { Router } from "./Router";
import { RoutingStrategyName } from "../types/router";
import type { Deployment, RouterConfig } from "../types/router";

function makeDeployment(modelName: string, id?: string, apiBase?: string): Deployment {
	return {
		model_name: modelName,
		litellm_params: { model: `openai/${modelName}`, ...(apiBase !== undefined ? { api_base: apiBase } : {}) },
		...(id !== undefined ? { model_info: { id: id } } : {}),
	};
}

function makeRouter(overrides: Partial<RouterConfig> = {}): Router {
	return new Router({
		model_list: [makeDeployment("gpt-4o", "dep-1")],
		routing_strategy: RoutingStrategyName.SimpleShuffle,
		num_retries: 2,
		...overrides,
	});
}

/**
 * 读取 Router 私有字段（仅测试用，与 container.test.ts 同模式）
 * @param router
 */
function routerInternals(router: Router): { _numRetries: number; _cooldownTimeMs: number; _retryAfter: number } {
	return router as unknown as { _numRetries: number; _cooldownTimeMs: number; _retryAfter: number };
}

describe("Router.updateSettings — fallbacks 热更新", () => {
	it("热改 fallback 后 getNextFallback 走新链（旧链缓存失效）", () => {
		const router = makeRouter({ fallbacks: [{ "gpt-4o": ["gpt-4o-mini"] }] });
		// 先读一次旧链，填充 FallbackHandler 链缓存
		expect(router.getNextFallback("gpt-4o", 0)).toBe("gpt-4o-mini");

		router.updateSettings({ fallbacks: [{ "gpt-4o": ["claude-haiku", "gpt-3.5-turbo"] }] });

		expect(router.getNextFallback("gpt-4o", 0)).toBe("claude-haiku");
		expect(router.getNextFallback("gpt-4o", 1)).toBe("gpt-3.5-turbo");
	});

	it("清空 fallbacks 后不再有任何回退", () => {
		const router = makeRouter({ fallbacks: [{ "gpt-4o": ["gpt-4o-mini"] }] });
		expect(router.getNextFallback("gpt-4o", 0)).toBe("gpt-4o-mini");

		router.updateSettings({ fallbacks: [] });

		expect(router.getNextFallback("gpt-4o", 0)).toBeNull();
	});

	it("context_window_fallbacks 热更新生效", () => {
		const router = makeRouter({ context_window_fallbacks: { "gpt-4o": ["gpt-4o-mini"] } });
		const internals = router as unknown as { _fallbackHandler: { getContextWindowFallbackChain: (m: string) => string[] } };
		expect(internals._fallbackHandler.getContextWindowFallbackChain("gpt-4o")).toEqual(["gpt-4o-mini"]);

		router.updateSettings({ context_window_fallbacks: { "gpt-4o": ["gpt-3.5-turbo"] } });

		expect(internals._fallbackHandler.getContextWindowFallbackChain("gpt-4o")).toEqual(["gpt-3.5-turbo"]);
	});

	it("model_group_alias 热更新生效（alias 解析走 FallbackHandler）", () => {
		const router = makeRouter();
		expect(router.getNextFallback("alias-model", 0)).toBeNull();

		router.updateSettings({
			model_group_alias: { "alias-model": "gpt-4o" },
			fallbacks: [{ "gpt-4o": ["gpt-4o-mini"] }],
		});

		// alias-model → gpt-4o → fallback gpt-4o-mini
		expect(router.getNextFallback("alias-model", 0)).toBe("gpt-4o-mini");
	});
});

describe("Router web-search target candidates", () => {
	it("仅返回去重的逻辑模型名和 alias key，并随 alias 热更新", () => {
		const router = makeRouter({
			model_list: [makeDeployment("gpt-4o", "dep-1"), makeDeployment("gpt-4o", "dep-2"), makeDeployment("claude", "dep-3")],
			model_group_alias: { websearch_alias: "openai/gpt-4o", invalid_alias: "openai/provider-secret" },
		});
		expect(router.getAvailableModelNames()).toEqual([
			{ model_name: "claude", type: "model", mode: "chat" },
			{ model_name: "gpt-4o", type: "model", mode: "chat" },
			{ model_name: "websearch_alias", type: "alias", mode: "chat" },
		]);
		router.updateSettings({ model_group_alias: { refreshed_alias: "gpt-4o", invalid_alias: "provider-secret" } });
		expect(router.getAvailableModelNames()).toEqual([
			{ model_name: "claude", type: "model", mode: "chat" },
			{ model_name: "gpt-4o", type: "model", mode: "chat" },
			{ model_name: "refreshed_alias", type: "alias", mode: "chat" },
		]);
	});
});

describe("Router.updateSettings — 标量与白名单语义", () => {
	it("num_retries / cooldown_time / retry_after 按 PY _int_settings 做 int 转换", () => {
		const router = makeRouter({ cooldown_time: 5, retry_after: 0 });
		router.updateSettings({ num_retries: "7", cooldown_time: 30, retry_after: 3 });
		const internals = routerInternals(router);
		expect(internals._numRetries).toBe(7);
		expect(internals._cooldownTimeMs).toBe(30_000);
		expect(internals._retryAfter).toBe(3);
	});

	it("routing_strategy 热切换生效；未知策略抛错（对齐 PY routing_strategy_init）", () => {
		const router = makeRouter();
		router.updateSettings({ routing_strategy: "least-busy" });
		const internals = router as unknown as { _routeFn: unknown };
		expect(internals._routeFn).toBeDefined();
		expect(() => router.updateSettings({ routing_strategy: "not-a-strategy" })).toThrow(/Unknown routing strategy/);
	});

	it("非白名单键忽略（PY 仅 debug 日志，不抛错）", () => {
		const router = makeRouter();
		const before = routerInternals(router)._numRetries;
		expect(() => router.updateSettings({ some_random_key: 1, max_fallbacks: 99 })).not.toThrow();
		expect(routerInternals(router)._numRetries).toBe(before);
	});

	it("白名单内但 TS 无运行时消费方的键（timeout / max_retries / routing_strategy_args）静默跳过", () => {
		const router = makeRouter();
		expect(() => router.updateSettings({ timeout: 600, max_retries: 3, routing_strategy_args: {} })).not.toThrow();
	});

	it("allowed_fails 数字与分类阈值对象均可热更新到 CooldownManager", () => {
		const router = makeRouter();
		const cooldown = router as unknown as { _cooldownManager: { _allowedFails: unknown } };
		router.updateSettings({ allowed_fails: 3 });
		expect(cooldown._cooldownManager._allowedFails).toBe(3);
		router.updateSettings({ allowed_fails: { RateLimitError: 1 } });
		expect(cooldown._cooldownManager._allowedFails).toEqual({ RateLimitError: 1 });
	});
});

describe("Router deployment 增删改（upsert/remove，对齐 PY upsert_deployment/delete_deployment）", () => {
	it("upsertDeployment：无同 id 时追加，hasModel 立即可路由", () => {
		const router = makeRouter();
		expect(router.hasModel("new-model")).toBe(false);
		const changed = router.upsertDeployment(makeDeployment("new-model", "dep-new"));
		expect(changed).toBe(true);
		expect(router.hasModel("new-model")).toBe(true);
		expect(router.getDeployment("dep-new")?.model_name).toBe("new-model");
	});

	it("upsertDeployment：同 model_id 替换 litellm_params（同 model_id DB 优先语义）", () => {
		const router = makeRouter();
		const changed = router.upsertDeployment(makeDeployment("renamed", "dep-1", "https://db.example.com"));
		expect(changed).toBe(true);
		const deployments = router.getDeployments();
		expect(deployments.filter((d) => d.model_info?.id === "dep-1")).toHaveLength(1);
		expect(deployments[0]?.model_name).toBe("renamed");
		expect(deployments[0]?.litellm_params["api_base"]).toBe("https://db.example.com");
	});

	it("upsertDeployment：同 id 同参数 no-op", () => {
		const router = makeRouter();
		const existing = router.getDeployments()[0]!;
		const changed = router.upsertDeployment({ ...existing, litellm_params: { ...existing.litellm_params } });
		expect(changed).toBe(false);
		expect(router.getDeployments()).toHaveLength(1);
	});

	it("upsertDeployment：同 id、同参数但 model_name 改名时必须替换", () => {
		const router = makeRouter();
		const existing = router.getDeployments()[0]!;
		const changed = router.upsertDeployment({
			...existing,
			model_name: "renamed-only",
			litellm_params: { ...existing.litellm_params },
		});
		expect(changed).toBe(true);
		expect(router.getDeployment("dep-1")?.model_name).toBe("renamed-only");
		expect(router.hasModel("gpt-4o")).toBe(false);
		expect(router.hasModel("renamed-only")).toBe(true);
	});

	it("removeDeployment：按 model_id 移除后不再可路由；未知 id 返回 false", () => {
		const router = makeRouter();
		expect(router.removeDeployment("dep-1")).toBe(true);
		expect(router.hasModel("gpt-4o")).toBe(false);
		expect(router.removeDeployment("dep-1")).toBe(false);
	});
});
