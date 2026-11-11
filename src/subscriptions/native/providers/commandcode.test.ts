/**
 * CommandCode 订阅 Provider 适配器测试。
 *
 * 覆盖契约（来源/鉴权）、3×3 路由矩阵、三条上游腿的 URL/请求头/请求体特化、
 * 工具命名空间的拍平与还原、reasoning 回填、目录与额度的失败回退。全部请求由
 * 注入的 fetch 假实现承接，不访问网络。
 */

import { ApiError } from "../../../core/api/ApiError";
import type { SubscriptionAccountStore } from "../accountStore";
import { COMMANDCODE_API_BASE, builtinCatalogForSource } from "../catalog/dynamicCatalog";
import type {
	SubscriptionAccount,
	SubscriptionInboundProtocol,
	SubscriptionOperation,
	SubscriptionProviderAdapter,
	SubscriptionRequestContext,
	SubscriptionSource,
	SubscriptionUpstreamContext,
	SubscriptionWireProtocol,
} from "../types";
import { createStreamTranslator, translateRequest, translateResponse } from "../protocol/types";
import type { ProtocolEvent } from "../protocol/types";
import { createCommandCodeProvider } from "./commandcode";
import {
	COMMANDCODE_ANTHROPIC_VERSION,
	COMMANDCODE_EMPTY_SESSION_ID,
	COMMANDCODE_ENDPOINT_PATHS,
	COMMANDCODE_MAX_TOOL_NAME_LENGTH,
	COMMANDCODE_SESSION_HEADER,
	commandCodeNamespacedToolName,
	commandCodeSessionValue,
	commandCodeToolNamespaces,
} from "./commandcodeProtocol";
import type { SubscriptionProviderDependencies } from "./types";

/** 一次被记录的请求。 */
interface RecordedCall {
	readonly url: string;
	readonly init: RequestInit;
}

/** 用固定响应构造 fetch，并记录每次调用。 */
function mockFetch(
	handler: (url: string) => { status: number; body: unknown },
): { calls: RecordedCall[]; fetchImpl: typeof fetch } {
	const calls: RecordedCall[] = [];
	const fetchImpl = (async (input: unknown, init?: RequestInit): Promise<Response> => {
		const url = String(input);
		calls.push({ url: url, init: init ?? {} });
		const { status, body } = handler(url);
		return {
			ok: status >= 200 && status < 300,
			status: status,
			text: async (): Promise<string> => (typeof body === "string" ? body : JSON.stringify(body)),
			json: async (): Promise<unknown> => body,
		} as unknown as Response;
	}) as unknown as typeof fetch;
	return { calls: calls, fetchImpl: fetchImpl };
}

/** 构造一个可用的 CommandCode 账号。 */
function makeAccount(overrides: Partial<SubscriptionAccount> = {}): SubscriptionAccount {
	return {
		id: "acct-commandcode-1",
		source: "commandcode",
		fileName: "commandcode-1.json",
		path: "/tmp/auths/commandcode-1.json",
		disabled: false,
		weight: 1,
		raw: { type: "commandcode", api_key: "cc-test-key" },
		...overrides,
	};
}

/** 用内存账号列表构造账号仓库。 */
function makeStore(accounts: readonly SubscriptionAccount[]): SubscriptionAccountStore {
	return {
		list: async (source?: SubscriptionSource): Promise<readonly SubscriptionAccount[]> =>
			source === undefined ? accounts : accounts.filter((account) => account.source === source),
	} as unknown as SubscriptionAccountStore;
}

/** 创建被测适配器。 */
function makeProvider(
	options: { accounts?: readonly SubscriptionAccount[]; fetch?: typeof fetch } = {},
): SubscriptionProviderAdapter {
	const dependencies: SubscriptionProviderDependencies = {
		accounts: makeStore(options.accounts ?? [makeAccount()]),
		...(options.fetch === undefined ? {} : { fetch: options.fetch }),
	};
	return createCommandCodeProvider(dependencies);
}

/** 构造入口请求上下文。 */
function makeContext(overrides: Partial<SubscriptionRequestContext> = {}): SubscriptionRequestContext {
	return {
		source: "commandcode",
		operation: "chat",
		model: "deepseek/deepseek-v4.1-flash",
		inbound: "chat",
		body: { model: "deepseek/deepseek-v4.1-flash", messages: [{ role: "user", content: "hi" }], stream: false },
		headers: {},
		stream: false,
		sessionKey: "",
		...overrides,
	};
}

/** 构造已选定上游协议的执行上下文。 */
function makeUpstream(
	context: SubscriptionRequestContext,
	upstream: SubscriptionWireProtocol,
	upstreamBody?: Record<string, unknown>,
	credential = "cc-test-key",
): SubscriptionUpstreamContext {
	return {
		...context,
		upstream: upstream,
		upstreamBody: upstreamBody ?? { ...context.body },
		account: makeAccount(),
		credential: credential,
	};
}

/** 捕获 ApiError，断言调用一定失败。 */
async function captureApiError(promise: Promise<unknown>): Promise<ApiError> {
	try {
		await promise;
	} catch (error) {
		if (error instanceof ApiError) {
			return error;
		}
		throw error;
	}
	throw new Error("期望抛出 ApiError，但调用成功");
}

/** 读取请求头（大小写不敏感）。 */
function headerOf(headers: Record<string, string>, name: string): string | undefined {
	const lower = name.toLowerCase();
	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() === lower) {
			return value;
		}
	}
	return undefined;
}

/** 声明的 namespace 工具请求体。 */
const NAMESPACE_TOOLS: readonly Record<string, unknown>[] = [
	{
		type: "namespace",
		name: "mcp__node_repl",
		description: "Node REPL 工具集",
		tools: [
			{ type: "function", name: "run", parameters: { properties: { code: { type: "string" } } } },
			{ type: "function", name: "stop", description: "停止进程" },
		],
	},
	{ type: "function", name: "plain_tool", description: "普通工具", parameters: { type: "object", properties: {} } },
];

describe("CommandCode 适配器契约", () => {
	it("暴露来源、展示名与 API key 鉴权", async () => {
		const provider = makeProvider();

		expect(provider.source).toBe("commandcode");
		expect(provider.displayName).toBe("CommandCode");
		expect(provider.auth.source).toBe("commandcode");
		await expect(provider.auth.ensureCredential(makeAccount())).resolves.toBe("cc-test-key");
	});

	it("账号缺少 api_key 时不发请求直接报错", async () => {
		const fetch = mockFetch(() => ({ status: 200, body: {} }));
		const provider = makeProvider({
			accounts: [makeAccount({ raw: { type: "commandcode" } })],
			fetch: fetch.fetchImpl,
		});

		await expect(provider.auth.ensureCredential(makeAccount({ raw: {} }))).rejects.toThrow("订阅账号缺少 API key");
		const error = await captureApiError(provider.quota(makeAccount({ raw: {} })));
		expect(error.statusCode).toBe(503);
		expect(fetch.calls).toHaveLength(0);
	});
});

describe("CommandCode 3×3 协议路由", () => {
	const entries: readonly { inbound: SubscriptionInboundProtocol; operation: SubscriptionOperation }[] = [
		{ inbound: "chat", operation: "chat" },
		{ inbound: "messages", operation: "messages" },
		{ inbound: "responses", operation: "responses" },
	];
	const families: readonly { model: string; expected: SubscriptionWireProtocol }[] = [
		{ model: "claude-sonnet-5-5", expected: "messages" },
		{ model: "anthropic/claude-opus-5", expected: "messages" },
		{ model: "deepseek/deepseek-v4.1-flash", expected: "responses" },
	];

	it("入口协议不改变上游选择：Claude 恒走 messages，其余走 responses", () => {
		const provider = makeProvider();
		const table: string[] = [];

		for (const entry of entries) {
			for (const family of families) {
				const context = makeContext({
					inbound: entry.inbound,
					operation: entry.operation,
					model: family.model,
					body: { model: family.model },
				});
				const upstream = provider.route(context);
				expect(upstream).toBe(family.expected);
				table.push(`${entry.inbound}/${family.model}=${upstream}`);
			}
		}

		// 九种组合的完整路由表：三列分别是裸 Claude、带 vendor 前缀的 Claude、非 Claude。
		expect(table).toEqual([
			"chat/claude-sonnet-5-5=messages",
			"chat/anthropic/claude-opus-5=messages",
			"chat/deepseek/deepseek-v4.1-flash=responses",
			"messages/claude-sonnet-5-5=messages",
			"messages/anthropic/claude-opus-5=messages",
			"messages/deepseek/deepseek-v4.1-flash=responses",
			"responses/claude-sonnet-5-5=messages",
			"responses/anthropic/claude-opus-5=messages",
			"responses/deepseek/deepseek-v4.1-flash=responses",
		]);
	});

	it("Claude 家族判定忽略大小写、空白与 vendor 前缀", () => {
		const provider = makeProvider();

		expect(provider.route(makeContext({ model: "  Claude-Sonnet-5-5  " }))).toBe("messages");
		expect(provider.route(makeContext({ model: "anthropic/CLAUDE-opus-5" }))).toBe("messages");
		expect(provider.route(makeContext({ model: "claude-haiku-4-5" }))).toBe("messages");
		expect(provider.route(makeContext({ model: "z-ai/glm-5.3-flash" }))).toBe("responses");
	});

	it("公开模型前缀 commandcode/ 不影响路由", () => {
		const provider = makeProvider();

		expect(provider.route(makeContext({ model: "commandcode/anthropic/claude-opus-5" }))).toBe("messages");
		expect(provider.route(makeContext({ model: "commandcode/deepseek/deepseek-v4.1-flash" }))).toBe("responses");
	});
});

describe("CommandCode 操作支持矩阵", () => {
	const provider = makeProvider();

	it("对话三协议可用", () => {
		for (const operation of ["chat", "messages", "responses"] as const) {
			expect(provider.supports(operation, "deepseek/deepseek-v4.1-flash")).toBe(true);
		}
	});

	it("图片、compact、count_tokens 等插件不支持的端点显式拒绝", () => {
		const rejected: readonly SubscriptionOperation[] = [
			"completions",
			"images.generations",
			"images.edits",
			"compact",
			"count_tokens",
			"videos",
			"speech",
			"live",
			"realtime",
			"alpha.search",
			"models",
		];
		for (const operation of rejected) {
			expect(provider.supports(operation, "deepseek/deepseek-v4.1-flash")).toBe(false);
		}
	});

	it("缺少模型时不承接", () => {
		expect(provider.supports("chat", "   ")).toBe(false);
	});
});

describe("CommandCode 上游请求构造", () => {
	it("Claude 模型走 /messages：Anthropic 风格鉴权、版本头与会话头", async () => {
		const provider = makeProvider();
		const context = makeContext({
			operation: "messages",
			model: "commandcode/anthropic/claude-opus-5",
			inbound: "messages",
			sessionKey: "x-commandcode-session:abc-123",
			body: { model: "anthropic/claude-opus-5", max_tokens: 64, stream: false },
		});
		const plan = await provider.build(
			makeUpstream(context, "messages", { model: "commandcode/anthropic/claude-opus-5", max_tokens: 64, stream: false }),
		);

		expect(plan.url).toBe(`${COMMANDCODE_API_BASE}${COMMANDCODE_ENDPOINT_PATHS.messages}`);
		expect(plan.url).toBe("https://api.commandcode.ai/provider/v1/messages");
		expect(plan.method).toBe("POST");
		expect(plan.protocol).toBe("messages");
		expect(plan.bodyEncoding).toBe("json");
		// 插件 `upstreamAuthHeaders`：messages 用 x-api-key，且不转发 User-Agent 等客户端身份头。
		expect(plan.headers).toEqual({
			"Content-Type": "application/json",
			Accept: "application/json",
			[COMMANDCODE_SESSION_HEADER]: "abc-123",
			"x-api-key": "cc-test-key",
			"anthropic-version": COMMANDCODE_ANTHROPIC_VERSION,
		});
		expect(plan.model).toBe("anthropic/claude-opus-5");
		expect(plan.body).toEqual({ model: "anthropic/claude-opus-5", max_tokens: 64 });
	});

	it("非 Claude 模型走 /responses：无 anthropic-version，namespace 工具原样保留", async () => {
		const provider = makeProvider();
		const body = { model: "z-ai/glm-5.3-flash", input: [{ role: "user", content: "hi" }], tools: NAMESPACE_TOOLS };
		const context = makeContext({
			operation: "responses",
			model: "z-ai/glm-5.3-flash",
			inbound: "responses",
			sessionKey: "x-session-id:sess-9",
			body: body,
		});
		const plan = await provider.build(makeUpstream(context, "responses", { ...body }));

		expect(plan.url).toBe(`${COMMANDCODE_API_BASE}${COMMANDCODE_ENDPOINT_PATHS.responses}`);
		expect(plan.url).toBe("https://api.commandcode.ai/provider/v1/responses");
		expect(plan.protocol).toBe("responses");
		expect(plan.headers).toEqual({
			"Content-Type": "application/json",
			Accept: "application/json",
			[COMMANDCODE_SESSION_HEADER]: "sess-9",
			Authorization: "Bearer cc-test-key",
		});
		expect(plan.body).toEqual(body);
	});

	it("流式请求设置 stream 与 SSE Accept；非流式删除 stream 字段", async () => {
		const provider = makeProvider();
		const model = "z-ai/glm-5.3-flash";
		const streaming = await provider.build(
			makeUpstream(makeContext({ stream: true, model: model }), "responses", { model: model, stream: false }),
		);
		const buffered = await provider.build(
			makeUpstream(makeContext({ stream: false, model: model }), "responses", { model: model, stream: false }),
		);

		expect(streaming.body).toEqual({ model: "z-ai/glm-5.3-flash", stream: true });
		expect(headerOf(streaming.headers, "Accept")).toBe("text/event-stream");
		expect(buffered.body).toEqual({ model: "z-ai/glm-5.3-flash" });
		expect(headerOf(buffered.headers, "Accept")).toBe("application/json");
	});

	it("公开模型前缀只在发往上游时去掉一次", async () => {
		const provider = makeProvider();
		expect(provider.resolveModel?.("commandcode/deepseek/deepseek-v4.1-flash")).toBe("deepseek/deepseek-v4.1-flash");
		expect(provider.resolveModel?.("commandcode/claude-sonnet-5-5")).toBe("claude-sonnet-5-5");
		expect(provider.resolveModel?.(" deepseek/deepseek-v4.1-flash ")).toBe("deepseek/deepseek-v4.1-flash");

		const plan = await provider.build(
			makeUpstream(
				makeContext({ model: "commandcode/anthropic/claude-opus-5" }),
				"messages",
				{ model: "commandcode/anthropic/claude-opus-5" },
			),
		);
		expect(plan.model).toBe("anthropic/claude-opus-5");
		expect((plan.body as Record<string, unknown>)["model"]).toBe("anthropic/claude-opus-5");
	});

	it("没有会话信息时使用空输入摘要，避免每次请求新建上游会话", async () => {
		const provider = makeProvider();
		const plan = await provider.build(makeUpstream(makeContext({ sessionKey: "" }), "responses"));
		expect(headerOf(plan.headers, COMMANDCODE_SESSION_HEADER)).toBe(COMMANDCODE_EMPTY_SESSION_ID);
	});

	it("会话键按来源前缀还原成裸会话 ID", () => {
		expect(commandCodeSessionValue("")).toBe(COMMANDCODE_EMPTY_SESSION_ID);
		expect(commandCodeSessionValue("x-commandcode-session:abc-123")).toBe("abc-123");
		expect(commandCodeSessionValue("x-session-id:  sess-9  ")).toBe("sess-9");
		expect(commandCodeSessionValue("content:deadbeef")).toBe("deadbeef");
		expect(commandCodeSessionValue("metadata.user_id:user-7")).toBe("user-7");
		expect(commandCodeSessionValue("canonical-session")).toBe("canonical-session");
	});

	it("显式落到 /chat/completions 时从客户端请求体补齐 namespace 工具并清洗 thinking", async () => {
		const provider = makeProvider();
		const clientBody = {
			model: "deepseek/deepseek-v4.1-flash",
			input: [{ role: "user", content: "hi" }],
			tools: NAMESPACE_TOOLS,
		};
		// 协议转换只认识 function 工具：namespace 声明在这一步被丢掉，适配器要补回来。
		const translated = {
			model: "deepseek/deepseek-v4.1-flash",
			messages: [{ role: "user", content: "hi" }],
			tools: [
				{ type: "function", function: { name: "plain_tool", description: "普通工具", parameters: { type: "object", properties: {} } } },
			],
			thinking: "auto",
		};
		const plan = await provider.build(
			makeUpstream(makeContext({ stream: true, operation: "responses", inbound: "responses", body: clientBody }), "chat", translated),
		);
		const sent = plan.body as Record<string, unknown>;

		expect(plan.url).toBe("https://api.commandcode.ai/provider/v1/chat/completions");
		expect(headerOf(plan.headers, "Accept")).toBe("text/event-stream");
		expect(headerOf(plan.headers, "anthropic-version")).toBeUndefined();
		expect(sent["thinking"]).toBeUndefined();
		expect(sent["tools"]).toEqual([
			{ type: "function", function: { name: "plain_tool", description: "普通工具", parameters: { type: "object", properties: {} } } },
			{
				type: "function",
				function: {
					name: "mcp__node_repl__run",
					description: "Node REPL 工具集",
					parameters: { type: "object", properties: { code: { type: "string" } } },
				},
			},
			{
				type: "function",
				function: {
					name: "mcp__node_repl__stop",
					description: "停止进程",
					parameters: { type: "object", properties: {} },
				},
			},
		]);
	});

	it("转换层原样保留 namespace 声明时同样拍平且不重复", async () => {
		const provider = makeProvider();
		const clientBody = { model: "deepseek/deepseek-v4.1-flash", input: [], tools: NAMESPACE_TOOLS };
		const translated = {
			model: "deepseek/deepseek-v4.1-flash",
			messages: [],
			tools: [
				{ type: "function", name: "plain_tool", description: "普通工具", parameters: { type: "object", properties: {} } },
				...NAMESPACE_TOOLS,
			],
		};
		const plan = await provider.build(
			makeUpstream(makeContext({ operation: "responses", inbound: "responses", body: clientBody }), "chat", translated),
		);
		const tools = (plan.body as Record<string, unknown>)["tools"] as readonly Record<string, unknown>[];

		const names = tools.map((tool) => {
			const fn = tool["function"];
			return typeof fn === "object" && fn !== null ? String((fn as Record<string, unknown>)["name"]) : String(tool["name"]);
		});
		expect(names).toEqual(["plain_tool", "mcp__node_repl__run", "mcp__node_repl__stop"]);
		expect(tools.filter((tool) => tool["type"] === "namespace")).toHaveLength(0);
	});

	it("保留合法的 thinking 对象", async () => {
		const provider = makeProvider();
		const thinking = { type: "enabled", budget_tokens: 1024 };
		const plan = await provider.build(
			makeUpstream(makeContext(), "chat", { model: "z-ai/glm-5.3-flash", messages: [], thinking: thinking }),
		);

		expect((plan.body as Record<string, unknown>)["thinking"]).toEqual(thinking);
	});

	it("chat 端点拒绝无法表达的工具类型（客户端声明或转换残留都拦）", async () => {
		const provider = makeProvider();
		const clientBody = { model: "deepseek/deepseek-v4.1-flash", input: [], tools: [{ type: "web_search" }] };
		const translated = { model: "deepseek/deepseek-v4.1-flash", messages: [] };
		const fromClient = await captureApiError(
			provider.build(
				makeUpstream(makeContext({ operation: "responses", inbound: "responses", body: clientBody }), "chat", translated),
			),
		);
		expect(fromClient.statusCode).toBe(400);
		expect(fromClient.message).toContain("web_search");
		expect(fromClient.message).toContain("/chat/completions");

		const leftover = await captureApiError(
			provider.build(
				makeUpstream(makeContext(), "chat", {
					model: "deepseek/deepseek-v4.1-flash",
					messages: [],
					tools: [{ type: "web_search" }],
				}),
			),
		);
		expect(leftover.statusCode).toBe(400);
		expect(leftover.message).toContain("web_search");
	});

	it("Claude 的 /messages 端点拒绝 namespace 工具", async () => {
		const provider = makeProvider();
		const context = makeContext({
			operation: "messages",
			model: "claude-sonnet-5-5",
			inbound: "messages",
			body: { model: "anthropic/claude-sonnet-5-5", messages: [], tools: NAMESPACE_TOOLS },
		});
		const error = await captureApiError(
			provider.build(
				makeUpstream(context, "messages", {
					model: "anthropic/claude-sonnet-5-5",
					messages: [],
					tools: NAMESPACE_TOOLS,
				}),
			),
		);

		expect(error.statusCode).toBe(400);
		expect(error.message).toContain("namespace");
		expect(error.message).toContain("/messages");
	});

	it("超长 namespace 工具名用稳定哈希截断到 64 字符", () => {
		const namespace = "x".repeat(40);
		const name = "y".repeat(40);
		const flat = commandCodeNamespacedToolName(namespace, name);

		expect(flat).toHaveLength(COMMANDCODE_MAX_TOOL_NAME_LENGTH);
		expect(flat.endsWith(`_${"0".repeat(12)}`)).toBe(false);
		expect(flat.slice(-13)).toMatch(/^_[0-9a-f]{12}$/);
		expect(commandCodeNamespacedToolName(namespace, name)).toBe(flat);
		expect(commandCodeNamespacedToolName(namespace, `${name}z`)).not.toBe(flat);
	});

	it("非法请求体、缺失凭据与不支持的协议都给出明确拒绝", async () => {
		const provider = makeProvider();
		const context = makeContext();

		const missingKey = await captureApiError(provider.build(makeUpstream(context, "responses", {}, "  ")));
		expect(missingKey.statusCode).toBe(401);
		expect(missingKey.message).toContain("缺少 API key");

		const rawBody = await captureApiError(
			provider.build({ ...makeUpstream(context, "responses"), rawBody: new Uint8Array([1, 2, 3]) }),
		);
		expect(rawBody.statusCode).toBe(400);
		expect(rawBody.message).toContain("JSON");

		const notObject = await captureApiError(
			provider.build(makeUpstream(context, "responses", [] as unknown as Record<string, unknown>, "cc-test-key")),
		);
		expect(notObject.statusCode).toBe(400);

		const blankModel = await captureApiError(
			provider.build(makeUpstream(makeContext({ model: "   " }), "responses", { model: "x" })),
		);
		expect(blankModel.statusCode).toBe(400);
		expect(blankModel.message).toContain("缺少模型");

		const unsupported = await captureApiError(provider.build(makeUpstream(context, "gemini", { model: "x" })));
		expect(unsupported.statusCode).toBe(400);
		expect(unsupported.message).toContain("gemini");
	});
});

describe("CommandCode reasoning 回填", () => {
	it("非流式 chat 响应把 reasoning_details 文本补齐到 reasoning_content", () => {
		const provider = makeProvider();
		const usage = {
			prompt_tokens: 11,
			completion_tokens: 7,
			total_tokens: 18,
			prompt_tokens_details: { cached_tokens: 4 },
			completion_tokens_details: { reasoning_tokens: 5 },
		};
		const body = {
			choices: [
				{
					index: 0,
					message: {
						role: "assistant",
						content: "答案",
						reasoning_details: [{ type: "reasoning.text", text: "先想" }, { type: "reasoning.text", text: "再答" }],
					},
					finish_reason: "stop",
				},
			],
			usage: usage,
		};
		const transformed = provider.transformUpstreamBody?.(makeContext(), body);

		expect(transformed).toEqual({
			choices: [
				{
					index: 0,
					message: {
						role: "assistant",
						content: "答案",
						reasoning_content: "先想再答",
						reasoning_details: body.choices[0]?.message.reasoning_details,
					},
					finish_reason: "stop",
				},
			],
			usage: usage,
		});
		expect((body.choices[0]?.message as Record<string, unknown>)["reasoning_content"]).toBeUndefined();
	});

	it("reasoning 字段作为次选来源，已有 reasoning_content 不被覆盖", async () => {
		const provider = makeProvider();
		const fromReasoning = provider.transformUpstreamBody?.(makeContext(), {
			choices: [{ message: { reasoning: "供应商思考" } }],
		});
		expect((fromReasoning?.["choices"] as Record<string, unknown>[])[0]).toEqual({
			message: { reasoning: "供应商思考", reasoning_content: "供应商思考" },
		});

		const existing = { choices: [{ message: { reasoning: "旧", reasoning_content: "已标准" } }] };
		expect(provider.transformUpstreamBody?.(makeContext(), existing)).toBe(existing);
	});

	it("非 chat 形状（Responses 上一跳、错误体）保持原引用", () => {
		const provider = makeProvider();
		const responsesBody = { output: [{ type: "message", content: [] }], id: "resp_1" };
		const errorBody = { error: { message: "upstream failed", type: "upstream_error" } };

		expect(provider.transformUpstreamBody?.(makeContext(), responsesBody)).toBe(responsesBody);
		expect(provider.transformUpstreamBody?.(makeContext(), errorBody)).toBe(errorBody);
		expect(provider.transformUpstreamEvent?.(makeContext(), errorBody)).toBe(errorBody);
	});

	it("流式 chunk 的 delta 同样回填，且不吞掉事件", () => {
		const provider = makeProvider();
		const chunk = { choices: [{ index: 0, delta: { reasoning: "半句" } }] };
		const transformed = provider.transformUpstreamEvent?.(makeContext(), chunk);

		expect(transformed).toEqual({ choices: [{ index: 0, delta: { reasoning: "半句", reasoning_content: "半句" } }] });
		expect(provider.transformUpstreamEvent?.(makeContext(), { choices: [{ delta: { content: "hi" } }] })).toEqual({
			choices: [{ delta: { content: "hi" } }],
		});
	});

	it("入口为 chat 时翻译后的响应也补齐 reason_content", () => {
		const provider = makeProvider();
		const translated = { choices: [{ message: { role: "assistant", reasoning: "思考", content: "答案" } }] };

		expect(provider.transformInboundBody?.(makeContext({ inbound: "chat" }), translated)).toEqual({
			choices: [{ message: { role: "assistant", reasoning: "思考", content: "答案", reasoning_content: "思考" } }],
		});
	});
});

describe("CommandCode namespace 工具还原", () => {
	const context = makeContext({
		operation: "responses",
		model: "deepseek/deepseek-v4.1-flash",
		inbound: "responses",
		body: { model: "deepseek/deepseek-v4.1-flash", input: [], tools: NAMESPACE_TOOLS },
	});

	it("请求体里的 namespace 拍平索引覆盖两组嵌套工具", () => {
		const index = commandCodeToolNamespaces(context.body);
		expect([...index.entries()]).toEqual([
			["mcp__node_repl__run", "mcp__node_repl"],
			["mcp__node_repl__stop", "mcp__node_repl"],
		]);
	});

	it("非流式 Responses 输出项还原名字与 namespace", () => {
		const provider = makeProvider();
		const upstream = {
			id: "resp_1",
			output: [
				{ type: "function_call", call_id: "call_1", name: "mcp__node_repl__run", arguments: "{}" },
				{ type: "function_call", call_id: "call_2", name: "plain_tool", arguments: "{}" },
				{ type: "message", role: "assistant", content: [] },
			],
		};
		const transformed = provider.transformInboundBody?.(context, upstream);

		expect(transformed?.["output"]).toEqual([
			{ type: "function_call", call_id: "call_1", name: "run", namespace: "mcp__node_repl", arguments: "{}" },
			{ type: "function_call", call_id: "call_2", name: "plain_tool", arguments: "{}" },
			{ type: "message", role: "assistant", content: [] },
		]);
		expect(upstream.output[0]).toEqual({
			type: "function_call",
			call_id: "call_1",
			name: "mcp__node_repl__run",
			arguments: "{}",
		});
	});

	it("流式事件在 output_item.added 与终态 response.output 上都还原", () => {
		const provider = makeProvider();
		const added = provider.transformInboundEvent?.(context, {
			type: "response.output_item.added",
			output_index: 0,
			item: { type: "function_call", name: "mcp__node_repl__stop", call_id: "call_1" },
		});
		const completed = provider.transformInboundEvent?.(context, {
			type: "response.completed",
			response: {
				id: "resp_1",
				output: [{ type: "function_call", name: "mcp__node_repl__run", call_id: "call_2", arguments: "{}" }],
			},
		});

		expect(added?.["item"]).toEqual({
			type: "function_call",
			name: "stop",
			namespace: "mcp__node_repl",
			call_id: "call_1",
		});
		expect(completed?.["response"]).toMatchObject({
			output: [{ type: "function_call", name: "run", namespace: "mcp__node_repl", call_id: "call_2" }],
		});
	});

	it("没有 namespace 声明或入口为 chat 时不改写响应", () => {
		const provider = makeProvider();
		const plainContext = makeContext({ operation: "responses", inbound: "responses", body: { input: [] } });
		const output = { output: [{ type: "function_call", name: "mcp__node_repl__run", call_id: "c" }] };
		const chatContext = makeContext({ inbound: "chat" });

		expect(provider.transformInboundBody?.(plainContext, output)).toBe(output);
		expect(provider.transformInboundEvent?.(plainContext, output)).toBe(output);
		expect(provider.transformInboundBody?.(chatContext, output)).toBe(output);
	});
});

describe("CommandCode 模型目录", () => {
	it("没有可用账号时回退内置目录且不发请求", async () => {
		const fetch = mockFetch(() => ({ status: 200, body: { data: [] } }));
		const provider = makeProvider({ accounts: [], fetch: fetch.fetchImpl });

		const models = await provider.catalog();

		expect(models.map((model) => model.id)).toEqual(builtinCatalogForSource("commandcode").map((model) => model.id));
		expect(fetch.calls).toHaveLength(0);
	});

	it("用第一个可用账号的 key 请求 /models 并映射路由", async () => {
		const fetch = mockFetch(() => ({
			status: 200,
			body: {
				data: [
					{ id: "anthropic/claude-sonnet-5-5", display_name: "Claude Sonnet 5.5", context_length: 200000 },
					{ id: "z-ai/glm-5.3-flash", display_name: "GLM 5.3 Flash" },
				],
			},
		}));
		const provider = makeProvider({ fetch: fetch.fetchImpl });

		const models = await provider.catalog();

		expect(fetch.calls).toHaveLength(1);
		expect(fetch.calls[0]?.url).toBe(`${COMMANDCODE_API_BASE}/models`);
		expect(fetch.calls[0]?.init.method).toBe("GET");
		expect(fetch.calls[0]?.init.headers).toEqual({ Authorization: "Bearer cc-test-key", Accept: "application/json" });
		expect(models.map((model) => model.id)).toEqual(["anthropic/claude-sonnet-5-5", "z-ai/glm-5.3-flash"]);
		expect(models.map((model) => model.protocol)).toEqual(["messages", "responses"]);
	});

	it("上游目录失败时回退内置目录", async () => {
		const fetch = mockFetch(() => ({ status: 500, body: { error: "boom" } }));
		const provider = makeProvider({ fetch: fetch.fetchImpl });

		const models = await provider.catalog();

		expect(models.map((model) => model.id)).toEqual(builtinCatalogForSource("commandcode").map((model) => model.id));
		expect(fetch.calls).toHaveLength(1);
	});

	it("跳过禁用账号，并在缺少 key 时继续尝试下一个账号", async () => {
		const disabled = makeAccount({ id: "disabled", fileName: "a.json", disabled: true });
		const noKey = makeAccount({ id: "no-key", fileName: "b.json", raw: { type: "commandcode" } });
		const usable = makeAccount({ id: "usable", fileName: "c.json", raw: { type: "commandcode", api_key: "key-2" } });
		const fetch = mockFetch(() => ({ status: 200, body: { data: [{ id: "z-ai/glm-5.3-flash" }] } }));
		const provider = makeProvider({ accounts: [disabled, noKey, usable], fetch: fetch.fetchImpl });

		const models = await provider.catalog();

		expect(models.map((model) => model.id)).toEqual(["z-ai/glm-5.3-flash"]);
		expect(fetch.calls[0]?.init.headers).toEqual({ Authorization: "Bearer key-2", Accept: "application/json" });
	});

	it("只有禁用账号时回退内置目录且不发请求", async () => {
		const fetch = mockFetch(() => ({ status: 200, body: { data: [] } }));
		const provider = makeProvider({
			accounts: [makeAccount({ disabled: true })],
			fetch: fetch.fetchImpl,
		});

		const models = await provider.catalog();

		expect(models.map((model) => model.id)).toEqual(builtinCatalogForSource("commandcode").map((model) => model.id));
		expect(fetch.calls).toHaveLength(0);
	});

	it("内置目录的 CommandCode 模型带 responses 路由", () => {
		const builtin = builtinCatalogForSource("commandcode");

		expect(builtin.length).toBeGreaterThan(0);
		for (const model of builtin) {
			expect(model.protocol).toBe("responses");
		}
	});
});

describe("CommandCode 账号额度", () => {
	const credits = {
		credits: { monthlyCredits: 55, purchasedCredits: 0 },
		windowLimits: {
			fiveHour: { used: 10, cap: 40, resetAt: Date.parse("2026-11-10T18:00:00.000Z") },
			weekly: { used: 20, cap: 100 },
		},
	};
	const subscription = { data: { planId: "individual-goat", currentPeriodEnd: "2026-12-01T00:00:00.000Z" } };
	const whoami = { user: { email: "dev@example.com" }, org: { login: "acme" } };

	/** 按 URL 分派三份额度响应。 */
	function quotaFetch(paths?: string[]): { calls: RecordedCall[]; fetchImpl: typeof fetch } {
		return mockFetch((url) => {
			paths?.push(url);
			if (url.endsWith("/alpha/billing/credits")) {
				return { status: 200, body: credits };
			}
			if (url.endsWith("/alpha/billing/subscriptions")) {
				return { status: 200, body: subscription };
			}
			if (url.includes("/alpha/whoami")) {
				return { status: 200, body: whoami };
			}
			return { status: 404, body: { error: "not found" } };
		});
	}

	it("查询三个账户接口并映射成订阅快照", async () => {
		const paths: string[] = [];
		const fetch = quotaFetch(paths);
		const provider = makeProvider({ fetch: fetch.fetchImpl });

		const snapshot = await provider.quota(makeAccount());

		expect(paths).toEqual([
			"https://api.commandcode.ai/alpha/billing/credits",
			"https://api.commandcode.ai/alpha/billing/subscriptions",
			"https://api.commandcode.ai/alpha/whoami?limits=1",
		]);
		for (const call of fetch.calls) {
			expect(call.init.method).toBe("GET");
			expect(call.init.headers).toEqual({ Authorization: "Bearer cc-test-key", Accept: "application/json" });
		}
		expect(snapshot.plan).toBe("GOAT");
		expect(snapshot.expiresAt).toBe("2026-12-01T00:00:00.000Z");
		expect(snapshot.windows?.map((window) => window.name)).toEqual(["5 小时", "周", "月"]);
		expect(snapshot.windows?.map((window) => window.remainingFraction)).toEqual([0.75, 0.8, 0.7857]);
		expect(snapshot.windows?.[0]?.resetTime).toBe("2026-11-10T18:00:00.000Z");
		expect(snapshot.windows?.[0]?.raw).toMatchObject({ id: "commandcode:five_hour", usedPercent: 25 });
		expect(snapshot.balances).toEqual({ 剩余计划额度: 55 });
		expect(Number.isNaN(Date.parse(snapshot.fetchedAt))).toBe(false);
	});

	it("账户接口失败时抛出 ApiError，且错误信息不泄漏凭据", async () => {
		const fetch = mockFetch(() => ({ status: 500, body: { error: "boom" } }));
		const provider = makeProvider({ fetch: fetch.fetchImpl });

		const error = await captureApiError(provider.quota(makeAccount()));

		expect(error.statusCode).toBe(503);
		expect(error.message).toContain("HTTP 500");
		expect(error.message).not.toContain("cc-test-key");
		expect(fetch.calls).toHaveLength(1);
	});
});

describe("CommandCode 端到端往返（真实协议转换）", () => {
	const model = "deepseek/deepseek-v4.1-flash";
	const clientBody = {
		model: model,
		input: [{ role: "user", content: "列一下目录" }],
		tools: NAMESPACE_TOOLS,
	};
	const context = makeContext({ operation: "responses", inbound: "responses", model: model, body: clientBody });
	const options = { model: model, upstreamModel: model };

	it("Responses 入口 → chat 上游：工具拍平、思考补齐、回程还原 namespace", async () => {
		const provider = makeProvider();
		const translated = translateRequest("responses", "chat", clientBody, options);
		const plan = await provider.build(makeUpstream(context, "chat", translated));
		const sentTools = (plan.body as Record<string, unknown>)["tools"] as readonly Record<string, unknown>[];
		const sentNames = sentTools.map((tool) => {
			const fn = tool["function"];
			return typeof fn === "object" && fn !== null ? (fn as Record<string, unknown>)["name"] : tool["name"];
		});
		expect(sentNames).toEqual(expect.arrayContaining(["mcp__node_repl__run", "mcp__node_repl__stop", "plain_tool"]));

		const chatResponse = {
			id: "chatcmpl_1",
			object: "chat.completion",
			model: model,
			choices: [
				{
					index: 0,
					message: {
						role: "assistant",
						content: "",
						reasoning: "先看看目录",
						tool_calls: [
							{
								id: "call_1",
								type: "function",
								function: { name: "mcp__node_repl__run", arguments: '{"code":"ls"}' },
							},
						],
					},
					finish_reason: "tool_calls",
				},
			],
			usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
		};
		const upstream = provider.transformUpstreamBody?.(context, chatResponse) ?? chatResponse;
		const back = translateResponse("responses", "chat", upstream, options);
		const final = provider.transformInboundBody?.(context, back) ?? back;
		const output = final["output"] as readonly Record<string, unknown>[];

		expect(output).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ type: "function_call", name: "run", namespace: "mcp__node_repl", call_id: "call_1" }),
			]),
		);
		expect(JSON.stringify(output)).not.toContain("mcp__node_repl__run");
		expect(JSON.stringify(output)).toContain("先看看目录");
		expect(final["usage"]).toMatchObject({ input_tokens: 10, output_tokens: 5, total_tokens: 15 });
	});

	it("Responses 入口 → chat 上游流式：终态 item 同样还原 namespace", () => {
		const provider = makeProvider();
		const translator = createStreamTranslator("responses", "chat", { ...options, includeDone: true });
		const chunks: readonly Record<string, unknown>[] = [
			{ id: "c1", choices: [{ index: 0, delta: { reasoning: "先看看" } }] },
			{
				id: "c1",
				choices: [
					{
						index: 0,
						delta: {
							tool_calls: [
								{ index: 0, id: "call_1", type: "function", function: { name: "mcp__node_repl__run", arguments: "{\"code\":" } },
							],
						},
					},
				],
			},
			{
				id: "c1",
				choices: [
					{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: "\"ls\"}" } }] }, finish_reason: "tool_calls" },
				],
			},
		];
		const emitted: ProtocolEvent[] = [];
		for (const chunk of chunks) {
			const upstreamBody = provider.transformUpstreamEvent?.(context, { ...chunk }) ?? chunk;
			emitted.push(...translator.push({ data: upstreamBody }));
		}
		emitted.push(...translator.flush());
		const inbound = emitted
			.filter((event) => typeof event.data === "object")
			.map((event) => {
				const body = event.data as Record<string, unknown>;
				const transformed = provider.transformInboundEvent?.(context, body) ?? body;
				return { event: event.event, data: transformed };
			});
		const done = inbound.find(
			(event) => event.event === "response.output_item.done" && (event.data["item"] as Record<string, unknown>)["type"] === "function_call",
		);

		expect(done?.data["item"]).toMatchObject({ type: "function_call", name: "run", namespace: "mcp__node_repl", call_id: "call_1" });
		expect(JSON.stringify(inbound)).not.toContain("mcp__node_repl__run");
	});
});
