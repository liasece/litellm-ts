import {
	COMMANDCODE_API_BASE,
	OPENCODE_API_BASE,
	builtinCatalogForSource,
	fetchCommandCodeCatalog,
	fetchOpenCodeCatalog,
} from "./dynamicCatalog";

/** 一次被记录的请求。 */
interface RecordedCall {
	readonly url: string;
	readonly init: RequestInit;
}

/** 用固定响应构造 fetch，并记录每次调用。 */
function mockFetch(status: number, body: unknown): { calls: RecordedCall[]; fetchImpl: typeof fetch } {
	const calls: RecordedCall[] = [];
	const fetchImpl = (async (input: unknown, init?: RequestInit): Promise<Response> => {
		calls.push({ url: String(input), init: init ?? {} });
		return {
			ok: status >= 200 && status < 300,
			status: status,
			text: async (): Promise<string> => (typeof body === "string" ? body : JSON.stringify(body)),
		} as unknown as Response;
	}) as unknown as typeof fetch;
	return { calls: calls, fetchImpl: fetchImpl };
}

/** 用抛错构造失败的 fetch。 */
function failingFetch(): { calls: RecordedCall[]; fetchImpl: typeof fetch } {
	const calls: RecordedCall[] = [];
	const fetchImpl = (async (input: unknown, init?: RequestInit): Promise<Response> => {
		calls.push({ url: String(input), init: init ?? {} });
		throw new TypeError("fetch failed");
	}) as unknown as typeof fetch;
	return { calls: calls, fetchImpl: fetchImpl };
}

/** 读取被记录请求的请求头。 */
function headersOf(call: RecordedCall): Record<string, string> {
	return { ...(call.init.headers as Record<string, string>) };
}

describe("CommandCode 动态目录", () => {
	it("按插件实现请求 /models 并映射字段与路由", async () => {
		const { calls, fetchImpl } = mockFetch(200, {
			data: [
				{
					id: "anthropic/claude-sonnet-5-5",
					display_name: "Claude Sonnet 5.5",
					description: "Claude via CommandCode",
					context_length: 200000,
					max_output_tokens: 64000,
					input_modalities: ["text", "image"],
					output_modalities: ["text"],
					thinking: { levels: ["low", "high"] },
				},
				{ id: "gpt-6-luna", context_length: "272000", max_output_tokens: "128000" },
				{ id: "gpt-6-luna", display_name: "duplicate" },
				{ display_name: "no id" },
				"opaque",
			],
		});

		const models = await fetchCommandCodeCatalog("cc-key", fetchImpl);

		expect(calls).toHaveLength(1);
		expect(calls[0]?.url).toBe(`${COMMANDCODE_API_BASE}/models`);
		expect(calls[0]?.init.method).toBe("GET");
		expect(headersOf(calls[0]!)).toEqual({ Authorization: "Bearer cc-key", Accept: "application/json" });
		expect(models.map((model) => model.id)).toEqual(["anthropic/claude-sonnet-5-5", "gpt-6-luna"]);
		expect(models[0]).toMatchObject({
			upstreamId: "anthropic/claude-sonnet-5-5",
			displayName: "Claude Sonnet 5.5",
			protocol: "messages",
			metadata: expect.objectContaining({
				contextLength: 200000,
				maxOutputTokens: 64000,
				inputModalities: ["text", "image"],
				outputModalities: ["text"],
			}),
		});
		expect(models[1]).toMatchObject({
			displayName: "gpt-6-luna",
			protocol: "responses",
			metadata: expect.objectContaining({ contextLength: 272000, maxOutputTokens: 128000 }),
		});
	});

	it("兼容裸数组与 {models:[...]} 信封", async () => {
		const array = mockFetch(200, [{ id: "claude-opus-5", display_name: "Opus 5" }]);
		expect((await fetchCommandCodeCatalog("k", array.fetchImpl))[0]).toMatchObject({ id: "claude-opus-5", protocol: "messages" });

		const envelope = mockFetch(200, { models: [{ id: "gpt-6-sol" }] });
		expect((await fetchCommandCodeCatalog("k", envelope.fetchImpl))[0]).toMatchObject({ id: "gpt-6-sol", protocol: "responses" });
	});

	it("上游返回空列表时按空目录处理，不回退内置列表", async () => {
		const { fetchImpl } = mockFetch(200, { data: [] });
		await expect(fetchCommandCodeCatalog("cc-key", fetchImpl)).resolves.toEqual([]);
	});

	it("没有 key、非 2xx、网络错误、信封缺失与非法 JSON 都回退内置列表", async () => {
		const builtin = builtinCatalogForSource("commandcode");
		const noKey = mockFetch(200, { data: [{ id: "unused" }] });
		await expect(fetchCommandCodeCatalog("   ", noKey.fetchImpl)).resolves.toBe(builtin);
		expect(noKey.calls).toHaveLength(0);

		const rejected = mockFetch(401, { error: "unauthorized" });
		await expect(fetchCommandCodeCatalog("cc-key", rejected.fetchImpl)).resolves.toBe(builtin);

		const offline = failingFetch();
		await expect(fetchCommandCodeCatalog("cc-key", offline.fetchImpl)).resolves.toBe(builtin);

		const drift = mockFetch(200, { models: "not-an-array" });
		await expect(fetchCommandCodeCatalog("cc-key", drift.fetchImpl)).resolves.toBe(builtin);

		const broken = mockFetch(200, "{not json");
		await expect(fetchCommandCodeCatalog("cc-key", broken.fetchImpl)).resolves.toBe(builtin);
	});

	it("内置回退列表是冻结的公开示例模型", () => {
		const builtin = builtinCatalogForSource("commandcode");
		expect(Object.isFrozen(builtin)).toBe(true);
		expect(builtin[0]).toMatchObject({ id: "deepseek/deepseek-v4.1-flash", protocol: "responses", metadata: { builtin: true } });
	});
});

describe("OpenCode Go 动态目录", () => {
	it("按插件实现请求 /models 并按家族前缀给协议", async () => {
		const { calls, fetchImpl } = mockFetch(200, {
			data: [
				{ id: "deepseek-v4.1-flash", display_name: "DeepSeek V4.1 Flash", context_length: 160000 },
				{ id: "minimax-m3", display_name: "MiniMax M3" },
				{ id: "grok-5-mini" },
				{ id: "glm-6" },
				{ id: "mystery-1" },
			],
		});

		const models = await fetchOpenCodeCatalog("oc-key", fetchImpl);

		expect(calls[0]?.url).toBe(`${OPENCODE_API_BASE}/models`);
		expect(headersOf(calls[0]!)).toEqual({ Authorization: "Bearer oc-key", Accept: "application/json" });
		expect(models.map((model) => model.protocol)).toEqual(["chat", "messages", "responses", "chat", undefined]);
		expect(models[0]).toMatchObject({ id: "deepseek-v4.1-flash", upstreamId: "deepseek-v4.1-flash", displayName: "DeepSeek V4.1 Flash" });
	});

	it("没有 key 或上游失败时回退内置列表", async () => {
		const builtin = builtinCatalogForSource("opencode-go");
		const noKey = mockFetch(200, { data: [] });
		await expect(fetchOpenCodeCatalog("", noKey.fetchImpl)).resolves.toBe(builtin);
		expect(noKey.calls).toHaveLength(0);

		const rejected = mockFetch(500, "upstream down");
		await expect(fetchOpenCodeCatalog("oc-key", rejected.fetchImpl)).resolves.toBe(builtin);

		expect(builtin[0]).toMatchObject({ id: "deepseek-v4.1-flash", protocol: "chat", metadata: { builtin: true } });
	});
});
