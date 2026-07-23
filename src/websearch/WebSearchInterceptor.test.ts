import { ApiError } from "../core/api/ApiError";
import { validateAndTransform } from "../core/config";
import {
	addWebSearchUsage,
	buildAnthropicSearchContinuation,
	buildOpenAISearchContinuation,
	executeGooglePseSearch,
	extractAnthropicWebSearchCalls,
	extractOpenAIWebSearchCalls,
	formatSearchResults,
	resolveGooglePseSearchConfig,
	type GooglePseSearchConfig,
} from "./WebSearchInterceptor";

const config: GooglePseSearchConfig = {
	apiKey: "test-api-key",
	engineId: "test-engine-id",
	timeoutMs: 100,
	maxQueries: 2,
	maxQueryLength: 20,
	maxResults: 2,
	maxTitleLength: 8,
	maxLinkLength: 24,
	maxSnippetLength: 12,
	maxInjectedChars: 120,
};

describe("Google PSE WebSearchInterceptor", () => {
	afterEach(() => {
		jest.restoreAllMocks();
	});

	it("成功响应会校验、裁剪并限制结果数量", async () => {
		const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue(
			new Response(
				JSON.stringify({
					searchInformation: { totalResults: "3" },
					items: [
						{ title: "123456789", link: "https://example.com/very-long-path", snippet: "abcdefghijklmnop" },
						{ title: "second", link: "https://two.example", snippet: "two" },
						{ title: "third", link: "https://three.example", snippet: "three" },
					],
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			),
		);

		const result = await executeGooglePseSearch("safe query", config);

		expect(result).toEqual({
			items: [
				{ title: "12345678", link: "https://example.com/very", snippet: "abcdefghijkl" },
				{ title: "second", link: "https://two.example", snippet: "two" },
			],
			totalResults: 3,
		});
		const calledUrl = new URL(String(fetchSpy.mock.calls[0]?.[0]));
		expect(calledUrl.searchParams.get("q")).toBe("safe query");
		expect(calledUrl.searchParams.get("num")).toBe("2");
		expect(calledUrl.searchParams.get("key")).toBe("test-api-key");
	});

	it("空 items 是合法空结果，不伪造结果", async () => {
		jest.spyOn(global, "fetch").mockResolvedValue(
			new Response(JSON.stringify({ searchInformation: { totalResults: "0" } }), { status: 200 }),
		);

		await expect(executeGooglePseSearch("nothing", config)).resolves.toEqual({ items: [], totalResults: 0 });
	});

	it("429 显式映射为 ApiError 且不泄漏上游正文", async () => {
		jest.spyOn(global, "fetch").mockResolvedValue(new Response("quota detail secret", { status: 429 }));

		await expect(executeGooglePseSearch("limited", config)).rejects.toMatchObject({
			statusCode: 429,
			message: "Google PSE 搜索请求过多",
		});
	});

	it("超时映射为 504", async () => {
		jest.spyOn(global, "fetch").mockImplementation(
			(_input, init) =>
				new Promise((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
				}),
		);

		await expect(executeGooglePseSearch("timeout", { ...config, timeoutMs: 1 })).rejects.toMatchObject({ statusCode: 504 });
	});

	it("无效 JSON 映射为 502", async () => {
		jest.spyOn(global, "fetch").mockResolvedValue(new Response("not-json", { status: 200 }));

		await expect(executeGooglePseSearch("bad json", config)).rejects.toMatchObject({ statusCode: 502 });
	});

	it("调用方 AbortSignal 中止映射为 499", async () => {
		const controller = new AbortController();
		controller.abort();
		jest.spyOn(global, "fetch");

		await expect(executeGooglePseSearch("aborted", config, controller.signal)).rejects.toMatchObject({ statusCode: 499 });
	});

	it("查询超限在调用 Google 前返回 400", async () => {
		const fetchSpy = jest.spyOn(global, "fetch");

		await expect(executeGooglePseSearch("query-is-definitely-too-long", config)).rejects.toBeInstanceOf(ApiError);
		await expect(executeGooglePseSearch("query-is-definitely-too-long", config)).rejects.toMatchObject({ statusCode: 400 });
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("提取 OpenAI 工具调用并构造标准 assistant/tool continuation", () => {
		const response = {
			choices: [
				{
					message: {
						role: "assistant",
						content: null,
						tool_calls: [{ id: "call-1", type: "function", function: { name: "web_search", arguments: '{"query":"docs"}' } }],
					},
				},
			],
		};
		const calls = extractOpenAIWebSearchCalls(response, [
			{ type: "function", function: { name: "web_search", parameters: { type: "object" } } },
		]);
		const continuation = buildOpenAISearchContinuation(response, calls, ["Title: docs"]);

		expect(calls).toEqual([{ id: "call-1", name: "web_search", query: "docs", input: { query: "docs" } }]);
		expect(continuation).toEqual([response.choices[0]?.message, { role: "tool", tool_call_id: "call-1", content: "Title: docs" }]);
	});

	it("Anthropic hosted search 工具不被本地拦截，本地自定义工具可构造 tool_result", () => {
		const response = {
			content: [{ type: "tool_use", id: "tool-1", name: "web_search", input: { query: "docs" } }],
		};
		expect(extractAnthropicWebSearchCalls(response, [{ type: "web_search_20250305", name: "web_search", max_uses: 1 }])).toEqual([]);

		const calls = extractAnthropicWebSearchCalls(response, [
			{ name: "web_search", description: "local search", input_schema: { type: "object" } },
		]);
		expect(buildAnthropicSearchContinuation(response, calls, ["Title: docs"])).toEqual([
			{ role: "assistant", content: response.content },
			{ role: "user", content: [{ type: "tool_result", tool_use_id: "tool-1", content: "Title: docs" }] },
		]);
	});

	it("格式化注入内容受总大小上限约束", () => {
		const text = formatSearchResults(
			[
				{ title: "one", link: "https://one.example", snippet: "first result" },
				{ title: "two", link: "https://two.example", snippet: "second result" },
			],
			40,
		);
		expect(text.length).toBeLessThanOrEqual(40);
		expect(text).toContain("Title:");
	});

	it("仅 YAML 同时启用 pre-call、interception 和 google_pse 时解析配置", () => {
		const serviceConfig = validateAndTransform({
			litellm_settings: {
				websearch_interception_params: {
					enabled_providers: ["bedrock"],
					search_tool_name: "tenant-b",
					max_results: 3,
					google_pse_api_key: "yaml-key",
				},
			},
			router_settings: {
				enable_pre_call_checks: true,
				search_tools: [
					{ search_tool_name: "tenant-a", litellm_params: { search_provider: "google_pse", search_engine_id: "wrong-engine" } },
					{ search_tool_name: "tenant-b", litellm_params: { search_provider: "google_pse", search_engine_id: "yaml-engine" } },
				],
			},
		});

		expect(resolveGooglePseSearchConfig(serviceConfig, "bedrock")).toMatchObject({
			apiKey: "yaml-key",
			engineId: "yaml-engine",
			maxResults: 3,
		});
		expect(resolveGooglePseSearchConfig(serviceConfig, "anthropic")).toBeUndefined();
		expect(
			resolveGooglePseSearchConfig(
				validateAndTransform({
					litellm_settings: { websearch_interception_params: {} },
					router_settings: { enable_pre_call_checks: false, search_tools: [] },
				}),
			),
		).toBeUndefined();
	});

	it("混合普通工具调用时不接管整轮响应", () => {
		const openAiResponse = {
			choices: [
				{
					message: {
						tool_calls: [
							{ id: "search", type: "function", function: { name: "web_search", arguments: '{"query":"docs"}' } },
							{ id: "other", type: "function", function: { name: "read_file", arguments: '{"path":"x"}' } },
						],
					},
				},
			],
		};
		expect(
			extractOpenAIWebSearchCalls(openAiResponse, [
				{ type: "function", function: { name: "web_search" } },
				{ type: "function", function: { name: "read_file" } },
			]),
		).toEqual([]);
		expect(
			extractAnthropicWebSearchCalls(
				{
					content: [
						{ type: "tool_use", id: "search", name: "web_search", input: { query: "docs" } },
						{ type: "tool_use", id: "other", name: "read_file", input: { path: "x" } },
					],
				},
				[
					{ name: "web_search", input_schema: { type: "object" } },
					{ name: "read_file", input_schema: { type: "object" } },
				],
			),
		).toEqual([]);
	});

	it("搜索次数与 provider 已有 usage 累加", () => {
		const response = { usage: { server_tool_use: { web_search_requests: 2 } } };
		addWebSearchUsage(response, 3);
		expect(response.usage.server_tool_use.web_search_requests).toBe(5);
	});
});
