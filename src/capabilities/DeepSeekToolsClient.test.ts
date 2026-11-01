import {
	buildDeepSeekSearchQuery,
	callDeepSeekFetch,
	callDeepSeekSearch,
	DEEPSEEK_TOOLS_COST_PER_REQUEST_USD,
	normalizeDeepSeekToolsApiBase,
	type DeepSeekToolsConnection,
} from "./DeepSeekToolsClient";

const connection: DeepSeekToolsConnection = {
	apiBase: "https://api.deepseek.com",
	apiKey: "sk-test-secret-value",
	timeoutMs: 5_000,
};

interface RecordedCall {
	readonly url: string;
	readonly init: RequestInit;
}

function mockFetchOnce(status: number, body: unknown): RecordedCall[] {
	const calls: RecordedCall[] = [];
	global.fetch = jest.fn(async (input: any, init: any) => {
		calls.push({ url: String(input), init: init });
		return {
			ok: status >= 200 && status < 300,
			status: status,
			text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
		} as unknown as Response;
	}) as unknown as typeof fetch;
	return calls;
}

function bodyOf(call: RecordedCall): Record<string, unknown> {
	return JSON.parse(String(call.init.body)) as Record<string, unknown>;
}

afterEach(() => {
	jest.restoreAllMocks();
});

describe("DeepSeek 直连工具客户端", () => {
	it("搜索把 count/need_content 映射到官方参数，并保留结果结构", async () => {
		const calls = mockFetchOnce(200, {
			results: [
				{
					title: "DeepSeek Search docs",
					url: "https://api-docs.deepseek.com/guides/search",
					site_name: "DeepSeek",
					date: "2026-10-20",
					summary: "Search API reference",
					content: "# Search\nFull markdown body.",
					rerank_score: 0.93,
				},
			],
		});

		const envelope = await callDeepSeekSearch(connection, {
			query: "deepseek search api",
			count: 10,
			needContent: true,
		});

		expect(calls).toHaveLength(1);
		expect(calls[0]!.url).toBe("https://api.deepseek.com/v1/tools/search");
		expect(bodyOf(calls[0]!)).toEqual({ query: "deepseek search api", count: 10, need_content: true });
		expect(envelope.results).toHaveLength(1);
		expect(envelope.results[0]!.siteName).toBe("DeepSeek");
		expect(envelope.results[0]!.rerankScore).toBe(0.93);
		expect(envelope.brief).toContain("https://api-docs.deepseek.com/guides/search");
		expect(envelope.brief).toContain("untrusted external data");
	});

	it("空搜索结果不计费也不伪造内容，而是明确告诉调用方没有命中", async () => {
		mockFetchOnce(200, { results: [] });
		const envelope = await callDeepSeekSearch(connection, { query: "no such thing", count: 10, needContent: false });
		expect(envelope.results).toHaveLength(0);
		expect(envelope.brief).toContain("returned no results");
		expect(envelope.brief).toContain("instead of guessing");
	});

	it("抓取返回 Markdown 正文与标题，并把 URL 写进证据简报", async () => {
		const calls = mockFetchOnce(200, {
			title: "Rate limits",
			content: "# Limits\nSearch 100 QPS, Fetch 25 QPS.",
		});
		const envelope = await callDeepSeekFetch(connection, "https://api-docs.deepseek.com/quick_start/rate_limit");
		expect(calls[0]!.url).toBe("https://api.deepseek.com/v1/tools/fetch");
		expect(bodyOf(calls[0]!)).toEqual({ url: "https://api-docs.deepseek.com/quick_start/rate_limit" });
		expect(envelope.title).toBe("Rate limits");
		expect(envelope.content).toContain("Search 100 QPS");
		expect(envelope.brief).toContain("Rate limits");
	});

	it("抓取没有正文时抛错而不是返回空证据", async () => {
		mockFetchOnce(404, { error: { message: "no usable content" } });
		await expect(callDeepSeekFetch(connection, "https://example.com/empty")).rejects.toMatchObject({
			message: expect.stringContaining("no usable content"),
		});
	});

	it("上游错误不会把 API key 或 Authorization 头带进错误信息", async () => {
		mockFetchOnce(401, { error: { message: "Authentication Fails" } });
		let message = "";
		try {
			await callDeepSeekSearch(connection, { query: "x", count: 1, needContent: false });
		} catch (error) {
			message = error instanceof Error ? error.message : String(error);
		}
		expect(message).toContain("HTTP 401");
		expect(message).not.toContain("sk-test-secret-value");
		expect(message).not.toContain("Bearer");
	});

	it("网络异常被转换成可继续 fallback 的 ApiError", async () => {
		global.fetch = jest.fn(async () => {
			throw new TypeError("fetch failed");
		}) as unknown as typeof fetch;
		await expect(callDeepSeekSearch(connection, { query: "x", count: 1, needContent: false })).rejects.toMatchObject({
			statusCode: 503,
		});
	});
});

describe("DeepSeek 查询操作符映射", () => {
	it("recencyDays 映射为 after:YYYY-MM-DD 并保持在 128 字符内", () => {
		const query = buildDeepSeekSearchQuery("模型上下文协议", 7);
		const expectedDate = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
		expect(query).toContain(`after:${expectedDate}`);
		expect(query.length).toBeLessThanOrEqual(128);
	});

	it("未指定时效时不追加任何操作符", () => {
		expect(buildDeepSeekSearchQuery("plain query")).toBe("plain query");
	});

	it("超长 query 被截断但时效操作符仍保留", () => {
		const query = buildDeepSeekSearchQuery("x".repeat(500), 30);
		expect(query.length).toBeLessThanOrEqual(128);
		expect(query).toContain("after:");
	});
});

describe("DeepSeek api_base 归一化", () => {
	it("补默认值并去掉尾部斜杠", () => {
		expect(normalizeDeepSeekToolsApiBase(undefined)).toBe("https://api.deepseek.com");
		expect(normalizeDeepSeekToolsApiBase("  ")).toBe("https://api.deepseek.com");
		expect(normalizeDeepSeekToolsApiBase("https://proxy.example.com/")).toBe("https://proxy.example.com");
	});

	it("已写入的接口路径被剥离，避免重复拼接", () => {
		expect(normalizeDeepSeekToolsApiBase("https://proxy.example.com/v1")).toBe("https://proxy.example.com");
		expect(normalizeDeepSeekToolsApiBase("https://proxy.example.com/v1/tools/search")).toBe(
			"https://proxy.example.com",
		);
	});
});

describe("按次计费单价", () => {
	it("单价为 $0.75 / 1000 次成功请求", () => {
		expect(DEEPSEEK_TOOLS_COST_PER_REQUEST_USD).toBeCloseTo(0.00075, 10);
	});
});
