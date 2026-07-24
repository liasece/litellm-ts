/**
 * AnthropicUpstreamDispatch 单元测试
 *
 * 覆盖：
 * - stripProviderPrefix：provider 前缀剥离
 * - buildUpstreamAttempt：upstreamModel / api_key 兜底 / 无 deployment 返回 null
 * - requireUpstreamAttempt：模型不存在抛 400（PY ProxyModelNotFoundError）；
 *   模型存在但全部署冷却抛 429（Python 风格 no-deployments 消息）
 * - executeWithFallbackChain：
 *   - 直连成功（不触发 fallback）
 *   - provider 400 失败 → fallback 链下一跳成功（GLM 1211 场景，400 也 fallback）
 *   - 同组多 deployment：第一个失败后同组第二个继续承担
 *   - 失败未入冷却时同一 deployment 不重复尝试（attemptedDeploymentKeys 防死循环）
 *   - 链耗尽抛最后一个 provider 错误（保留 HTTP 状态码）
 *   - 模型不存在抛 400 / 模型存在但全冷却抛 429
 */
import { ApiError } from "../core/api/ApiError";
import type { Deployment } from "../types/router";
import type { ProviderConfig, ProviderRequest } from "../types/provider";
import type { ModelResponse } from "../types/openai";
import {
	ProviderUpstreamError,
	buildUpstreamAttempt,
	executeWithFallbackChain,
	requireUpstreamAttempt,
	stripProviderPrefix,
	type FallbackExecutionStats,
	type FallbackRouterFacade,
	type UpstreamAttempt,
} from "./AnthropicUpstreamDispatch";

// ========== Mock 构造 ==========

function makeDeployment(modelName: string, upstreamModel: string, deploymentId?: string): Deployment {
	return {
		model_name: modelName,
		litellm_params: { model: upstreamModel, api_key: `key-for-${modelName}` },
		model_info: deploymentId !== undefined ? { id: deploymentId } : undefined,
	} as Deployment;
}

/** 最小 ProviderConfig mock：transformRequest 产出固定 URL/headers */
function makeProvider(): ProviderConfig {
	const provider = {
		transformRequest: function (model: string, _messages: unknown, _params: Record<string, unknown>): ProviderRequest {
			return {
				url: `http://upstream.test/v1/messages?for=${model}`,
				method: "POST",
				headers: { authorization: "Bearer x" },
				body: {},
				model: model,
			};
		},
		transformResponse: function (_model: string, rawResponse: unknown): ModelResponse {
			return rawResponse as ModelResponse;
		},
	};
	return provider as unknown as ProviderConfig;
}

interface MockFacadeOptions {
	/** model → 可用 deployment 列表（按组） */
	deploymentsByModel: Record<string, Deployment[]>;
	/** fallback 链：model → 下一跳列表（按 depth 取） */
	fallbackChains?: Record<string, string[]>;
	/** recordDeploymentFailure 是否模拟冷却生效（true 时该 deployment 从可用列表移除） */
	cooldownOnFailure?: boolean;
	/** model → alias 解析结果 */
	modelResolutions?: Record<string, { inputModel: string; resolvedModel: string; resolutionPath: readonly string[] }>;
}

class MockRouterFacade implements FallbackRouterFacade {
	readonly failures: Array<{ deploymentKey: string; error: Error }> = [];
	readonly successes: string[] = [];
	readonly maxFallbacks: number = 10;
	private readonly _cooledDown = new Set<string>();
	private readonly _options: MockFacadeOptions;

	constructor(options: MockFacadeOptions) {
		this._options = options;
	}

	getAvailableDeployment(model: string): { deployment: Deployment; provider: ProviderConfig } | null {
		const deployments = this._options.deploymentsByModel[model] ?? [];
		const healthy = deployments.find((dep) => !this._cooledDown.has(dep.model_info?.id ?? dep.model_name));
		if (!healthy) {
			return null;
		}
		return { deployment: healthy, provider: makeProvider() };
	}

	getNextFallback(model: string, fallbackDepth: number): string | null {
		const chain = this._options.fallbackChains?.[model] ?? [];
		return chain[fallbackDepth] ?? null;
	}

	resolveModelGroupWithTrace(model: string) {
		return this._options.modelResolutions?.[model] ?? { inputModel: model, resolvedModel: model, resolutionPath: [model] };
	}

	recordDeploymentSuccess(deployment: Deployment): void {
		this.successes.push(deployment.model_info?.id ?? deployment.model_name);
	}

	recordDeploymentFailure(deployment: Deployment, error: Error): void {
		const key = deployment.model_info?.id ?? deployment.model_name;
		this.failures.push({ deploymentKey: key, error: error });
		if (this._options.cooldownOnFailure === true) {
			this._cooledDown.add(key);
		}
	}

	hasModel(model: string): boolean {
		return model in this._options.deploymentsByModel;
	}

	getNoAvailableDeploymentInfo() {
		return { cooldownSeconds: 60, cooldownList: [], preCallChecks: true };
	}
}

// ========== stripProviderPrefix ==========

describe("stripProviderPrefix", () => {
	it("剥离 provider 前缀", () => {
		expect(stripProviderPrefix("anthropic/glm-4.7")).toBe("glm-4.7");
		expect(stripProviderPrefix("anthropic/deepseek-v4-flash")).toBe("deepseek-v4-flash");
	});

	it("无前缀时原样返回", () => {
		expect(stripProviderPrefix("glm-4.7")).toBe("glm-4.7");
	});
});

// ========== buildUpstreamAttempt ==========

describe("buildUpstreamAttempt", () => {
	it("upstreamModel 剥离 provider 前缀，URL/headers 来自 provider.transformRequest", () => {
		const facade = new MockRouterFacade({
			deploymentsByModel: { "glm-4-7-anthropic": [makeDeployment("glm-4-7-anthropic", "anthropic/glm-4.7")] },
		});
		const attempt = buildUpstreamAttempt(facade, "glm-4-7-anthropic");
		expect(attempt).not.toBeNull();
		expect(attempt!.upstreamModel).toBe("glm-4.7");
		expect(attempt!.upstreamUrl).toContain("anthropic/glm-4.7");
		expect(attempt!.upstreamHeaders["authorization"]).toBe("Bearer x");
	});

	it("无可用 deployment 返回 null", () => {
		const facade = new MockRouterFacade({ deploymentsByModel: {} });
		expect(buildUpstreamAttempt(facade, "missing-model")).toBeNull();
	});
});

// ========== requireUpstreamAttempt ==========

describe("requireUpstreamAttempt", () => {
	it("模型不存在 → ApiError 400（PY ProxyModelNotFoundError，message 带 400: 前缀）", () => {
		const facade = new MockRouterFacade({ deploymentsByModel: {} });
		let caught: unknown;
		try {
			requireUpstreamAttempt(facade, "missing-model");
		} catch (err) {
			caught = err;
		}
		expect(caught).toBeInstanceOf(ApiError);
		expect((caught as ApiError).statusCode).toBe(400);
		expect((caught as ApiError).message).toBe(
			"400: {'error': 'anthropic_messages: Invalid model name passed in model=missing-model. Call `/v1/models` to view available models for your key.'}",
		);
		expect((caught as ApiError).errorType).toBe("None");
		expect((caught as ApiError).param).toBe("None");
	});

	it("模型存在但全部署冷却 → ApiError 429（Python 风格 no-deployments 消息）", () => {
		const facade = new MockRouterFacade({
			deploymentsByModel: { "known-model": [makeDeployment("known-model", "anthropic/known")] },
			cooldownOnFailure: true,
		});
		// 手动冷却唯一 deployment，使 getAvailableDeployment 返回 null
		facade.recordDeploymentFailure(makeDeployment("known-model", "anthropic/known"), new Error("cool"));
		let caught: unknown;
		try {
			requireUpstreamAttempt(facade, "known-model");
		} catch (err) {
			caught = err;
		}
		expect(caught).toBeInstanceOf(ApiError);
		expect((caught as ApiError).statusCode).toBe(429);
		expect((caught as ApiError).message).toContain("No deployments available for selected model");
		expect((caught as ApiError).message).toContain("Passed model=known-model");
	});
});

// ========== executeWithFallbackChain ==========

describe("executeWithFallbackChain", () => {
	it("直连成功：不触发 fallback，登记 recordDeploymentSuccess", async () => {
		const facade = new MockRouterFacade({
			deploymentsByModel: { "deepseek-coder-anthropic": [makeDeployment("deepseek-coder-anthropic", "anthropic/deepseek-v4-flash")] },
		});
		const seenModels: string[] = [];
		const result = await executeWithFallbackChain(
			facade,
			"deepseek-coder-anthropic",
			undefined,
			undefined,
			async (attempt: UpstreamAttempt) => {
				seenModels.push(attempt.upstreamModel);
				return "ok";
			},
		);
		expect(result).toBe("ok");
		expect(seenModels).toEqual(["deepseek-v4-flash"]);
		expect(facade.successes).toEqual(["deepseek-coder-anthropic"]);
		expect(facade.failures).toEqual([]);
	});

	it("记录初始与 fallback alias 路径，同组 deployment 重试不重复追加", async () => {
		const facade = new MockRouterFacade({
			deploymentsByModel: {
				"request-alias": [
					makeDeployment("request-model", "anthropic/model-a", "dep-1"),
					makeDeployment("request-model", "anthropic/model-a-backup", "dep-2"),
				],
				"fallback-alias": [makeDeployment("fallback-model", "anthropic/model-b")],
			},
			fallbackChains: { "request-alias": ["fallback-alias"] },
			modelResolutions: {
				"request-alias": {
					inputModel: "request-alias",
					resolvedModel: "request-model",
					resolutionPath: ["request-alias", "request-model"],
				},
				"fallback-alias": {
					inputModel: "fallback-alias",
					resolvedModel: "fallback-model",
					resolutionPath: ["fallback-alias", "fallback-model"],
				},
			},
			cooldownOnFailure: true,
		});
		const stats: FallbackExecutionStats = { fallbackDepth: 0 };
		const seen: string[] = [];
		const result = await executeWithFallbackChain(
			facade,
			"request-alias",
			undefined,
			undefined,
			async (attempt) => {
				seen.push(attempt.deploymentKey);
				throw new ProviderUpstreamError(500, "failed");
			},
			stats,
		).catch(() => "failed");
		expect(result).toBe("failed");
		expect(stats.modelResolutionChain).toEqual([
			{
				fallback_index: 0,
				input_model: "request-alias",
				resolved_model: "request-model",
				resolution_path: ["request-alias", "request-model"],
			},
			{
				fallback_index: 1,
				input_model: "fallback-alias",
				resolved_model: "fallback-model",
				resolution_path: ["fallback-alias", "fallback-model"],
			},
		]);
		expect(seen).toEqual(["dep-1", "dep-2", "fallback-model"]);
	});

	it("provider 400 失败 → fallback 链下一跳成功（GLM 1211 场景）", async () => {
		const facade = new MockRouterFacade({
			deploymentsByModel: {
				"glm-4-7-anthropic": [makeDeployment("glm-4-7-anthropic", "anthropic/glm-4.7")],
				"deepseek-coder-anthropic": [makeDeployment("deepseek-coder-anthropic", "anthropic/deepseek-v4-flash")],
			},
			fallbackChains: { "glm-4-7-anthropic": ["deepseek-coder-anthropic"] },
			// 400 非冷却目标：mock 不移除 deployment，靠 attemptedDeploymentKeys 防死循环
			cooldownOnFailure: false,
		});
		const seenModels: string[] = [];
		const result = await executeWithFallbackChain(
			facade,
			"glm-4-7-anthropic",
			undefined,
			undefined,
			async (attempt: UpstreamAttempt) => {
				seenModels.push(attempt.upstreamModel);
				if (attempt.upstreamModel === "glm-4.7") {
					throw new ProviderUpstreamError(400, "Provider 返回错误 (400): GLM 1211 模型不存在");
				}
				return "fallback-ok";
			},
		);
		expect(result).toBe("fallback-ok");
		// glm-4.7 只尝试一次（未入冷却也不重复打），随后 fallback 到 deepseek
		expect(seenModels).toEqual(["glm-4.7", "deepseek-v4-flash"]);
		expect(facade.failures).toHaveLength(1);
		expect(facade.failures[0]!.deploymentKey).toBe("glm-4-7-anthropic");
		expect(facade.failures[0]!.error).toBeInstanceOf(ProviderUpstreamError);
		expect(facade.successes).toEqual(["deepseek-coder-anthropic"]);
	});

	it("同组多 deployment：第一个失败入冷却后同组第二个继续承担，不推进 fallback 链", async () => {
		const facade = new MockRouterFacade({
			deploymentsByModel: {
				"glm-4-7-anthropic": [
					makeDeployment("glm-4-7-anthropic", "anthropic/glm-4.7", "dep-1"),
					makeDeployment("glm-4-7-anthropic", "anthropic/glm-4.7-backup", "dep-2"),
				],
				"deepseek-coder-anthropic": [makeDeployment("deepseek-coder-anthropic", "anthropic/deepseek-v4-flash")],
			},
			fallbackChains: { "glm-4-7-anthropic": ["deepseek-coder-anthropic"] },
			cooldownOnFailure: true,
		});
		const seenKeys: string[] = [];
		const result = await executeWithFallbackChain(
			facade,
			"glm-4-7-anthropic",
			undefined,
			undefined,
			async (attempt: UpstreamAttempt) => {
				seenKeys.push(attempt.deploymentKey);
				if (attempt.deploymentKey === "dep-1") {
					throw new ProviderUpstreamError(429, "Provider 返回错误 (429): rate limited");
				}
				return "same-group-ok";
			},
		);
		expect(result).toBe("same-group-ok");
		expect(seenKeys).toEqual(["dep-1", "dep-2"]);
	});

	it("链耗尽：抛最后一个 provider 错误并保留 HTTP 状态码", async () => {
		const facade = new MockRouterFacade({
			deploymentsByModel: {
				"glm-4-7-anthropic": [makeDeployment("glm-4-7-anthropic", "anthropic/glm-4.7")],
				"deepseek-coder-anthropic": [makeDeployment("deepseek-coder-anthropic", "anthropic/deepseek-v4-flash")],
			},
			fallbackChains: { "glm-4-7-anthropic": ["deepseek-coder-anthropic"] },
			cooldownOnFailure: true,
		});
		let caught: unknown;
		await executeWithFallbackChain(facade, "glm-4-7-anthropic", undefined, undefined, async (attempt: UpstreamAttempt) => {
			if (attempt.upstreamModel === "glm-4.7") {
				throw new ProviderUpstreamError(400, "Provider 返回错误 (400): GLM 1309 套餐到期");
			}
			throw new ProviderUpstreamError(500, "Provider 返回错误 (500): deepseek internal");
		}).catch((err) => {
			caught = err;
		});
		expect(caught).toBeInstanceOf(ApiError);
		expect((caught as ApiError).statusCode).toBe(500);
		expect((caught as ApiError).message).toContain("deepseek internal");
		expect(facade.failures).toHaveLength(2);
	});

	it("客户端取消直接终止，不登记 deployment 失败或进入 fallback", async () => {
		const facade = new MockRouterFacade({
			deploymentsByModel: {
				"glm-4-7-anthropic": [makeDeployment("glm-4-7-anthropic", "anthropic/glm-4.7")],
				"deepseek-coder-anthropic": [makeDeployment("deepseek-coder-anthropic", "anthropic/deepseek-v4-flash")],
			},
			fallbackChains: { "glm-4-7-anthropic": ["deepseek-coder-anthropic"] },
		});
		const abortError = new DOMException("Aborted", "AbortError");

		await expect(
			executeWithFallbackChain(facade, "glm-4-7-anthropic", undefined, undefined, async () => {
				throw abortError;
			}),
		).rejects.toBe(abortError);
		expect(facade.failures).toHaveLength(0);
	});

	it("网络错误（非 ProviderUpstreamError）也可 fallback", async () => {
		const facade = new MockRouterFacade({
			deploymentsByModel: {
				"glm-4-7-anthropic": [makeDeployment("glm-4-7-anthropic", "anthropic/glm-4.7")],
				"deepseek-coder-anthropic": [makeDeployment("deepseek-coder-anthropic", "anthropic/deepseek-v4-flash")],
			},
			fallbackChains: { "glm-4-7-anthropic": ["deepseek-coder-anthropic"] },
			cooldownOnFailure: true,
		});
		const result = await executeWithFallbackChain(
			facade,
			"glm-4-7-anthropic",
			undefined,
			undefined,
			async (attempt: UpstreamAttempt) => {
				if (attempt.upstreamModel === "glm-4.7") {
					throw new TypeError("fetch failed");
				}
				return "recovered";
			},
		);
		expect(result).toBe("recovered");
		expect(facade.failures[0]!.error.name).toBe("APIConnectionError");
	});

	it("模型不存在（无 deployment 且无 fallback）：抛 ApiError 400", async () => {
		const facade = new MockRouterFacade({ deploymentsByModel: {} });
		let caught: unknown;
		await executeWithFallbackChain(facade, "missing-model", undefined, undefined, async () => "unreachable").catch((err) => {
			caught = err;
		});
		expect(caught).toBeInstanceOf(ApiError);
		expect((caught as ApiError).statusCode).toBe(400);
		expect((caught as ApiError).message).toBe(
			"400: {'error': 'anthropic_messages: Invalid model name passed in model=missing-model. Call `/v1/models` to view available models for your key.'}",
		);
	});

	it("模型存在但全部署冷却且无 fallback：抛 ApiError 429", async () => {
		const facade = new MockRouterFacade({
			deploymentsByModel: { "known-model": [makeDeployment("known-model", "anthropic/known")] },
			cooldownOnFailure: true,
		});
		// 手动冷却唯一 deployment，使链上无可用 deployment
		facade.recordDeploymentFailure(makeDeployment("known-model", "anthropic/known"), new Error("cool"));
		let caught: unknown;
		await executeWithFallbackChain(facade, "known-model", undefined, undefined, async () => "unreachable").catch((err) => {
			caught = err;
		});
		expect(caught).toBeInstanceOf(ApiError);
		expect((caught as ApiError).statusCode).toBe(429);
		expect((caught as ApiError).message).toContain("No deployments available for selected model");
	});
});
