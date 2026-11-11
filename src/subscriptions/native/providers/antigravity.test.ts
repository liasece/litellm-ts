/**
 * Antigravity 订阅 Provider 适配器测试。
 *
 * 用例覆盖 `v1internal` 信封、Claude 专属字段、schema 清洗、countTokens 与额度查询；
 * 全部使用临时 auth 目录与注入的 fetch，不触网。
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SubscriptionAccountStore } from "../accountStore";
import { ANTIGRAVITY_API_VERSION, ANTIGRAVITY_CLOUDCODE_ENDPOINT, ANTIGRAVITY_USER_AGENT } from "../auth/antigravityConstants";
import type {
	SubscriptionAccount,
	SubscriptionInboundProtocol,
	SubscriptionOperation,
	SubscriptionUpstreamContext,
	SubscriptionUpstreamPlan,
} from "../types";
import { GEMINI_SKIP_THOUGHT_SIGNATURE_VALIDATOR } from "../protocol/signatureTargets";
import { createAntigravityProvider } from "./antigravity";

/** 一次被 stub 的 fetch 调用。 */
interface StubCall {
	/** 请求 URL。 */
	readonly url: string;
	/** 请求头。 */
	readonly headers: Record<string, string>;
}

/** stub 响应定义。 */
interface StubResponse {
	/** HTTP 状态码；缺省 200。 */
	readonly status?: number;
	/** 响应体；对象会被 JSON 序列化。 */
	readonly body: unknown;
}

/** 临时 auth 目录。 */
let authDir: string;

beforeEach(() => {
	authDir = mkdtempSync(path.join(tmpdir(), "antigravity-provider-"));
});

afterEach(() => {
	rmSync(authDir, { recursive: true, force: true });
});

/**
 * 构造一个按顺序返回固定响应的 fetch 替身。
 * @param responses - 依次返回的响应
 * @returns 调用记录与 fetch 实现
 */
function stubFetch(responses: readonly StubResponse[]): { readonly calls: StubCall[]; readonly fetchImpl: typeof fetch } {
	const calls: StubCall[] = [];
	let index = 0;
	const fetchImpl: typeof fetch = async (input, init) => {
		const headers: Record<string, string> = {};
		if (init?.headers) {
			for (const [key, value] of Object.entries(init.headers)) {
				if (typeof value === "string") {
					headers[key] = value;
				}
			}
		}
		calls.push({ url: String(input), headers: headers });
		const response = responses[index] ?? { body: {} };
		index += 1;
		const text = typeof response.body === "string" ? response.body : JSON.stringify(response.body);
		return new Response(text, {
			status: response.status ?? 200,
			headers: { "content-type": "application/json" },
		});
	};
	return { calls: calls, fetchImpl: fetchImpl };
}

/**
 * 写入一个 Antigravity 账号并返回仓库与解析结果。
 * @param raw - auth 文件的额外字段
 * @returns 账号仓库与账号
 * @throws {Error} 账号文件未产生可解析账号时抛出
 */
async function seedAccount(
	raw: Record<string, unknown> = {},
): Promise<{ readonly store: SubscriptionAccountStore; readonly account: SubscriptionAccount }> {
	const store = new SubscriptionAccountStore({ authDir: authDir });
	await store.writeRaw("antigravity-1.json", {
		type: "antigravity",
		access_token: "ag-token",
		refresh_token: "ag-refresh",
		project_id: "proj-1",
		// 远未来到期时间，ensureCredential 不会发起刷新请求。
		expired: Date.now() + 3_600_000,
		...raw,
	});
	const accounts = await store.list("antigravity");
	const account = accounts[0];
	if (!account) {
		throw new Error("测试账号未写入");
	}
	return { store: store, account: account };
}

/**
 * 构造上游上下文。
 * @param options - 上下文片段
 * @returns 完整上下文
 */
function contextOf(options: {
	readonly account: SubscriptionAccount;
	readonly operation: SubscriptionOperation;
	readonly model: string;
	readonly body?: Record<string, unknown>;
	readonly upstreamBody?: Record<string, unknown>;
	readonly inbound?: SubscriptionInboundProtocol;
	readonly stream?: boolean;
	readonly sessionKey?: string;
}): SubscriptionUpstreamContext {
	const body = options.body ?? {};
	return {
		source: "antigravity",
		operation: options.operation,
		model: options.model,
		inbound: options.inbound ?? "chat",
		body: body,
		headers: {},
		stream: options.stream ?? false,
		sessionKey: options.sessionKey ?? "session-1",
		upstream: "gemini",
		upstreamBody: options.upstreamBody ?? body,
		account: options.account,
		credential: "ag-token",
	};
}

/**
 * 取出计划的 JSON 请求体。
 * @param plan - 上游计划
 * @returns 请求体记录
 * @throws {Error} 计划没有 JSON 请求体时抛出
 */
function bodyOf(plan: SubscriptionUpstreamPlan): Record<string, unknown> {
	const body = plan.body;
	if (!body || typeof body !== "object" || Array.isArray(body)) {
		throw new Error("计划缺少 JSON 请求体");
	}
	return body as Record<string, unknown>;
}

/**
 * 读取对象数组字段。
 * @param value - 任意值
 * @returns 对象数组
 */
function records(value: unknown): Record<string, unknown>[] {
	return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => item !== null && typeof item === "object" && !Array.isArray(item)) : [];
}

/**
 * 取出信封里的 request。
 * @param plan - 上游计划
 * @returns request 记录
 * @throws {Error} 信封缺少 request 时抛出
 */
function requestOf(plan: SubscriptionUpstreamPlan): Record<string, unknown> {
	const request = bodyOf(plan)["request"];
	if (!request || typeof request !== "object" || Array.isArray(request)) {
		throw new Error("信封缺少 request");
	}
	return request as Record<string, unknown>;
}

describe("createAntigravityProvider", () => {
	it("supports 只承接对话与计数，route 固定 gemini", async () => {
		const { account } = await seedAccount();
		const provider = createAntigravityProvider({ accounts: new SubscriptionAccountStore({ authDir: authDir }) });

		expect(provider.source).toBe("antigravity");
		expect(provider.displayName).toBe("Antigravity");
		expect(provider.route(contextOf({ account: account, operation: "chat", model: "claude-sonnet-4-6" }))).toBe("gemini");
		expect(provider.resolveModel?.("claude-opus-4-6-thinking(high)")).toBe("claude-opus-4-6-thinking");

		for (const operation of ["chat", "messages", "responses", "completions", "count_tokens"] as const) {
			expect(provider.supports(operation, "gemini-3-flash")).toBe(true);
		}
		// images/videos/speech 由 xAI 与 OpenAI 兼容图片模型承接，antigravity 只走对话入口。
		for (const operation of [
			"images.generations",
			"images.edits",
			"videos",
			"speech",
			"compact",
			"models",
			"live",
			"realtime",
			"alpha.search",
		] as const) {
			expect(provider.supports(operation, "gemini-3.1-flash-image")).toBe(false);
		}
	});

	it("非流式请求封装 v1internal 信封与固定头", async () => {
		const { account } = await seedAccount();
		const provider = createAntigravityProvider({ accounts: new SubscriptionAccountStore({ authDir: authDir }) });
		const plan = await provider.build(
			contextOf({
				account: account,
				operation: "chat",
				model: "gemini-3-flash",
				upstreamBody: {
					contents: [{ role: "user", parts: [{ text: "hi" }] }],
					safetySettings: [{ category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" }],
					toolConfig: { functionCallingConfig: { mode: "AUTO" } },
				},
			}),
		);
		const envelope = bodyOf(plan);
		const request = requestOf(plan);

		expect(plan.url).toBe(`${ANTIGRAVITY_CLOUDCODE_ENDPOINT}/${ANTIGRAVITY_API_VERSION}:generateContent`);
		expect(plan.protocol).toBe("gemini");
		expect(plan.stream).toBe(false);
		expect(plan.headers["Content-Type"]).toBe("application/json");
		expect(plan.headers["Authorization"]).toBe("Bearer ag-token");
		expect(plan.headers["User-Agent"]).toBe(ANTIGRAVITY_USER_AGENT);

		expect(envelope["project"]).toBe("proj-1");
		expect(envelope["model"]).toBe("gemini-3-flash");
		expect(envelope["userAgent"]).toBe("antigravity");
		expect(envelope["requestType"]).toBe("agent");
		expect(String(envelope["requestId"])).toMatch(/^agent-/);
		expect(String(request["sessionId"])).toMatch(/^-\d+$/);
		expect(request["contents"]).toEqual([{ role: "user", parts: [{ text: "hi" }] }]);
		// safetySettings 与顶层 toolConfig 都归一到 request 内。
		expect(request["safetySettings"]).toBeUndefined();
		expect(request["toolConfig"]).toEqual({ functionCallingConfig: { mode: "AUTO" } });
	});

	it("流式请求改用 streamGenerateContent 与 alt=sse", async () => {
		const { account } = await seedAccount();
		const provider = createAntigravityProvider({ accounts: new SubscriptionAccountStore({ authDir: authDir }) });
		const plan = await provider.build(
			contextOf({
				account: account,
				operation: "chat",
				model: "gemini-3-flash",
				stream: true,
				upstreamBody: { contents: [{ role: "user", parts: [{ text: "hi" }] }] },
			}),
		);

		expect(plan.url).toBe(`${ANTIGRAVITY_CLOUDCODE_ENDPOINT}/${ANTIGRAVITY_API_VERSION}:streamGenerateContent?alt=sse`);
		expect(plan.stream).toBe(true);
		expect(plan.headers["Accept"]).toBe("text/event-stream");
	});

	it("同一会话键得到稳定 sessionId，不同会话键不同", async () => {
		const { account } = await seedAccount();
		const provider = createAntigravityProvider({ accounts: new SubscriptionAccountStore({ authDir: authDir }) });
		const build = async (sessionKey: string): Promise<unknown> =>
			requestOf(
				await provider.build(
					contextOf({
						account: account,
						operation: "chat",
						model: "gemini-3-flash",
						sessionKey: sessionKey,
						upstreamBody: { contents: [{ role: "user", parts: [{ text: "hi" }] }] },
					}),
				),
			)["sessionId"];
		const first = await build("session-a");

		expect(await build("session-a")).toBe(first);
		expect(await build("session-b")).not.toBe(first);
	});

	it("Claude 模型加 VALIDATED 工具模式，并按目录上限截断 maxOutputTokens", async () => {
		const { account } = await seedAccount();
		const provider = createAntigravityProvider({ accounts: new SubscriptionAccountStore({ authDir: authDir }) });
		const plan = await provider.build(
			contextOf({
				account: account,
				operation: "messages",
				model: "claude-opus-4-6-thinking",
				upstreamBody: {
					contents: [{ role: "user", parts: [{ text: "hi" }] }],
					generationConfig: { maxOutputTokens: 100_000 },
					tools: [{ functionDeclarations: [{ name: "lookup" }] }],
				},
			}),
		);
		const request = requestOf(plan);
		const generationConfig = request["generationConfig"] as Record<string, unknown>;

		expect(request["toolConfig"]).toEqual({ functionCallingConfig: { mode: "VALIDATED" } });
		// claude-opus-4-6-thinking 目录上限 64000。
		expect(generationConfig["maxOutputTokens"]).toBe(64_000);
	});

	it("非 Claude 模型删除 maxOutputTokens", async () => {
		const { account } = await seedAccount();
		const provider = createAntigravityProvider({ accounts: new SubscriptionAccountStore({ authDir: authDir }) });
		const plan = await provider.build(
			contextOf({
				account: account,
				operation: "chat",
				model: "gemini-3.8-flash-high",
				upstreamBody: {
					contents: [{ role: "user", parts: [{ text: "hi" }] }],
					generationConfig: { maxOutputTokens: 8192, temperature: 0.4 },
				},
			}),
		);
		const generationConfig = requestOf(plan)["generationConfig"] as Record<string, unknown>;

		expect(generationConfig["maxOutputTokens"]).toBeUndefined();
		expect(generationConfig["temperature"]).toBe(0.4);
	});

	it("工具 schema 清洗：删除不支持关键字、enum 转描述、过滤 required", async () => {
		const { account } = await seedAccount();
		const provider = createAntigravityProvider({ accounts: new SubscriptionAccountStore({ authDir: authDir }) });
		const plan = await provider.build(
			contextOf({
				account: account,
				operation: "chat",
				model: "gemini-3.8-flash-high",
				upstreamBody: {
					contents: [{ role: "user", parts: [{ text: "hi" }] }],
					tools: [
						{
							functionDeclarations: [
								{
									name: "lookup",
									parametersJsonSchema: {
										type: "object",
										additionalProperties: false,
										properties: {
											query: { type: "string", format: "date", enum: ["a", "b"] },
											size: { anyOf: [{ type: "integer" }, { type: "null" }] },
										},
										required: ["query", "missing"],
									},
								},
							],
						},
					],
				},
			}),
		);
		const tools = requestOf(plan)["tools"] as Record<string, unknown>[];
		const declaration = (tools[0]?.["functionDeclarations"] as Record<string, unknown>[])[0];
		const parameters = declaration?.["parameters"] as Record<string, unknown>;
		const properties = parameters["properties"] as Record<string, Record<string, unknown>>;

		// parametersJsonSchema 会重命名为 parameters，上游只认后者。
		expect(declaration?.["parametersJsonSchema"]).toBeUndefined();
		expect(parameters["additionalProperties"]).toBeUndefined();
		expect(properties["query"]?.["format"]).toBeUndefined();
		expect(String(properties["query"]?.["description"])).toContain("format: date");
		expect(String(properties["query"]?.["description"])).toContain("allowed values: a, b");
		expect(properties["size"]).toMatchObject({ type: "integer", nullable: true });
		expect(parameters["required"]).toEqual(["query"]);
	});

	it("工具 schema 的 $ref 在协议翻译后仍能被内联", async () => {
		const { account } = await seedAccount();
		const provider = createAntigravityProvider({ accounts: new SubscriptionAccountStore({ authDir: authDir }) });
		const plan = await provider.build(
			contextOf({
				account: account,
				operation: "chat",
				model: "gemini-3-pro-preview",
				upstreamBody: {
					contents: [{ role: "user", parts: [{ text: "hi" }] }],
					tools: [
						{
							functionDeclarations: [
								{
									name: "lookup",
									parameters: {
										type: "object",
										properties: { item: { $ref: "#/$defs/Item" } },
										$defs: {
											Item: {
												type: "object",
												properties: { name: { type: "string", title: "Name" } },
												required: ["name"],
											},
										},
									},
								},
							],
						},
					],
				},
			}),
		);
		const tools = requestOf(plan)["tools"] as Record<string, unknown>[];
		const declaration = (tools[0]?.["functionDeclarations"] as Record<string, unknown>[])[0];
		const parameters = declaration?.["parameters"] as Record<string, unknown>;
		const properties = parameters["properties"] as Record<string, Record<string, unknown>>;
		expect(JSON.stringify(parameters)).not.toContain("$ref");
		expect(properties["item"]).toMatchObject({
			type: "object",
			properties: { name: { type: "string" } },
			required: ["name"],
		});
	});

	it("Antigravity schema 通道为空对象参数补 placeholder", async () => {
		const { account } = await seedAccount();
		const provider = createAntigravityProvider({ accounts: new SubscriptionAccountStore({ authDir: authDir }) });
		const plan = await provider.build(
			contextOf({
				account: account,
				operation: "chat",
				model: "gemini-3-pro-preview",
				upstreamBody: {
					contents: [{ role: "user", parts: [{ text: "hi" }] }],
					tools: [{ functionDeclarations: [{ name: "ping", parameters: { type: "object" } }] }],
				},
			}),
		);
		const tools = requestOf(plan)["tools"] as Record<string, unknown>[];
		const parameters = (tools[0]?.["functionDeclarations"] as Record<string, unknown>[])[0]?.["parameters"] as Record<
			string,
			unknown
		>;
		const properties = parameters["properties"] as Record<string, Record<string, unknown>>;

		expect(properties["reason"]).toMatchObject({ type: "string" });
		expect(parameters["required"]).toEqual(["reason"]);
	});

	it("Claude 5.5 的结构化输出改写成系统提示", async () => {
		const { account } = await seedAccount();
		const provider = createAntigravityProvider({ accounts: new SubscriptionAccountStore({ authDir: authDir }) });
		const plan = await provider.build(
			contextOf({
				account: account,
				operation: "messages",
				model: "claude-opus-5-5-high",
				upstreamBody: {
					contents: [{ role: "user", parts: [{ text: "hi" }] }],
					generationConfig: {
						responseSchema: { type: "object", properties: { answer: { type: "string" } } },
						responseMimeType: "application/json",
					},
					toolConfig: { functionCallingConfig: { mode: "VALIDATED" } },
				},
			}),
		);
		const request = requestOf(plan);
		const generationConfig = request["generationConfig"] as Record<string, unknown>;
		const toolConfig = request["toolConfig"] as Record<string, Record<string, unknown>>;
		const system = request["systemInstruction"] as Record<string, unknown>;
		const parts = system["parts"] as Record<string, unknown>[];

		expect(generationConfig["responseSchema"]).toBeUndefined();
		expect(generationConfig["responseMimeType"]).toBeUndefined();
		expect(String(parts[0]?.["text"])).toContain("JSON Schema:");
		expect(toolConfig["functionCallingConfig"]?.["mode"]).toBe("AUTO");
	});

	it("图片模型标记 image_gen 请求类型", async () => {
		const { account } = await seedAccount();
		const provider = createAntigravityProvider({ accounts: new SubscriptionAccountStore({ authDir: authDir }) });
		const plan = await provider.build(
			contextOf({
				account: account,
				operation: "chat",
				model: "gemini-3.1-flash-image",
				upstreamBody: { contents: [{ role: "user", parts: [{ text: "画一只猫" }] }] },
			}),
		);
		const envelope = bodyOf(plan);

		expect(envelope["requestType"]).toBe("image_gen");
		expect(String(envelope["requestId"])).toMatch(/^image_gen\/\d+\/[0-9a-f-]+\/12$/);
	});

	it("账号 base_url 与 user_agent 覆盖默认值", async () => {
		const { account } = await seedAccount({ base_url: "https://ag.example.test/", user_agent: "custom-agent/1.0" });
		const provider = createAntigravityProvider({ accounts: new SubscriptionAccountStore({ authDir: authDir }) });
		const plan = await provider.build(
			contextOf({
				account: account,
				operation: "chat",
				model: "gemini-3-flash",
				upstreamBody: { contents: [{ role: "user", parts: [{ text: "hi" }] }] },
			}),
		);

		expect(plan.url).toBe(`https://ag.example.test/${ANTIGRAVITY_API_VERSION}:generateContent`);
		expect(plan.headers["User-Agent"]).toBe("custom-agent/1.0");
	});

	it("缺少 project_id 与空凭据分别报 503", async () => {
		const { account: withoutProject } = await seedAccount({ project_id: undefined });
		// 写回时 undefined 会被 JSON 去掉，等价于账号文件里没有 project_id。
		const provider = createAntigravityProvider({ accounts: new SubscriptionAccountStore({ authDir: authDir }) });

		await expect(
			provider.build(
				contextOf({
					account: withoutProject,
					operation: "chat",
					model: "gemini-3-flash",
					upstreamBody: { contents: [{ role: "user", parts: [{ text: "hi" }] }] },
				}),
			),
		).rejects.toMatchObject({ statusCode: 503 });

		const { account: withProject } = await seedAccount();
		await expect(
			provider.build({
				...contextOf({
					account: withProject,
					operation: "chat",
					model: "gemini-3-flash",
					upstreamBody: { contents: [{ role: "user", parts: [{ text: "hi" }] }] },
				}),
				credential: " ",
			}),
		).rejects.toMatchObject({ statusCode: 503 });
	});

	it("countTokens 使用独立的请求体与响应形状", async () => {
		const { account } = await seedAccount();
		const provider = createAntigravityProvider({ accounts: new SubscriptionAccountStore({ authDir: authDir }) });
		const context = contextOf({
			account: account,
			operation: "count_tokens",
			model: "claude-sonnet-4-6",
			inbound: "messages",
			// 入口 body 与翻译后的 upstreamBody 必须不同，否则无法发现读错来源。
			body: { messages: [{ role: "user", content: "raw" }], max_tokens: 1 },
			upstreamBody: {
				contents: [{ role: "user", parts: [{ text: "hi" }] }],
				model: "claude-sonnet-4-6",
				safetySettings: [{ category: "HARM_CATEGORY_HATE_SPEECH" }],
				toolConfig: { functionCallingConfig: { mode: "AUTO" } },
				labels: { a: "b" },
				sessionId: "-1",
			},
		});
		const plan = await provider.build(context);
		const body = bodyOf(plan);

		expect(plan.url).toBe(`${ANTIGRAVITY_CLOUDCODE_ENDPOINT}/${ANTIGRAVITY_API_VERSION}:countTokens`);
		expect(plan.protocol).toBe("messages");
		expect(Object.keys(body)).toEqual(["request"]);
		expect(body["request"]).toEqual({ contents: [{ role: "user", parts: [{ text: "hi" }] }] });

		expect(provider.transformUpstreamBody?.(context, { totalTokens: 42 })).toEqual({ input_tokens: 42 });
		expect(
			provider.transformUpstreamBody?.(
				{ ...context, inbound: "chat" },
				{ totalTokens: 42 },
			),
		).toEqual({ input_tokens: 42, total_tokens: 42 });
	});

	it("上一跳响应与事件都拆掉 response 信封", async () => {
		const { account } = await seedAccount();
		const provider = createAntigravityProvider({ accounts: new SubscriptionAccountStore({ authDir: authDir }) });
		const context = contextOf({ account: account, operation: "chat", model: "gemini-3-flash" });

		expect(
			provider.transformUpstreamBody?.(context, {
				response: { candidates: [{ content: { parts: [{ text: "hi" }] } }] },
				traceId: "t-1",
			}),
		).toEqual({ candidates: [{ content: { parts: [{ text: "hi" }] } }] });
		// 没有信封时原样返回，兼容部分上游直接回 Gemini 响应体。
		expect(provider.transformUpstreamBody?.(context, { candidates: [] })).toEqual({ candidates: [] });
		expect(provider.transformUpstreamEvent?.(context, { response: { candidates: [] } })).toEqual({ candidates: [] });
		expect(provider.transformUpstreamEvent?.(context, { candidates: [] })).toEqual({ candidates: [] });
	});

	it("Antigravity Claude 模型保留 Claude 签名且不补 Gemini bypass", async () => {
		const { account } = await seedAccount();
		const provider = createAntigravityProvider({ accounts: new SubscriptionAccountStore({ authDir: authDir }) });
		const plan = await provider.build(
			contextOf({
				account: account,
				operation: "chat",
				model: "claude-opus-4-6-thinking",
				upstreamBody: {
					contents: [
						{
							role: "model",
							parts: [
								{
									functionCall: { name: "lookup", args: {} },
									thoughtSignature: "Q2xhdWRlLXNpZ25hdHVyZQ==",
								},
								{
									functionCall: { name: "other", args: {} },
									thoughtSignature: "0279f465-965e-4262-8138-3fe1bb64d27f",
								},
							],
						},
					],
				},
			}),
		);
		const parts = records(records(requestOf(plan)["contents"])[0]?.["parts"]);
		expect(parts[0]?.["thoughtSignature"]).toBe("Q2xhdWRlLXNpZ25hdHVyZQ==");
		expect(parts[1]?.["thoughtSignature"]).toBeUndefined();
	});

	it("Gemini 目标为跨供应商首个 functionCall 补 bypass", async () => {
		const { account } = await seedAccount();
		const provider = createAntigravityProvider({ accounts: new SubscriptionAccountStore({ authDir: authDir }) });
		const plan = await provider.build(
			contextOf({
				account: account,
				operation: "chat",
				model: "gemini-3-flash",
				upstreamBody: {
					contents: [
						{
							role: "model",
							parts: [{ functionCall: { name: "lookup", args: {} } }],
						},
						{
							role: "user",
							parts: [{ functionResponse: { name: "lookup", response: { result: "ok" } } }],
						},
					],
				},
			}),
		);
		const request = requestOf(plan);
		const contents = request["contents"] as Record<string, unknown>[];
		const parts = contents[0]?.["parts"] as Record<string, unknown>[];
		expect(parts[0]?.["thoughtSignature"]).toBe(GEMINI_SKIP_THOUGHT_SIGNATURE_VALIDATOR);
	});

	it("quota 走 Cloud Code 额度接口并映射窗口", async () => {
		const { account } = await seedAccount();
		const { calls, fetchImpl } = stubFetch([
			{ body: { groups: [{ displayName: "Gemini", buckets: [{ bucketId: "pro", displayName: "Pro", remainingFraction: 0.65 }] }] } },
		]);
		const provider = createAntigravityProvider({
			accounts: new SubscriptionAccountStore({ authDir: authDir }),
			fetch: fetchImpl,
		});
		const snapshot = await provider.quota(account);

		expect(calls[0]?.url).toBe(`${ANTIGRAVITY_CLOUDCODE_ENDPOINT}/${ANTIGRAVITY_API_VERSION}:retrieveUserQuotaSummary`);
		expect(calls[0]?.headers["Authorization"]).toBe("Bearer ag-token");
		expect(snapshot.windows?.[0]).toMatchObject({ name: "Pro", remainingFraction: 0.65 });
		expect(Number.isNaN(Date.parse(snapshot.fetchedAt))).toBe(false);
	});

	it("catalog 返回 Antigravity 静态目录", async () => {
		const provider = createAntigravityProvider({ accounts: new SubscriptionAccountStore({ authDir: authDir }) });
		const models = await provider.catalog();

		expect(models.length).toBeGreaterThan(0);
		expect(models.every((model) => model.protocol === "gemini")).toBe(true);
		expect(models.some((model) => model.id === "claude-opus-4-6-thinking")).toBe(true);
	});
});
