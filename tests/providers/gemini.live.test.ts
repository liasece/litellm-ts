/**
 * Gemini 4 Hydrogen 真实上游测试。
 *
 * 需要 GEMINI_API_KEY（Google AI Studio key）才运行；没有 key 时整组跳过，
 * 保证 CI 不依赖外网和付费额度。运行方式：
 *   GEMINI_API_KEY=... npx jest tests/providers/gemini.live.test.ts --runInBand
 *
 * 本文件验证的是 provider 与真实 Gemini native 协议之间的约定：thinkingLevel、
 * 流式 SSE、工具调用 thoughtSignature 的往返。它不启动代理服务。
 */

import { GeminiProvider } from "../../src/providers/GeminiProvider";

const apiKey = process.env["GEMINI_API_KEY"];
const model = "gemini/gemini-4-hydrogen";
const live = apiKey === undefined || apiKey.length === 0 ? describe.skip : describe;

/** 发送一次 provider 构造的真实请求。 */
async function send(provider: GeminiProvider, body: Record<string, unknown>, stream: boolean): Promise<Response> {
	const req = provider.transformRequest(model, body["messages"] as never, {
		...body,
		stream: stream,
	});
	return fetch(req.url, {
		method: req.method,
		headers: req.headers,
		body: JSON.stringify(req.body),
	});
}

live("Gemini 4 Hydrogen（真实上游）", () => {
	jest.setTimeout(90_000);
	const provider = new GeminiProvider(apiKey ?? "");

	it("非流式请求返回文本、用量与思考等级", async () => {
		const response = await send(
			provider,
			{
				messages: [{ role: "user", content: "Reply with exactly: HYDROGEN_OK" }],
				max_tokens: 512,
				reasoning_effort: "low",
			},
			false,
		);
		expect(response.ok).toBe(true);
		const transformed = provider.transformResponse(model, await response.json());
		expect(transformed.choices[0]?.message.content).toContain("HYDROGEN_OK");
		expect(transformed.usage?.prompt_tokens).toBeGreaterThan(0);
		expect(transformed.usage?.completion_tokens).toBeGreaterThan(0);
	});

	it("流式请求按 SSE 返回正文与用量", async () => {
		const response = await send(
			provider,
			{
				messages: [{ role: "user", content: "Count from 1 to 3, then say STREAM_OK." }],
				max_tokens: 1024,
				reasoning_effort: "low",
			},
			true,
		);
		expect(response.ok).toBe(true);
		let content = "";
		let sawUsage = false;
		for await (const chunk of provider.streamResponse(response)) {
			content += chunk.choices[0]?.delta.content ?? "";
			if (chunk.usage) {
				sawUsage = true;
			}
		}
		expect(content).toContain("STREAM_OK");
		expect(sawUsage).toBe(true);
	});

	it("工具调用签名经调用 ID 往返后可继续多轮", async () => {
		const tools = [
			{
				type: "function",
				function: {
					name: "get_weather",
					description: "Get the current weather for a city",
					parameters: {
						type: "object",
						properties: { city: { type: "string" } },
						required: ["city"],
					},
				},
			},
		];
		const first = await send(
			provider,
			{
				messages: [{ role: "user", content: "What is the weather in Beijing? Use the get_weather tool." }],
				tools: tools,
				max_tokens: 1024,
				reasoning_effort: "low",
			},
			false,
		);
		expect(first.ok).toBe(true);
		const toolResponse = provider.transformResponse(model, await first.json());
		const call = toolResponse.choices[0]?.message.tool_calls?.[0];
		expect(call?.function.name).toBe("get_weather");
		expect(call?.id).toContain("__thought__");

		const second = await send(
			provider,
			{
				messages: [
					{ role: "user", content: "What is the weather in Beijing? Use the get_weather tool." },
					toolResponse.choices[0]?.message,
					{ role: "tool", tool_call_id: call?.id, content: '{"temperature":"12C"}' },
				],
				tools: tools,
				max_tokens: 1024,
				reasoning_effort: "low",
			},
			false,
		);
		expect(second.ok).toBe(true);
		const finalResponse = provider.transformResponse(model, await second.json());
		expect(finalResponse.choices[0]?.message.content).toContain("12");
	});
});
