/** DeepSeek 原生 OpenAI / Anthropic 协议出口测试。 */

import type { Message } from "../../src/types/openai";
import { DeepSeekProvider } from "../../src/providers/DeepSeekProvider";

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

		it("OpenAI developer role 在 DeepSeek 出口规范化为 system，且不走 Anthropic 端点", () => {
			const messages = [
				{ role: "developer", content: "Follow the instructions" },
				{ role: "user", content: "hello" },
			] as Message[];

			const result = provider.transformRequest("deepseek/deepseek-v4-flash", messages, {});

			expect(result.url).toBe("https://api.deepseek.com/chat/completions");
			expect((result.body as { messages: Message[] }).messages.map((message) => message.role)).toEqual(["system", "user"]);
			expect(messages.map((message) => message.role)).toEqual(["developer", "user"]);
		});

		it("强制 tool_choice 时关闭 DeepSeek thinking，且不修改调用方参数", () => {
			const optionalParams = {
				reasoning_effort: "max",
				thinking: { type: "enabled" },
				tool_choice: { type: "function", function: { name: "required_tool" } },
			};

			const result = provider.transformRequest("deepseek/deepseek-v4-flash", [{ role: "user", content: "use tool" }], optionalParams);

			expect((result.body as Record<string, unknown>)["tool_choice"]).toEqual(optionalParams.tool_choice);
			expect((result.body as Record<string, unknown>)["thinking"]).toEqual({ type: "disabled" });
			expect((result.body as Record<string, unknown>)["reasoning_effort"]).toBeUndefined();
			expect(optionalParams).toEqual({
				reasoning_effort: "max",
				thinking: { type: "enabled" },
				tool_choice: { type: "function", function: { name: "required_tool" } },
			});
		});
	});

	describe("OpenAI Responses", () => {
		it("deepseek-v4-flash 保持 Responses 请求体并使用原生端点", () => {
			const body = {
				model: "deepseek-v4-flash",
				instructions: "Follow instructions",
				input: [{ role: "user", content: "hello" }],
				reasoning: { effort: "max" },
				stream: true,
			};

			const result = provider.transformResponsesRequest("deepseek/deepseek-v4-flash", body, {});

			expect(result).toBeDefined();
			expect(result!.url).toBe("https://api.deepseek.com/responses");
			expect(result!.responseProtocol).toBe("responses");
			expect(result!.stream).toBe(true);
			expect(result!.body).toEqual(body);
		});

		it("尊重 /v1 api_base 且不为尚未支持的 v4-pro 声明原生 Responses", () => {
			const flash = provider.transformResponsesRequest(
				"deepseek-v4-flash",
				{ model: "logical-model", input: "hello" },
				{ api_base: "https://proxy.example/v1/", api_key: "deployment-key" },
			);

			expect(flash?.url).toBe("https://proxy.example/v1/responses");
			expect(flash?.headers["Authorization"]).toBe("Bearer deployment-key");
			expect(flash?.body).toMatchObject({ model: "deepseek-v4-flash", input: "hello" });
			expect(provider.transformResponsesRequest("deepseek-v4-pro", { input: "hello" }, {})).toBeUndefined();
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
