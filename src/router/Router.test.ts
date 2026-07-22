/**
 * Router 测试 - smoke
 *
 * 详细内容已拆分到：
 *   - RouterRetry.test.ts: 重试策略
 *   - RouterExecution.test.ts: 执行链
 *   - RouterModelGroup.test.ts: 模型组缓存
 *   - RouterIntegration.test.ts: 集成
 */
import { DeploymentNotFoundError, Router } from "./Router";
import { installMockFetch, mkDeployment, okResponse, errorResponse } from "./RouterTestHelpers";
import { RoutingStrategyName } from "../types/router";

let mockFetch: jest.Mock;

beforeEach(() => {
	mockFetch = installMockFetch();
});

describe("Router smoke", () => {
	it("构造 Router 不抛错", () => {
		const router = new Router({
			model_list: [mkDeployment("gpt-4")],
			routing_strategy: RoutingStrategyName.SimpleShuffle,
			num_retries: 0,
		});
		expect(router).toBeDefined();
	});

	it("completion 走通成功路径（mock fetch 200）", async () => {
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
		const res = await router.completion("gpt-4", [{ role: "user", content: "hi" }]);
		expect((res as { choices?: unknown[] }).choices).toBeDefined();
	});

	it("显式 num_retries: 0 不重试（PY router.py:497 is not None 即尊重显式值）", async () => {
		mockFetch.mockResolvedValue(errorResponse(500));
		const router = new Router({
			model_list: [mkDeployment("gpt-4")],
			routing_strategy: RoutingStrategyName.SimpleShuffle,
			num_retries: 0,
		});
		const caught = await router.completion("gpt-4", [{ role: "user", content: "hi" }]).catch((e: unknown) => e);
		expect(caught).toBeInstanceOf(Error);
		// 显式 0 → 仅首发一次请求，不再重试；若被当作缺省（2 次）会打 3 次
		expect(mockFetch).toHaveBeenCalledTimes(1);
		expect((caught as { max_retries?: number }).max_retries).toBe(0);
	});
});

describe("Router.probeDeployment", () => {
	function createRouter() {
		return new Router({
			model_list: [
				mkDeployment("shared", "openai/gpt-4", {
					litellm_params: { model: "openai/gpt-4", api_key: "first-secret", api_base: "https://first.example/v1" },
					model_info: { id: "first", mode: "chat" },
				}),
				mkDeployment("shared", "openai/gpt-4", {
					litellm_params: {
						model: "openai/gpt-4",
						api_key: "second-secret",
						api_base: "https://second.example/v1",
						extra_headers: { "x-health": "yes" },
					},
					model_info: { id: "second", mode: "chat" },
				}),
				mkDeployment("embed", "openai/text-embedding-3-small", {
					litellm_params: {
						model: "openai/text-embedding-3-small",
						api_key: "embed-secret",
						api_base: "https://embed.example/v1/chat/completions",
					},
					model_info: { id: "embed", mode: "embedding" },
				}),
				mkDeployment("image", "openai/dall-e-3", {
					model_info: { id: "image", mode: "image_generation" },
				}),
			],
			routing_strategy: RoutingStrategyName.SimpleShuffle,
			num_retries: 2,
			fallbacks: [{ shared: ["embed"] }],
		});
	}

	it("精确探测指定 deployment，不串同组 deployment 或 fallback", async () => {
		mockFetch.mockResolvedValueOnce(okResponse({ ok: true }));
		const result = await createRouter().probeDeployment("second");

		expect(result).toMatchObject({ model_id: "second", model_name: "shared", status: "healthy" });
		expect(mockFetch).toHaveBeenCalledTimes(1);
		expect(mockFetch.mock.calls[0]?.[0]).toBe("https://second.example/v1/chat/completions");
		expect(mockFetch.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: "Bearer second-secret", "x-health": "yes" });
		expect(JSON.stringify(result)).not.toContain("second-secret");
		expect(JSON.stringify(result)).not.toContain("health-check");
	});

	it("embedding 使用正式 capability 和准确 URL", async () => {
		mockFetch.mockResolvedValueOnce(okResponse({ data: [] }));
		const result = await createRouter().probeDeployment("embed");

		expect(result.status).toBe("healthy");
		expect(mockFetch.mock.calls[0]?.[0]).toBe("https://embed.example/v1/embeddings");
		expect(JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string)).toEqual({
			model: "text-embedding-3-small",
			input: "health-check",
		});
	});

	it.each([401, 403, 429, 500])("HTTP %i 返回 unhealthy 且不重试", async (status) => {
		mockFetch.mockResolvedValueOnce(errorResponse(status));
		await expect(createRouter().probeDeployment("first")).resolves.toMatchObject({
			status: "unhealthy",
			error: `Provider returned HTTP ${status}`,
		});
		expect(mockFetch).toHaveBeenCalledTimes(1);
	});

	it("网络错误和 unsupported mode 均返回 unhealthy 且不重试", async () => {
		const router = createRouter();
		mockFetch.mockRejectedValueOnce(new TypeError("getaddrinfo ENOTFOUND secret.example"));
		await expect(router.probeDeployment("second")).resolves.toMatchObject({
			status: "unhealthy",
			error: "Health check failed: TypeError",
		});
		await expect(router.probeDeployment("image")).resolves.toMatchObject({
			status: "unhealthy",
			error: "Unsupported health check mode: image_generation",
		});
		expect(mockFetch).toHaveBeenCalledTimes(1);
	});

	it("超时中止请求并返回脱敏 unhealthy", async () => {
		const router = new Router({
			model_list: [
				mkDeployment("slow", "openai/gpt-4", {
					litellm_params: {
						model: "openai/gpt-4",
						api_key: "secret",
						api_base: "https://slow.example/v1",
						health_check_timeout: 0.001,
					},
					model_info: { id: "slow", mode: "chat" },
				}),
			],
			routing_strategy: RoutingStrategyName.SimpleShuffle,
			num_retries: 0,
		});
		mockFetch.mockImplementation(
			(_url, init) =>
				new Promise((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
				}),
		);

		await expect(router.probeDeployment("slow")).resolves.toMatchObject({
			status: "unhealthy",
			error: "Health check timed out",
		});
	});

	it("未知 deployment ID 抛出明确 not-found", async () => {
		await expect(createRouter().probeDeployment("missing")).rejects.toBeInstanceOf(DeploymentNotFoundError);
		expect(mockFetch).not.toHaveBeenCalled();
	});
});
