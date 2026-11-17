import { GeminiProvider } from "./GeminiProvider";
import type { ModelResponse, ModelResponseStream } from "../types/openai";

/** 组装 Gemini SSE 响应；每帧一个 data JSON。 */
function sseResponse(frames: unknown[]): Response {
	const body = frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("");
	return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

/** 收集 provider 流式输出。 */
async function collect(stream: AsyncGenerator<ModelResponseStream>): Promise<ModelResponseStream[]> {
	const chunks: ModelResponseStream[] = [];
	for await (const chunk of stream) {
		chunks.push(chunk);
	}
	return chunks;
}

describe("GeminiProvider", () => {
	const provider = new GeminiProvider("AIza-test", "https://generativelanguage.googleapis.com/v1beta");

	describe("transformRequest", () => {
		it("使用 native generateContent 路径并通过 header 传递密钥", () => {
			const req = provider.transformRequest("gemini/gemini-4-hydrogen", [{ role: "user", content: "hi" }], {
				api_key: "deployment-key",
			});

			expect(req.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-4-hydrogen:generateContent");
			expect(req.headers["x-goog-api-key"]).toBe("deployment-key");
			expect(req.url).not.toContain("deployment-key");
			expect(req.stream).toBe(false);
			expect(req.body).not.toHaveProperty("model");
		});

		it("流式请求使用 streamGenerateContent?alt=sse", () => {
			const req = provider.transformRequest("gemini/gemini-4-hydrogen", [{ role: "user", content: "hi" }], {
				stream: true,
			});

			expect(req.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-4-hydrogen:streamGenerateContent?alt=sse");
			expect(req.stream).toBe(true);
			expect(req.headers["Accept"]).toBe("text/event-stream");
		});

		it("把 system、工具、输出上限和采样参数映射到 Gemini 字段", () => {
			const body = provider.transformRequest(
				"gemini/gemini-4-hydrogen",
				[
					{ role: "system", content: "be terse" },
					{ role: "user", content: "weather?" },
				],
				{
					temperature: 0.2,
					top_p: 0.9,
					max_tokens: 256,
					tools: [
						{
							type: "function",
							function: {
								name: "get_weather",
								description: "Get weather",
								parameters: { type: "object", properties: { city: { type: "string" } } },
							},
						},
					],
				},
			).body as Record<string, unknown>;

			expect(body["systemInstruction"]).toEqual({ parts: [{ text: "be terse" }] });
			expect(body["tools"]).toEqual([
				{
					functionDeclarations: [
						{
							name: "get_weather",
							description: "Get weather",
							parameters: { type: "object", properties: { city: { type: "string" } } },
						},
					],
				},
			]);
			expect(body["generationConfig"]).toMatchObject({
				maxOutputTokens: 256,
				temperature: 0.2,
				topP: 0.9,
			});
		});

		it("Gemini 4 Hydrogen 把 reasoning_effort 映射为 thinkingLevel=xhigh", () => {
			const body = provider.transformRequest("gemini/gemini-4-hydrogen", [{ role: "user", content: "hi" }], {
				reasoning_effort: "xhigh",
			}).body as Record<string, unknown>;

			expect(body["generationConfig"]).toMatchObject({
				thinkingConfig: { thinkingLevel: "xhigh", includeThoughts: true },
			});
		});

		it("其它 Gemini 4 模型把 xhigh 收敛到 high", () => {
			const body = provider.transformRequest("gemini/gemini-4-carbon", [{ role: "user", content: "hi" }], {
				reasoning_effort: "xhigh",
			}).body as Record<string, unknown>;

			expect(body["generationConfig"]).toMatchObject({
				thinkingConfig: { thinkingLevel: "high", includeThoughts: true },
			});
		});

		it("Gemini 2.5 仍使用 thinkingBudget 而不是 thinkingLevel", () => {
			const body = provider.transformRequest("gemini/gemini-2.5-pro", [{ role: "user", content: "hi" }], {
				reasoning_effort: "high",
			}).body as Record<string, unknown>;

			const config = body["generationConfig"] as Record<string, unknown>;
			expect(config["thinkingConfig"]).not.toHaveProperty("thinkingLevel");
			expect(config["thinkingConfig"]).toMatchObject({ includeThoughts: true });
		});

		it("历史 functionCall 从调用 ID 还原签名，并清理 functionResponse 的 ID", () => {
			const body = provider.transformRequest(
				"gemini/gemini-4-hydrogen",
				[
					{ role: "user", content: "weather?" },
					{
						role: "assistant",
						content: null,
						tool_calls: [
							{
								id: "call_1__thought__sig-1",
								type: "function",
								function: { name: "get_weather", arguments: '{"city":"Beijing"}' },
							},
						],
					},
					{ role: "tool", tool_call_id: "call_1__thought__sig-1", content: '{"temp":"12C"}' },
				] as never,
				{},
			).body as Record<string, unknown>;

			const contents = body["contents"] as Record<string, unknown>[];
			const modelParts = (contents[1]?.["parts"] as Record<string, unknown>[]) ?? [];
			expect(modelParts[0]).toMatchObject({
				thoughtSignature: "sig-1",
				functionCall: { id: "call_1", name: "get_weather", args: { city: "Beijing" } },
			});
			const responseParts = (contents[2]?.["parts"] as Record<string, unknown>[]) ?? [];
			expect(responseParts[0]).toMatchObject({
				functionResponse: { id: "call_1", name: "get_weather" },
			});
		});

		it("缺少签名的 Gemini 3+ 工具历史补占位签名，避免上游 400", () => {
			const body = provider.transformRequest(
				"gemini/gemini-4-hydrogen",
				[
					{ role: "user", content: "weather?" },
					{
						role: "assistant",
						content: null,
						tool_calls: [
							{
								id: "call_1",
								type: "function",
								function: { name: "get_weather", arguments: "{}" },
							},
						],
					},
					{ role: "tool", tool_call_id: "call_1", content: "{}" },
				] as never,
				{},
			).body as Record<string, unknown>;

			const contents = body["contents"] as Record<string, unknown>[];
			const modelParts = (contents[1]?.["parts"] as Record<string, unknown>[]) ?? [];
			expect(modelParts[0]?.["thoughtSignature"]).toBe("c2tpcF90aG91Z2h0X3NpZ25hdHVyZV92YWxpZGF0b3I=");
		});
	});

	describe("transformResponse", () => {
		it("映射文本、用量和结束原因，并保留思考 token 在 completion_tokens 内", () => {
			const response: ModelResponse = provider.transformResponse("gemini/gemini-4-hydrogen", {
				candidates: [
					{
						content: { role: "model", parts: [{ text: "hello" }] },
						finishReason: "STOP",
					},
				],
				usageMetadata: {
					promptTokenCount: 100,
					candidatesTokenCount: 20,
					thoughtsTokenCount: 30,
					cachedContentTokenCount: 40,
					totalTokenCount: 150,
				},
				modelVersion: "gemini-4-hydrogen",
				responseId: "resp-1",
			});

			expect(response.id).toBe("resp-1");
			expect(response.choices[0]).toMatchObject({
				finish_reason: "stop",
				message: { role: "assistant", content: "hello" },
			});
			expect(response.usage).toMatchObject({
				prompt_tokens: 100,
				completion_tokens: 50,
				total_tokens: 150,
				prompt_tokens_details: { cached_tokens: 40 },
			});
			// reasoning_tokens 明细会让 CostCalculator 从输出中扣除思考 token；Gemini 按输出计费。
			expect(response.usage?.completion_tokens_details?.reasoning_tokens).toBeUndefined();
		});

		it("工具调用 ID 内嵌签名，finish_reason 为 tool_calls", () => {
			const response = provider.transformResponse("gemini/gemini-4-hydrogen", {
				candidates: [
					{
						content: {
							role: "model",
							parts: [
								{
									thoughtSignature: "sig-1",
									functionCall: { id: "call_1", name: "get_weather", args: { city: "Beijing" } },
								},
							],
						},
						finishReason: "STOP",
					},
				],
				usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
			});

			expect(response.choices[0]?.finish_reason).toBe("tool_calls");
			expect(response.choices[0]?.message.tool_calls?.[0]).toMatchObject({
				id: "call_1__thought__sig-1",
				type: "function",
				function: { name: "get_weather", arguments: '{"city":"Beijing"}' },
			});
		});

		it("MAX_TOKENS 映射为 length", () => {
			const response = provider.transformResponse("gemini/gemini-4-hydrogen", {
				candidates: [
					{
						content: { role: "model", parts: [{ text: "partial" }] },
						finishReason: "MAX_TOKENS",
					},
				],
				usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
			});

			expect(response.choices[0]?.finish_reason).toBe("length");
		});
	});

	describe("streamResponse", () => {
		it("把文本、思考、工具调用和用量帧翻译成 Chat chunk", async () => {
			const chunks = await collect(
				provider.streamResponse(
					sseResponse([
						{
							candidates: [
								{
									content: { role: "model", parts: [{ text: "Hel" }] },
									index: 0,
								},
							],
							modelVersion: "gemini-4-hydrogen",
							responseId: "resp-1",
						},
						{
							candidates: [
								{
									content: { role: "model", parts: [{ text: "lo", thought: true }] },
									index: 0,
								},
							],
						},
						{
							candidates: [
								{
									content: {
										role: "model",
										parts: [
											{
												thoughtSignature: "sig-1",
												functionCall: {
													id: "call_1",
													name: "get_weather",
													args: { city: "Beijing" },
												},
											},
										],
									},
									finishReason: "STOP",
									index: 0,
								},
							],
							usageMetadata: {
								promptTokenCount: 10,
								candidatesTokenCount: 5,
								thoughtsTokenCount: 2,
								totalTokenCount: 17,
							},
						},
					]),
				),
			);

			const text = chunks.map((chunk) => chunk.choices[0]?.delta.content ?? "").join("");
			const reasoning = chunks.map((chunk) => chunk.choices[0]?.delta.reasoning_content ?? "").join("");
			expect(text).toBe("Hel");
			expect(reasoning).toBe("lo");
			const toolCall = chunks.flatMap((chunk) => chunk.choices[0]?.delta.tool_calls ?? []).find((call) => call.id !== undefined);
			expect(toolCall).toMatchObject({
				id: "call_1__thought__sig-1",
				type: "function",
				function: { name: "get_weather" },
			});
			const usageChunk = chunks.find((chunk) => chunk.usage !== undefined && chunk.usage !== null);
			expect(usageChunk?.usage).toMatchObject({ prompt_tokens: 10, completion_tokens: 7, total_tokens: 17 });
			expect(usageChunk?.usage?.completion_tokens_details?.reasoning_tokens).toBeUndefined();
		});
	});
});
