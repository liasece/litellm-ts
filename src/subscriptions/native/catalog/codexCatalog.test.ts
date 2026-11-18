import { CODEX_CATALOG_CLIENT_VERSION, fetchCodexCatalog, mapCodexCatalog } from "./codexCatalog";

/** 上游目录条目；只保留断言需要的字段。 */
function entry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		slug: "gpt-6.2-sol",
		display_name: "GPT-6.2-Sol",
		description: "Latest coding model",
		minimal_client_version: "0.166.0",
		supported_in_api: true,
		visibility: "list",
		context_window: 500_000,
		max_context_window: 872_000,
		use_responses_lite: true,
		default_reasoning_level: "low",
		supported_reasoning_levels: [{ effort: "low" }, { effort: "high" }],
		...overrides,
	};
}

it("映射上游模型，跳过隐藏与不可通过 API 使用的条目", () => {
	const models = mapCodexCatalog({
		models: [
			entry(),
			entry({ slug: "gpt-reserve", visibility: "hide" }),
			entry({ slug: "internal-only", supported_in_api: false }),
			entry({ slug: "" }),
			entry({ slug: "gpt-6.2-astra", display_name: undefined, supported_reasoning_levels: [] }),
		],
	});
	expect(models.map((model) => model.id)).toEqual(["gpt-6.2-sol", "gpt-6.2-astra"]);
	expect(models[0]).toMatchObject({
		id: "gpt-6.2-sol",
		upstreamId: "gpt-6.2-sol",
		displayName: "GPT-6.2-Sol",
		protocol: "responses",
		metadata: {
			catalogKey: "codex-upstream",
			contextWindow: 500_000,
			maxContextWindow: 872_000,
			reasoningLevels: ["low", "high"],
			defaultReasoningLevel: "low",
			minimalClientVersion: "0.166.0",
			useResponsesLite: true,
		},
	});
	expect(models[1]?.displayName).toBe("gpt-6.2-astra");
	expect(models[1]?.metadata?.reasoningLevels).toBeUndefined();
});

it("响应缺少 models 数组时报错，交给调用方回退静态目录", () => {
	expect(() => mapCodexCatalog({ data: [] })).toThrow("Codex 模型目录响应缺少 models 数组");
	expect(() => mapCodexCatalog(null)).toThrow("Codex 模型目录响应缺少 models 数组");
});

it("请求带上账号身份与客户端版本", async () => {
	const requests: Array<{ url: string; headers: Headers }> = [];
	const fetchImpl: typeof fetch = async (input, init) => {
		requests.push({ url: input instanceof Request ? input.url : String(input), headers: new Headers(init?.headers) });
		return new Response(JSON.stringify({ models: [entry()] }), { status: 200 });
	};
	const models = await fetchCodexCatalog({ accessToken: "test-access-token", accountId: "acct-123", fetchImpl });
	expect(models.map((model) => model.id)).toEqual(["gpt-6.2-sol"]);
	expect(requests[0]?.url).toBe(
		"https://chatgpt.com/backend-api/codex/models?client_version=" + encodeURIComponent(CODEX_CATALOG_CLIENT_VERSION),
	);
	expect(requests[0]?.headers.get("Authorization")).toBe("Bearer test-access-token");
	expect(requests[0]?.headers.get("Chatgpt-Account-Id")).toBe("acct-123");
});

it("非 2xx 与不可解析的响应都抛错，不返回半份目录", async () => {
	await expect(
		fetchCodexCatalog({
			accessToken: "test-access-token",
			accountId: "acct-123",
			fetchImpl: async () => new Response("denied", { status: 403 }),
		}),
	).rejects.toThrow("HTTP 403");
	await expect(
		fetchCodexCatalog({
			accessToken: "test-access-token",
			accountId: "acct-123",
			fetchImpl: async () => new Response("not json", { status: 200 }),
		}),
	).rejects.toThrow("Codex 模型目录响应不是合法 JSON");
});
