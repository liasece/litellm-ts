/**
 * xAI 订阅 Provider 适配器测试。
 *
 * 全部用例只依赖注入的 fetch 与临时 auth 目录：不发真实网络请求，凭据用固定串，
 * 断言集中在「入口操作 → 上游 URL / 请求头 / 请求体」的映射与错误路径。
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SubscriptionAccountStore } from "../accountStore";
import type {
	SubscriptionAccount,
	SubscriptionInboundProtocol,
	SubscriptionOperation,
	SubscriptionUpstreamContext,
	SubscriptionUpstreamPlan,
} from "../types";
import { createXaiProvider } from "./xai";

/** 一次被 stub 的 fetch 调用。 */
interface StubCall {
	/** 请求 URL。 */
	readonly url: string;
	/** 请求方法。 */
	readonly method: string;
	/** 请求体（已字符串化）。 */
	readonly body: string | undefined;
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
	authDir = mkdtempSync(path.join(tmpdir(), "xai-provider-"));
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
		const body = typeof init?.body === "string" ? init.body : undefined;
		calls.push({ url: String(input), method: init?.method ?? "GET", body: body });
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
 * 写入一个 xAI 账号并返回仓库与解析结果。
 * @param raw - auth 文件的额外字段
 * @returns 账号仓库与账号
 * @throws {Error} 账号文件未产生可解析账号时抛出
 */
async function seedAccount(
	raw: Record<string, unknown>,
): Promise<{ readonly store: SubscriptionAccountStore; readonly account: SubscriptionAccount }> {
	const store = new SubscriptionAccountStore({ authDir: authDir });
	await store.writeRaw("xai-1.json", { type: "xai", auth_kind: "oauth", access_token: "xai-token", ...raw });
	const accounts = await store.list("xai");
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
function contextOf(
	options: {
		readonly account: SubscriptionAccount;
		readonly operation: SubscriptionOperation;
		readonly model: string;
		readonly body?: Record<string, unknown>;
		readonly upstreamBody?: Record<string, unknown>;
		readonly inbound?: SubscriptionInboundProtocol;
		readonly headers?: Record<string, string>;
		readonly stream?: boolean;
		readonly sessionKey?: string;
		readonly rawBody?: unknown;
	},
): SubscriptionUpstreamContext {
	const body = options.body ?? {};
	return {
		source: "xai",
		operation: options.operation,
		model: options.model,
		inbound: options.inbound ?? "responses",
		body: body,
		headers: options.headers ?? {},
		rawBody: options.rawBody,
		stream: options.stream ?? false,
		sessionKey: options.sessionKey ?? "session-1",
		upstream: "responses",
		upstreamBody: options.upstreamBody ?? body,
		account: options.account,
		credential: "xai-token",
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

describe("createXaiProvider", () => {
	it("support 矩阵：对话与媒体操作按模型族承接，其余操作拒绝", async () => {
		const { account } = await seedAccount({});
		const provider = createXaiProvider({ accounts: new SubscriptionAccountStore({ authDir: authDir }) });

		expect(provider.source).toBe("xai");
		expect(provider.displayName).toBe("xAI");
		expect(account.source).toBe("xai");

		for (const operation of ["chat", "messages", "responses", "completions", "compact"] as const) {
			expect(provider.supports(operation, "grok-4.7")).toBe(true);
		}
		expect(provider.supports("images.generations", "grok-imagine-image")).toBe(true);
		expect(provider.supports("images.edits", "grok-imagine-image-quality")).toBe(true);
		expect(provider.supports("videos", "grok-imagine-video")).toBe(true);
		expect(provider.supports("speech", "grok-tts")).toBe(true);

		// 媒体操作按模型族区分，不能把对话模型当成图片/视频/语音模型。
		expect(provider.supports("images.generations", "grok-4.7")).toBe(false);
		expect(provider.supports("videos", "grok-imagine-image")).toBe(false);
		expect(provider.supports("speech", "grok-4.7")).toBe(false);
		for (const operation of ["count_tokens", "models", "live", "realtime", "alpha.search"] as const) {
			expect(provider.supports(operation, "grok-4.7")).toBe(false);
		}
	});

	it("route 固定 responses，resolveModel 去掉思考后缀", async () => {
		const { account } = await seedAccount({});
		const provider = createXaiProvider({ accounts: new SubscriptionAccountStore({ authDir: authDir }) });

		expect(provider.route(contextOf({ account: account, operation: "chat", model: "grok-4.7" }))).toBe("responses");
		expect(provider.resolveModel?.("grok-4.7(high)")).toBe("grok-4.7");
		expect(provider.resolveModel?.("grok-4.7")).toBe("grok-4.7");
	});

	it("OAuth 账号的对话请求走 CLI chat-proxy 并带 CLI 身份头", async () => {
		const { account } = await seedAccount({ auth_kind: "oauth" });
		const provider = createXaiProvider({ accounts: new SubscriptionAccountStore({ authDir: authDir }) });
		const plan = await provider.build(
			contextOf({
				account: account,
				operation: "responses",
				model: "grok-4.7",
				body: { input: "hi" },
			}),
		);

		expect(plan.url).toBe("https://cli-chat-proxy.grok.com/v1/responses");
		expect(plan.method).toBe("POST");
		expect(plan.protocol).toBe("responses");
		expect(plan.stream).toBe(false);
		expect(plan.headers["Authorization"]).toBe("Bearer xai-token");
		expect(plan.headers["X-XAI-Token-Auth"]).toBe("xai-grok-cli");
		expect(plan.headers["x-grok-client-identifier"]).toBe("grok-shell");
		expect(plan.headers["x-authenticateresponse"]).toBe("authenticate-response");
		expect(plan.headers["x-grok-client-version"]).toMatch(/^\d+\.\d+\.\d+$/);
		expect(plan.headers["User-Agent"]).toBe(`xai-grok-workspace/${plan.headers["x-grok-client-version"]}`);
		// OAuth 账号的会话键要落到 x-grok-conv-id 与 prompt_cache_key 上。
		expect(plan.headers["x-grok-conv-id"]).toBe("session-1");
		expect(bodyOf(plan)["prompt_cache_key"]).toBe("session-1");
	});

	it("using_api 账号走官方 API 并转发客户端 UA", async () => {
		const { account } = await seedAccount({ auth_kind: "oauth", using_api: true });
		const provider = createXaiProvider({ accounts: new SubscriptionAccountStore({ authDir: authDir }) });
		const plan = await provider.build(
			contextOf({
				account: account,
				operation: "chat",
				model: "grok-4.7",
				body: { input: "hi" },
				stream: true,
				headers: { "user-agent": "codex-cli/0.9" },
			}),
		);

		expect(plan.url).toBe("https://api.x.ai/v1/responses");
		expect(plan.stream).toBe(true);
		expect(plan.headers["Accept"]).toBe("text/event-stream");
		expect(plan.headers["User-Agent"]).toBe("codex-cli/0.9");
		expect(plan.headers["X-XAI-Token-Auth"]).toBeUndefined();
		expect(bodyOf(plan)["stream"]).toBe(true);
	});

	it("OAuth 账号显式配置 base_url 时改用该地址", async () => {
		const { account } = await seedAccount({ auth_kind: "oauth", base_url: "https://example.test/v1/" });
		const provider = createXaiProvider({ accounts: new SubscriptionAccountStore({ authDir: authDir }) });
		const plan = await provider.build(
			contextOf({ account: account, operation: "messages", model: "grok-4.7", body: { input: "hi" } }),
		);

		expect(plan.url).toBe("https://example.test/v1/responses");
		// 非 CLI 地址不再附加 CLI 身份头，但仍保留 Grok 版本 UA。
		expect(plan.headers["X-XAI-Token-Auth"]).toBeUndefined();
		expect(plan.headers["User-Agent"]).toContain("xai-grok-workspace/");
	});

	it("对话请求体按 xAI Responses 规则裁剪字段", async () => {
		const { account } = await seedAccount({});
		const provider = createXaiProvider({ accounts: new SubscriptionAccountStore({ authDir: authDir }) });
		const plan = await provider.build(
			contextOf({
				account: account,
				operation: "chat",
				model: "grok-4.7",
				upstreamBody: {
					model: "grok-4.7",
					input: [{ type: "message", role: "user", content: "hi" }],
					previous_response_id: "resp_1",
					prompt_cache_retention: "24h",
					safety_identifier: "user_1",
					stream_options: { include_usage: true },
					stop: ["END"],
					temperature: 0.2,
				},
			}),
		);
		const body = bodyOf(plan);

		expect(body["model"]).toBe("grok-4.7");
		expect(body["stream"]).toBe(false);
		expect(body["temperature"]).toBe(0.2);
		for (const field of ["previous_response_id", "prompt_cache_retention", "safety_identifier", "stream_options", "stop"]) {
			expect(body[field]).toBeUndefined();
		}
	});

	it("tools 过滤：丢弃 tool_search、custom 转 function、补齐 parameters", async () => {
		const { account } = await seedAccount({});
		const provider = createXaiProvider({ accounts: new SubscriptionAccountStore({ authDir: authDir }) });
		const tools = Array.from({ length: 205 }, (_unused, index) => ({
			type: "function",
			name: `f${index}`,
			parameters: { type: "object", properties: {} },
		}));
		const plan = await provider.build(
			contextOf({
				account: account,
				operation: "responses",
				model: "grok-4.7",
				upstreamBody: {
					input: "hi",
					tools: [
						{ type: "tool_search" },
						{ type: "custom", name: "shell", format: { type: "text" } },
						{ type: "web_search", external_web_access: true, search_context_size: "high" },
						{ type: "image_generation" },
						...tools,
					],
					tool_choice: "auto",
					parallel_tool_calls: true,
				},
			}),
		);
		const body = bodyOf(plan);
		const kept = body["tools"] as Record<string, unknown>[];

		expect(kept).toHaveLength(200);
		expect(kept.some((tool) => tool["type"] === "tool_search")).toBe(false);
		// grok-4.7 支持原生 image_generation，工具要保留。
		expect(kept.some((tool) => tool["type"] === "image_generation")).toBe(true);
		const custom = kept.find((tool) => tool["name"] === "shell");
		expect(custom?.["type"]).toBe("function");
		expect(custom?.["parameters"]).toEqual({ type: "object", properties: {} });
		const webSearch = kept.find((tool) => tool["type"] === "web_search");
		expect(webSearch?.["external_web_access"]).toBeUndefined();
		expect(webSearch?.["search_context_size"]).toBeUndefined();
		expect(body["tool_choice"]).toBe("auto");
		expect(body["parallel_tool_calls"]).toBe(true);
	});

	it("4.20 系列不保留 image_generation，且全部工具被过滤后清掉选择参数", async () => {
		const { account } = await seedAccount({});
		const provider = createXaiProvider({ accounts: new SubscriptionAccountStore({ authDir: authDir }) });
		const plan = await provider.build(
			contextOf({
				account: account,
				operation: "responses",
				model: "grok-4.20-fast",
				upstreamBody: {
					model: "grok-4.20-fast",
					input: "hi",
					tools: [{ type: "image_generation" }, { type: "tool_search" }],
					tool_choice: "auto",
					parallel_tool_calls: false,
				},
			}),
		);
		const body = bodyOf(plan);

		expect(body["tools"]).toBeUndefined();
		expect(body["tool_choice"]).toBeUndefined();
		expect(body["parallel_tool_calls"]).toBeUndefined();
	});

	it("input_image 的 image_url 归一化为 url", async () => {
		const { account } = await seedAccount({});
		const provider = createXaiProvider({ accounts: new SubscriptionAccountStore({ authDir: authDir }) });
		const plan = await provider.build(
			contextOf({
				account: account,
				operation: "responses",
				model: "grok-4.7",
				upstreamBody: {
					input: [
						{
							type: "message",
							role: "user",
							content: [
								{ type: "input_text", text: "看图" },
								{ type: "input_image", image_url: "https://img.test/a.png" },
								{ type: "input_image", image_url: { url: "https://img.test/b.png" } },
								{ type: "input_image", url: "https://img.test/c.png", image_url: "https://img.test/d.png" },
							],
						},
					],
				},
			}),
		);
		const content = (bodyOf(plan)["input"] as Record<string, unknown>[])[0]?.["content"] as Record<string, unknown>[];

		expect(content[1]?.["url"]).toBe("https://img.test/a.png");
		expect(content[1]?.["image_url"]).toBeUndefined();
		expect(content[2]?.["url"]).toBe("https://img.test/b.png");
		expect(content[3]?.["url"]).toBe("https://img.test/c.png");
	});

	it("compact 走官方 API，保留 previous_response_id 并去掉生成参数", async () => {
		const { account } = await seedAccount({ auth_kind: "oauth" });
		const provider = createXaiProvider({ accounts: new SubscriptionAccountStore({ authDir: authDir }) });
		const plan = await provider.build(
			contextOf({
				account: account,
				operation: "compact",
				model: "grok-4.7",
				body: { input: "hi", previous_response_id: "resp_9" },
				upstreamBody: {
					model: "grok-4.7",
					input: "hi",
					stream: true,
					tools: [{ type: "function", name: "f", parameters: { type: "object" } }],
					tool_choice: "auto",
					parallel_tool_calls: true,
					max_output_tokens: 1000,
					temperature: 0.5,
					top_p: 0.9,
					top_k: 5,
					stop: ["END"],
				},
			}),
		);
		const body = bodyOf(plan);

		// cli-chat-proxy 没有 /responses/compact，必须落官方地址。
		expect(plan.url).toBe("https://api.x.ai/v1/responses/compact");
		expect(body["model"]).toBe("grok-4.7");
		expect(body["previous_response_id"]).toBe("resp_9");
		for (const field of ["stream", "tools", "tool_choice", "parallel_tool_calls", "max_output_tokens", "temperature", "top_p", "top_k", "stop"]) {
			expect(body[field]).toBeUndefined();
		}
	});

	it("compact 响应改写为 Responses 对象", async () => {
		const { account } = await seedAccount({});
		const provider = createXaiProvider({ accounts: new SubscriptionAccountStore({ authDir: authDir }) });
		const context = contextOf({ account: account, operation: "compact", model: "grok-4.7" });
		const result = provider.transformUpstreamBody?.(context, {
			object: "response.compaction",
			id: "cmp_abc",
			output: [{ text: "摘要" }],
			created_at: 1_700_000_000,
			usage: { total_tokens: 12 },
		});

		expect(result?.["id"]).toBe("resp_abc");
		expect(result?.["object"]).toBe("response");
		expect(result?.["status"]).toBe("completed");
		expect(result?.["created_at"]).toBe(1_700_000_000);
		expect(result?.["completed_at"]).toBe(1_700_000_000);
		expect(result?.["usage"]).toEqual({ total_tokens: 12 });
		const output = result?.["output"] as Record<string, unknown>[];
		expect(output).toHaveLength(1);
		expect(output[0]?.["type"]).toBe("compaction");
		expect(output[0]?.["id"]).toBe("cmp_abc");
		expect(output[0]?.["text"]).toBe("摘要");
	});

	it("图片生成把 size 映射为纵横比与分辨率", async () => {
		const { account } = await seedAccount({});
		const provider = createXaiProvider({ accounts: new SubscriptionAccountStore({ authDir: authDir }) });
		const plan = await provider.build(
			contextOf({
				account: account,
				operation: "images.generations",
				model: "grok-imagine-image",
				body: { prompt: "海边落日", size: "1792x1024", n: 2, quality: "high", response_format: "b64_json" },
			}),
		);
		const body = bodyOf(plan);

		expect(plan.url).toBe("https://cli-chat-proxy.grok.com/v1/images/generations");
		expect(body).toEqual({
			model: "grok-imagine-image",
			prompt: "海边落日",
			aspect_ratio: "16:9",
			resolution: "1k",
			response_format: "b64_json",
			quality: "high",
			n: 2,
		});
	});

	it("图片生成默认 1:1 与 1k，2048 尺寸升到 2k", async () => {
		const { account } = await seedAccount({});
		const provider = createXaiProvider({ accounts: new SubscriptionAccountStore({ authDir: authDir }) });

		const defaulted = await provider.build(
			contextOf({ account: account, operation: "images.generations", model: "grok-imagine-image", body: { prompt: "x" } }),
		);
		expect(bodyOf(defaulted)["aspect_ratio"]).toBe("1:1");
		expect(bodyOf(defaulted)["resolution"]).toBe("1k");

		const large = await provider.build(
			contextOf({
				account: account,
				operation: "images.generations",
				model: "grok-imagine-image",
				body: { prompt: "x", size: "2048x2048" },
			}),
		);
		expect(bodyOf(large)["aspect_ratio"]).toBe("1:1");
		expect(bodyOf(large)["resolution"]).toBe("2k");
	});

	it("图片编辑把 multipart 源图编码为 data URL", async () => {
		const { account } = await seedAccount({});
		const provider = createXaiProvider({ accounts: new SubscriptionAccountStore({ authDir: authDir }) });
		const form = new FormData();
		form.set("model", "grok-imagine-image-quality");
		form.set("prompt", "换成水彩");
		form.append("image", new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" }));
		const plan = await provider.build(
			contextOf({
				account: account,
				operation: "images.edits",
				model: "grok-imagine-image",
				rawBody: form,
			}),
		);
		const body = bodyOf(plan);
		const image = body["image"] as Record<string, unknown>;

		expect(plan.url).toBe("https://cli-chat-proxy.grok.com/v1/images/edits");
		expect(body["model"]).toBe("grok-imagine-image-quality");
		expect(body["prompt"]).toBe("换成水彩");
		expect(image["type"]).toBe("image_url");
		expect(image["url"]).toBe(`data:image/png;base64,${Buffer.from([1, 2, 3]).toString("base64")}`);
	});

	it("图片编辑缺少源图时报 400", async () => {
		const { account } = await seedAccount({});
		const provider = createXaiProvider({ accounts: new SubscriptionAccountStore({ authDir: authDir }) });

		await expect(
			provider.build(
				contextOf({
					account: account,
					operation: "images.edits",
					model: "grok-imagine-image",
					body: { prompt: "换成水彩" },
				}),
			),
		).rejects.toMatchObject({ statusCode: 400 });
	});

	it("视频生成把 size 映射为 9:16 并限制时长", async () => {
		const { account } = await seedAccount({});
		const provider = createXaiProvider({ accounts: new SubscriptionAccountStore({ authDir: authDir }) });
		const plan = await provider.build(
			contextOf({
				account: account,
				operation: "videos",
				model: "grok-imagine-video",
				body: { prompt: "城市夜景", seconds: "99", size: "720x1280", image: { url: "https://img.test/a.png" } },
			}),
		);
		const body = bodyOf(plan);

		expect(plan.url).toBe("https://cli-chat-proxy.grok.com/v1/videos/generations");
		expect(body).toEqual({
			model: "grok-imagine-video",
			prompt: "城市夜景",
			duration: "15",
			aspect_ratio: "9:16",
			resolution: "720p",
			image: { url: "https://img.test/a.png" },
		});
	});

	it("视频生成不能同时给 image 与 reference_images", async () => {
		const { account } = await seedAccount({});
		const provider = createXaiProvider({ accounts: new SubscriptionAccountStore({ authDir: authDir }) });

		await expect(
			provider.build(
				contextOf({
					account: account,
					operation: "videos",
					model: "grok-imagine-video-1.5",
					body: {
						prompt: "x",
						image: "https://img.test/a.png",
						reference_images: ["https://img.test/b.png"],
					},
				}),
			),
		).rejects.toMatchObject({ statusCode: 400 });
	});

	it("视频轮询使用 GET 与 request_id", async () => {
		const { account } = await seedAccount({});
		const provider = createXaiProvider({ accounts: new SubscriptionAccountStore({ authDir: authDir }) });
		const plan = await provider.build(
			contextOf({
				account: account,
				operation: "videos",
				model: "grok-imagine-video",
				body: { request_id: "req 1" },
			}),
		);

		expect(plan.method).toBe("GET");
		expect(plan.url).toBe("https://cli-chat-proxy.grok.com/v1/videos/req%201");
	});

	it("语音合成映射音色、格式与模型，并固定官方地址", async () => {
		const { account } = await seedAccount({ auth_kind: "oauth" });
		const provider = createXaiProvider({ accounts: new SubscriptionAccountStore({ authDir: authDir }) });
		const plan = await provider.build(
			contextOf({
				account: account,
				operation: "speech",
				model: "gpt-4o-mini-tts",
				body: { input: "你好", voice: "nova", response_format: "wav", speed: 1.25 },
			}),
		);
		const body = bodyOf(plan);

		// cli-chat-proxy 没有 /tts，必须落官方地址。
		expect(plan.url).toBe("https://api.x.ai/v1/tts");
		expect(plan.headers["Accept"]).toBe("audio/mpeg");
		expect(body).toEqual({
			text: "你好",
			voice_id: "eve",
			language: "auto",
			speed: 1.25,
			output_format: { codec: "wav", sample_rate: 24_000 },
			model: "grok-tts",
		});
	});

	it("语音合成拒绝不支持的模型与格式", async () => {
		const { account } = await seedAccount({});
		const provider = createXaiProvider({ accounts: new SubscriptionAccountStore({ authDir: authDir }) });

		await expect(
			provider.build(
				contextOf({ account: account, operation: "speech", model: "grok-4.7", body: { input: "x" } }),
			),
		).rejects.toMatchObject({ statusCode: 400 });
		await expect(
			provider.build(
				contextOf({
					account: account,
					operation: "speech",
					model: "grok-tts",
					body: { input: "x", response_format: "flac" },
				}),
			),
		).rejects.toMatchObject({ statusCode: 400 });
		await expect(
			provider.build(contextOf({ account: account, operation: "speech", model: "grok-tts", body: { input: " " } })),
		).rejects.toMatchObject({ statusCode: 400 });
	});

	it("空凭据与空模型分别报 unavailable 与 badRequest", async () => {
		const { account } = await seedAccount({});
		const provider = createXaiProvider({ accounts: new SubscriptionAccountStore({ authDir: authDir }) });
		const missingCredential: SubscriptionUpstreamContext = {
			...contextOf({ account: account, operation: "responses", model: "grok-4.7", body: { input: "hi" } }),
			credential: "  ",
		};

		await expect(provider.build(missingCredential)).rejects.toMatchObject({ statusCode: 503 });
		await expect(
			provider.build(contextOf({ account: account, operation: "responses", model: " ", body: { input: "hi" } })),
		).rejects.toMatchObject({ statusCode: 400 });
	});

	it("quota 把共享额度转换成快照", async () => {
		const { account } = await seedAccount({ user_id: "user-1" });
		const { calls, fetchImpl } = stubFetch([
			{ body: { config: { creditUsagePercent: 30, currentPeriod: { type: "weekly", end: "2026-11-17T00:00:00Z" } } } },
			{ body: { config: {} } },
		]);
		const provider = createXaiProvider({ accounts: new SubscriptionAccountStore({ authDir: authDir }), fetch: fetchImpl });
		const snapshot = await provider.quota(account);

		expect(calls.length).toBeGreaterThan(0);
		expect(snapshot.windows?.[0]).toEqual({
			name: "weekly",
			remainingFraction: 0.7,
			resetTime: "2026-11-17T00:00:00.000Z",
		});
		expect(Number.isNaN(Date.parse(snapshot.fetchedAt))).toBe(false);
	});

	it("xAI 删除外来 reasoning encrypted_content", async () => {
		const { account } = await seedAccount({});
		const provider = createXaiProvider({ accounts: new SubscriptionAccountStore({ authDir: authDir }) });
		const plan = await provider.build(
			contextOf({
				account: account,
				operation: "responses",
				model: "grok-4.7",
				body: {
					input: [
						{ type: "reasoning", encrypted_content: "gAAAA-foreign" },
						{ type: "message", role: "user", content: "hi" },
					],
				},
			}),
		);
		const body = bodyOf(plan);
		expect(body["input"]).toEqual([{ type: "message", role: "user", content: "hi" }]);
	});

	it("catalog 返回 xAI 静态目录", async () => {
		const provider = createXaiProvider({ accounts: new SubscriptionAccountStore({ authDir: authDir }) });
		const models = await provider.catalog();

		expect(models.length).toBeGreaterThan(0);
		expect(models.every((model) => model.protocol === "responses")).toBe(true);
		expect(models.some((model) => model.id === "grok-4.7")).toBe(true);
	});
});
