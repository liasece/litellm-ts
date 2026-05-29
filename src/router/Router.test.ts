/**
 * Router 测试 - smoke
 *
 * 详细内容已拆分到：
 *   - RouterRetry.test.ts: 重试策略
 *   - RouterExecution.test.ts: 执行链
 *   - RouterModelGroup.test.ts: 模型组缓存
 *   - RouterIntegration.test.ts: 集成
 */
import { Router } from "./Router";
import { installMockFetch, mkDeployment, okResponse } from "./RouterTestHelpers";
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
});
