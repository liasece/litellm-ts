import {
	clientWebToolKind,
	normalizeAnthropicClientWebTools,
	normalizeOpenAIClientWebTools,
	parseClientWebArguments,
} from "./ClientWebTools";

describe("ClientWebTools：识别与参数归一化", () => {
	it("按名字识别 web_search / web_fetch，大小写与常见变体都覆盖", () => {
		expect(clientWebToolKind("web_search")).toBe("search");
		expect(clientWebToolKind("WebSearch")).toBe("search");
		expect(clientWebToolKind("litellm_web_search")).toBe("search");
		expect(clientWebToolKind("web_fetch")).toBe("fetch");
		expect(clientWebToolKind("WebFetch")).toBe("fetch");
		expect(clientWebToolKind("read_file")).toBeUndefined();
	});

	it("函数工具原样保留，只登记名字与种类", () => {
		const tools = [
			{ type: "function", function: { name: "web_search", parameters: { type: "object" } } },
			{ type: "function", function: { name: "read_file", parameters: { type: "object" } } },
		];
		const normalized = normalizeOpenAIClientWebTools(tools);
		expect(normalized.clientTools).toEqual([{ name: "web_search", kind: "search", hosted: false }]);
		expect(normalized.tools).toHaveLength(2);
		expect(normalized.tools[0]).toEqual(tools[0]);
	});

	it("托管工具类型改写成可调用函数，避免上游根本不认这个声明", () => {
		const normalized = normalizeOpenAIClientWebTools([
			{ type: "web_search" },
			{ type: "web_fetch_20250910" },
		]);
		expect(normalized.clientTools.map((tool) => tool.kind)).toEqual(["search", "fetch"]);
		const search = normalized.tools[0] as Record<string, unknown>;
		const fetch = normalized.tools[1] as Record<string, unknown>;
		expect((search["function"] as Record<string, unknown>)["name"]).toBe("web_search");
		expect((fetch["function"] as Record<string, unknown>)["name"]).toBe("web_fetch");
	});

	it("同名函数工具与托管声明同时出现时只保留函数工具", () => {
		const normalized = normalizeOpenAIClientWebTools([
			{ type: "function", function: { name: "web_search", parameters: { type: "object" } } },
			{ type: "web_search" },
		]);
		expect(normalized.clientTools).toHaveLength(1);
		expect(normalized.tools).toHaveLength(1);
		expect(normalized.clientTools[0]!.hosted).toBe(false);
	});

	it("Anthropic 托管类型改写成带 input_schema 的普通工具", () => {
		const normalized = normalizeAnthropicClientWebTools([
			{ type: "web_search_20250305", name: "web_search", max_uses: 5 },
			{ name: "WebFetch", description: "fetch", input_schema: { type: "object" } },
		]);
		expect(normalized.clientTools).toEqual([
			{ name: "web_search", kind: "search", hosted: true },
			{ name: "WebFetch", kind: "fetch", hosted: false },
		]);
		const rewritten = normalized.tools[0] as Record<string, unknown>;
		expect(rewritten["type"]).toBeUndefined();
		expect(rewritten["input_schema"]).toBeDefined();
	});

	it("把各家不同的参数名归一化成同一份搜索/抓取请求", () => {
		expect(parseClientWebArguments("search", '{"query":"litellm proxy"}')).toEqual({
			ok: true,
			requests: [{ kind: "search", query: "litellm proxy" }],
		});
		expect(parseClientWebArguments("search", '{"q":"最新版本","recency_days":7}')).toEqual({
			ok: true,
			requests: [{ kind: "search", query: "最新版本", recencyDays: 7 }],
		});
		expect(parseClientWebArguments("fetch", '{"url":"https://example.com/a","prompt":"pricing"}')).toEqual({
			ok: true,
			requests: [{ kind: "fetch", url: "https://example.com/a", instructions: "pricing" }],
		});
		expect(parseClientWebArguments("fetch", { link: "https://example.com/b" })).toEqual({
			ok: true,
			requests: [
				{
					kind: "fetch",
					url: "https://example.com/b",
					instructions: "Summarize this page and extract the facts the caller needs.",
				},
			],
		});
	});

	it("数组型查询展开成多条搜索请求，去重并按声明顺序执行", () => {
		// 真实客户端（DeepSeek Harness）的 web_search 声明就是 queries: string[]。
		const parsed = parseClientWebArguments("search", {
			queries: ["AI news November 5 2026", "人工智能 新闻 2026年11月5日", "ai news november 5 2026", "OpenAI 2026"],
		});
		expect(parsed).toEqual({
			ok: true,
			requests: [
				{ kind: "search", query: "AI news November 5 2026" },
				{ kind: "search", query: "人工智能 新闻 2026年11月5日" },
				{ kind: "search", query: "OpenAI 2026" },
			],
		});
	});

	it("多 URL 抓取展开成多条请求，自定义字段名走兜底", () => {
		expect(parseClientWebArguments("fetch", { urls: ["https://example.com/a", "https://example.com/b"] })).toEqual({
			ok: true,
			requests: [
				{
					kind: "fetch",
					url: "https://example.com/a",
					instructions: "Summarize this page and extract the facts the caller needs.",
				},
				{
					kind: "fetch",
					url: "https://example.com/b",
					instructions: "Summarize this page and extract the facts the caller needs.",
				},
			],
		});
		expect(parseClientWebArguments("search", { search_term: "custom schema fallback" })).toEqual({
			ok: true,
			requests: [{ kind: "search", query: "custom schema fallback" }],
		});
	});

	it("参数不可用时给出可注入的错误说明，而不是抛错", () => {
		const noQuery = parseClientWebArguments("search", "{}");
		expect(noQuery.ok).toBe(false);
		if (!noQuery.ok) {
			expect(noQuery.error).toContain("queries");
		}
		const badJson = parseClientWebArguments("search", "{oops");
		expect(badJson.ok).toBe(false);
		const badUrl = parseClientWebArguments("fetch", '{"url":"ftp://example.com/a"}');
		expect(badUrl.ok).toBe(false);
	});
});
