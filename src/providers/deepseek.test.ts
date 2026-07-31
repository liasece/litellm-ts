/** DeepSeek 原生 OpenAI / Anthropic 协议出口测试。 */

import type { Message } from "../types/openai";
import { DeepSeekProvider } from "./DeepSeekProvider";

describe("DeepSeekProvider", () => {
	let provider: DeepSeekProvider;

	beforeEach(() => {
		provider = new DeepSeekProvider("deepseek-key");
	});

	describe("OpenAI Chat Completions", () => {
		it("使用正式 OpenAI 兼容端点并剥离 provider 前缀", () => {
			const result = provider.transformRequest("deepseek/deepseek-v4-flash", [{ role: "user", content: "hi" }], {
				temperature: 0.7,
			});

			expect(result.url).toBe("https://api.deepseek.com/chat/completions");
			expect(result.headers["Authorization"]).toBe("Bearer deepseek-key");
			expect(result.body).toMatchObject({
				model: "deepseek-v4-flash",
				temperature: 0.7,
			});
		});

		it("原样透传 OpenAI 消息、reasoning_effort 和 thinking，不修改调用方参数", () => {
			const messages = [
				{ role: "assistant", content: "", reasoning_content: "reasoning" },
				{ role: "user", content: "continue" },
			] as Message[];
			const optionalParams = {
				reasoning_effort: "max",
				thinking: { type: "enabled" },
			};

			const result = provider.transformRequest("deepseek-v4-pro", messages, optionalParams);

			expect((result.body as Record<string, unknown>)["messages"]).toEqual(messages);
			expect((result.body as Record<string, unknown>)["reasoning_effort"]).toBe("max");
			expect((result.body as Record<string, unknown>)["thinking"]).toEqual({ type: "enabled" });
			expect(optionalParams).toEqual({
				reasoning_effort: "max",
				thinking: { type: "enabled" },
			});
		});
	});

	describe("Anthropic Messages", () => {
		it("使用 DeepSeek 原生 Anthropic 端点和 x-api-key", () => {
			const result = provider.transformAnthropicRequest("deepseek/deepseek-v4-flash", {});

			expect(result.url).toBe("https://api.deepseek.com/anthropic/v1/messages");
			expect(result.headers["x-api-key"]).toBe("deepseek-key");
			expect(result.headers["anthropic-version"]).toBe("2023-06-01");
			expect(result.model).toBe("deepseek-v4-flash");
		});

		it("接受独立 anthropic_api_base 覆盖且不会重复追加路径", () => {
			const result = provider.transformAnthropicRequest("deepseek-v4-pro", {
				api_base: "https://api.deepseek.com",
				anthropic_api_base: "https://proxy.example/anthropic/",
				api_key: "deployment-key",
				anthropic_version: "2025-01-01",
			});

			expect(result.url).toBe("https://proxy.example/anthropic/v1/messages");
			expect(result.headers["x-api-key"]).toBe("deployment-key");
			expect(result.headers["anthropic-version"]).toBe("2025-01-01");
		});

		it("从兼容的 /v1 OpenAI base 派生官方 Anthropic 地址", () => {
			const result = provider.transformAnthropicRequest("deepseek-v4-flash", {
				api_base: "https://api.deepseek.com/v1",
			});

			expect(result.url).toBe("https://api.deepseek.com/anthropic/v1/messages");
		});
	});
});
