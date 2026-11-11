/**
 * OpenCode Go 适配器的离线测试。
 *
 * 覆盖家族路由、上游 URL/请求头、Chat/Messages 兼容修复、Responses 工具
 * 命名空间往返、目录与额度查询，以及错误路径；全部使用桩 fetch 与内存账号。
 */

import { ApiError } from "../../../core/api/ApiError";
import type { SubscriptionAccountStore } from "../accountStore";
import type {
	SubscriptionAccount,
	SubscriptionInboundProtocol,
	SubscriptionOperation,
	SubscriptionRequestContext,
	SubscriptionSource,
	SubscriptionUpstreamContext,
	SubscriptionWireProtocol,
} from "../types";
import { createOpenCodeProvider, OPENCODE_SOURCE, OPENCODE_USER_AGENT } from "./opencode";
import { flattenToolName, unwrapCustomToolInput } from "./opencodeResponses";

/** 一次被记录的请求。 */
interface RecordedCall {
	/** 请求地址。 */
	readonly url: string;
	/** 请求方法。 */
	readonly method: string;
	/** 请求头。 */
	readonly headers: Record<string, string>;
	/** 请求体。 */
	readonly body: unknown;
}

/** 桩响应。 */
interface StubResponse {
	/** HTTP 状态；缺省 200。 */
	readonly status?: number;
	/** 响应体；字符串原样返回，其余 JSON 序列化。 */
	readonly body?: unknown;
}

/** 按调用顺序返回桩响应的 fetch。 */
function stubFetch(responses: readonly StubResponse[]): { calls: RecordedCall[]; fetchImpl: typeof fetch } {
	const calls: RecordedCall[] = [];
	const fetchImpl = (async (input: unknown, init?: RequestInit): Promise<Response> => {
		const response = responses[calls.length];
		calls.push({
			url: String(input),
			method: init?.method ?? "GET",
			headers: { ...((init?.headers ?? {}) as Record<string, string>) },
			body: init?.body,
		});
		if (!response) {
			throw new TypeError(`unexpected request ${calls.length}`);
		}
		const status = response.status ?? 200;
		return {
			ok: status >= 200 && status < 300,
			status: status,
			text: async (): Promise<string> =>
				typeof response.body === "string" ? response.body : JSON.stringify(response.body ?? {}),
		} as unknown as Response;
	}) as unknown as typeof fetch;
	return { calls: calls, fetchImpl: fetchImpl };
}

/** 构造一个 OpenCode Go 账号。 */
function fakeAccount(overrides: Partial<SubscriptionAccount> = {}): SubscriptionAccount {
	return {
		id: "acct-1",
		source: "opencode-go",
		fileName: "opencode-go-key.json",
		path: "/var/lib/litellm/cliproxy/auths/opencode-go-key.json",
		disabled: false,
		weight: 1,
		raw: { api_key: "oc_sk_test" },
		...overrides,
	};
}

/** 内存账号仓库。 */
function fakeStore(accounts: readonly SubscriptionAccount[]): SubscriptionAccountStore {
	return {
		list: async (source?: SubscriptionSource): Promise<SubscriptionAccount[]> =>
			accounts.filter((account) => source === undefined || account.source === source),
		findByFileName: async (fileName: string): Promise<SubscriptionAccount | undefined> =>
			accounts.find((account) => account.fileName === fileName),
	} as unknown as SubscriptionAccountStore;
}

/** 请求上下文参数。 */
interface RequestOptions {
	/** 端点操作。 */
	readonly operation?: SubscriptionOperation;
	/** 请求模型。 */
	readonly model?: string;
	/** 入口协议。 */
	readonly inbound?: SubscriptionInboundProtocol;
	/** 请求体。 */
	readonly body?: Record<string, unknown>;
	/** 请求头。 */
	readonly headers?: Record<string, string>;
	/** 是否流式。 */
	readonly stream?: boolean;
	/** 会话键。 */
	readonly sessionKey?: string;
}

/** 构造请求上下文。 */
function requestContext(options: RequestOptions = {}): SubscriptionRequestContext {
	const body = options.body ?? { model: "glm-5.3", messages: [{ role: "user", content: "hi" }] };
	return {
		source: "opencode-go",
		operation: options.operation ?? "chat",
		model: options.model ?? "glm-5.3",
		inbound: options.inbound ?? "chat",
		body: body,
		headers: options.headers ?? {},
		stream: options.stream ?? false,
		sessionKey: options.sessionKey ?? "",
	};
}

/** 上游请求上下文参数。 */
interface UpstreamOptions extends RequestOptions {
	/** 上游协议；缺省 chat。 */
	readonly upstream?: SubscriptionWireProtocol;
	/** 上游请求体；缺省与请求体同一对象。 */
	readonly upstreamBody?: Record<string, unknown>;
	/** 凭据。 */
	readonly credential?: string;
}

/** 构造上游请求上下文。 */
function upstreamContext(options: UpstreamOptions = {}): SubscriptionUpstreamContext {
	const base = requestContext(options);
	return {
		...base,
		upstream: options.upstream ?? "chat",
		upstreamBody: options.upstreamBody ?? base.body,
		account: fakeAccount(),
		credential: options.credential ?? "oc_sk_test",
	};
}

/** 断言对象。 */
function record(value: unknown): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("预期为 JSON 对象");
	}
	return value as Record<string, unknown>;
}

/** 断言数组。 */
function list(value: unknown): unknown[] {
	if (!Array.isArray(value)) {
		throw new Error("预期为数组");
	}
	return value;
}

/** 取出数组中的对象元素。 */
function recordAt(value: unknown, index: number): Record<string, unknown> {
	const items = list(value);
	return record(items[index]);
}

/** 捕获 ApiError。 */
async function captureApiError(run: () => unknown): Promise<ApiError> {
	try {
		await run();
	} catch (error) {
		expect(error).toBeInstanceOf(ApiError);
		return error as ApiError;
	}
	throw new Error("预期抛出 ApiError");
}

/** 取出必需的可选钩子。 */
function requireHook<T>(hook: T | undefined): T {
	if (hook === undefined) {
		throw new Error("适配器缺少钩子");
	}
	return hook;
}

/** 断言事件没有被丢弃。 */
function requireEvent(event: Record<string, unknown> | null): Record<string, unknown> {
	if (event === null) {
		throw new Error("事件被意外丢弃");
	}
	return event;
}

/** 家族路由表，与插件内置表一致。 */
const FAMILY_ROUTES: ReadonlyArray<readonly [string, SubscriptionWireProtocol]> = [
	["muse-spark", "responses"],
	["deepseek", "chat"],
	["minimax", "messages"],
	["longcat", "chat"],
	["grok", "responses"],
	["gpt", "responses"],
	["kimi", "chat"],
	["qwen", "messages"],
	["glm", "chat"],
	["mimo", "chat"],
	["hy", "chat"],
];

/** 非对话操作。 */
const NON_CONVERSATION_OPERATIONS: readonly SubscriptionOperation[] = [
	"completions",
	"images.generations",
	"images.edits",
	"compact",
	"count_tokens",
	"videos",
	"speech",
	"alpha.search",
	"live",
	"realtime",
	"models",
];

describe("OpenCode Go 路由与支持范围", () => {
	const adapter = createOpenCodeProvider({ accounts: fakeStore([fakeAccount()]) });

	it.each(FAMILY_ROUTES)("%s 家族路由到 %s", (prefix, protocol) => {
		const context = requestContext({ model: `${prefix}-test` });
		expect(adapter.supports("chat", context.model)).toBe(true);
		expect(adapter.supports("messages", context.model)).toBe(true);
		expect(adapter.supports("responses", context.model)).toBe(true);
		expect(adapter.route(context)).toBe(protocol);
	});

	it("去掉 opencode-go/ 前缀后再路由与改写模型", () => {
		const context = requestContext({ model: "opencode-go/glm-5.3" });
		expect(adapter.supports("chat", context.model)).toBe(true);
		expect(adapter.resolveModel?.(context.model)).toBe("glm-5.3");
		expect(adapter.route(context)).toBe("chat");
	});

	it("未知家族不承接且路由报 400", async () => {
		expect(adapter.supports("chat", "claude-haiku-5-5")).toBe(false);
		const error = await captureApiError(() => adapter.route(requestContext({ model: "claude-haiku-5-5" })));
		expect(error.statusCode).toBe(400);
		expect(error.message).toContain("claude-haiku-5-5");
	});

	it.each(NON_CONVERSATION_OPERATIONS)("不承接操作 %s", (operation) => {
		expect(adapter.supports(operation, "glm-5.3")).toBe(false);
	});
});

describe("Chat 路由请求构造", () => {
	const adapter = createOpenCodeProvider({ accounts: fakeStore([fakeAccount()]) });

	it("生成 OpenAI 兼容 URL、Bearer 认证与 developer/thinking 修复", async () => {
		const context = upstreamContext({
			operation: "chat",
			model: "opencode-go/glm-5.3",
			body: {
				model: "opencode-go/glm-5.3",
				messages: [
					{ role: "developer", content: "sys" },
					{ role: "user", content: "hi" },
				],
				thinking: { type: 42 },
				temperature: 0.2,
			},
		});
		const plan = await adapter.build(context);
		expect(plan.url).toBe("https://opencode.ai/zen/go/v1/chat/completions");
		expect(plan.method).toBe("POST");
		expect(plan.bodyEncoding).toBe("json");
		expect(plan.protocol).toBe("chat");
		expect(plan.model).toBe("glm-5.3");
		const body = record(plan.body);
		expect(body["model"]).toBe("glm-5.3");
		expect(recordAt(body["messages"], 0)["role"]).toBe("system");
		expect(recordAt(body["messages"], 1)["role"]).toBe("user");
		expect(body).not.toHaveProperty("thinking");
		expect(body["temperature"]).toBe(0.2);
		expect(plan.headers["Authorization"]).toBe("Bearer oc_sk_test");
		expect(plan.headers["Content-Type"]).toBe("application/json");
		expect(plan.headers["x-api-key"]).toBeUndefined();
		expect(plan.headers["anthropic-version"]).toBeUndefined();
		expect(plan.headers["x-opencode-session"]).toBe(
			"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
		);
		expect(plan.headers["User-Agent"]).toBe(OPENCODE_USER_AGENT);
	});

	it("保留有效 thinking 与历史 reasoning_content 回放", async () => {
		const context = upstreamContext({
			body: {
				model: "deepseek-v4.1-flash",
				messages: [
					{ role: "assistant", content: "done", reasoning_content: "思考过程" },
					{ role: "user", content: "继续" },
				],
				thinking: { type: "enabled", budget_tokens: 1024 },
			},
			model: "deepseek-v4.1-flash",
		});
		const body = record((await adapter.build(context)).body);
		expect(body["thinking"]).toEqual({ type: "enabled", budget_tokens: 1024 });
		expect(recordAt(body["messages"], 0)["reasoning_content"]).toBe("思考过程");
	});

	it("流式请求设置 SSE Accept，并转发会话与客户端标识", async () => {
		const context = upstreamContext({
			stream: true,
			sessionKey: "x-opencode-session:sess-1",
			headers: {
				"User-Agent": "OpenCode/1.2.3",
				"X-Opencode-Client": "cli",
				"X-Opencode-Project": "my-project",
				authorization: "Bearer client-key",
			},
		});
		const plan = await adapter.build(context);
		expect(plan.stream).toBe(true);
		expect(plan.headers["Accept"]).toBe("text/event-stream");
		expect(plan.headers["x-opencode-session"]).toBe("sess-1");
		expect(plan.headers["User-Agent"]).toBe("OpenCode/1.2.3");
		expect(plan.headers["x-opencode-client"]).toBe("cli");
		expect(plan.headers["x-opencode-project"]).toBe("my-project");
		expect(plan.headers["Authorization"]).toBe("Bearer oc_sk_test");
		expect(JSON.stringify(plan.headers)).not.toContain("client-key");
	});
});

describe("Messages 路由请求构造", () => {
	const adapter = createOpenCodeProvider({ accounts: fakeStore([fakeAccount()]) });

	it("生成 Anthropic 兼容 URL 与双认证头，并补齐 max_tokens", async () => {
		const context = upstreamContext({
			operation: "messages",
			inbound: "messages",
			upstream: "messages",
			model: "minimax-m3",
			body: { model: "minimax-m3", messages: [{ role: "user", content: "hi" }] },
		});
		const plan = await adapter.build(context);
		expect(plan.url).toBe("https://opencode.ai/zen/go/v1/messages");
		expect(plan.protocol).toBe("messages");
		expect(plan.model).toBe("minimax-m3");
		expect(plan.headers["Authorization"]).toBeUndefined();
		expect(plan.headers["x-api-key"]).toBe("oc_sk_test");
		expect(plan.headers["anthropic-version"]).toBe("2023-06-01");
		expect(record(plan.body)["max_tokens"]).toBe(4096);
	});

	it("保留显式 max_tokens，并把历史 system 轮次并入顶层 system", async () => {
		const context = upstreamContext({
			operation: "messages",
			inbound: "messages",
			upstream: "messages",
			model: "minimax-m3",
			body: {
				model: "minimax-m3",
				max_tokens: 2048,
				system: "已有指令",
				messages: [
					{
						role: "system",
						content: [
							{ type: "thinking", thinking: "忽略" },
							{ type: "text", text: "补充 A" },
							{ type: "text", text: "补充 B" },
						],
					},
					{ role: "user", content: "hi" },
				],
			},
		});
		const body = record((await adapter.build(context)).body);
		expect(body["max_tokens"]).toBe(2048);
		expect(body["system"]).toBe("已有指令\n\n补充 A\n\n补充 B");
		expect(body["messages"]).toEqual([{ role: "user", content: "hi" }]);
	});

	it("顶层 system 是块数组时追加文本块", async () => {
		const context = upstreamContext({
			operation: "messages",
			inbound: "messages",
			upstream: "messages",
			model: "qwen3.7-max",
			body: {
				model: "qwen3.7-max",
				system: [{ type: "text", text: "块指令" }],
				messages: [{ role: "system", content: "消息指令" }, { role: "user", content: "hi" }],
			},
		});
		const body = record((await adapter.build(context)).body);
		expect(body["system"]).toEqual([
			{ type: "text", text: "块指令" },
			{ type: "text", text: "消息指令" },
		]);
	});

	it("历史 system 轮次含图片时明确拒绝", async () => {
		const context = upstreamContext({
			operation: "messages",
			inbound: "messages",
			upstream: "messages",
			model: "minimax-m3",
			body: {
				model: "minimax-m3",
				max_tokens: 16,
				messages: [
					{ role: "system", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "x" } }] },
					{ role: "user", content: "hi" },
				],
			},
		});
		const error = await captureApiError(async () => adapter.build(context));
		expect(error.statusCode).toBe(400);
		expect(error.message).toContain("图片");
	});
});

describe("Responses 路由请求构造", () => {
	const adapter = createOpenCodeProvider({ accounts: fakeStore([fakeAccount()]) });

	it("GPT 家族保持原样，仅改写模型", async () => {
		const body = {
			model: "opencode-go/gpt-6-luna",
			input: [
				{ type: "reasoning", id: "rs_1", encrypted_content: "secret" },
				{ type: "message", role: "user", content: "hi" },
			],
			tools: [{ type: "namespace", name: "subagents", tools: [{ type: "function", name: "spawn_agent" }] }],
		};
		const context = upstreamContext({ operation: "responses", inbound: "responses", upstream: "responses", model: "gpt-6-luna", body: body });
		const plan = await adapter.build(context);
		expect(plan.url).toBe("https://opencode.ai/zen/go/v1/responses");
		const upstreamBody = record(plan.body);
		expect(upstreamBody["model"]).toBe("gpt-6-luna");
		expect(upstreamBody["tools"]).toEqual(body.tools);
		expect(recordAt(upstreamBody["input"], 0)["type"]).toBe("reasoning");
	});

	it("非 GPT 家族展开命名空间、合并 additional_tools 并清理客户端工具", async () => {
		const body = {
			model: "opencode-go/grok-4.1",
			input: [
				{ type: "additional_tools", tools: [{ type: "function", name: "extra", parameters: { type: "object" } }] },
				{ type: "reasoning", summary: [{ type: "summary_text", text: "思考" }] },
				{ type: "compaction", encrypted_content: "blob" },
				{ type: "message", role: "user", content: "hi" },
				{ type: "function_call", name: "spawn_agent", namespace: "subagents", arguments: "" },
				{ type: "custom_tool_call", name: "shell", input: "ls" },
				{ type: "custom_tool_call_output", call_id: "call-1", output: "ok" },
			],
			tools: [
				{
					type: "namespace",
					name: "subagents",
					tools: [{ type: "function", name: "spawn_agent", description: "spawn" }],
				},
				{ type: "custom", name: "shell" },
				{ type: "custom", name: "apply_patch" },
				{ type: "tool_search" },
				{ type: "image_generation" },
				{ type: "web_search", filters: { allowed_domains: ["x"] }, search_content_types: ["text"] },
			],
			tool_choice: { type: "function", name: "spawn_agent", namespace: "subagents" },
		};
		const context = upstreamContext({
			operation: "responses",
			inbound: "responses",
			upstream: "responses",
			model: "grok-4.1",
			body: body,
		});
		const plan = await adapter.build(context);
		const upstreamBody = record(plan.body);
		expect(upstreamBody["model"]).toBe("grok-4.1");
		const tools = list(upstreamBody["tools"]).map((tool) => record(tool));
		expect(tools.map((tool) => tool["name"] ?? tool["type"])).toEqual(["subagents__spawn_agent", "shell", "web_search", "extra"]);
		expect(tools[1]).toEqual({
			type: "function",
			name: "shell",
			parameters: { type: "object", properties: {}, additionalProperties: true },
		});
		expect(tools[2]).toEqual({ type: "web_search" });
		expect(tools[3]).toEqual({ type: "function", name: "extra", parameters: { type: "object" } });
		const input = list(upstreamBody["input"]).map((item) => record(item));
		expect(input.map((item) => item["type"])).toEqual(["message", "function_call", "function_call", "function_call_output"]);
		expect(input[1]).toEqual({ type: "function_call", name: "subagents__spawn_agent", arguments: "{}" });
		expect(input[2]).toEqual({ type: "function_call", name: "shell", arguments: '{"input":"ls"}' });
		expect(input[3]).toEqual({ type: "function_call_output", call_id: "call-1", output: "ok" });
		expect(upstreamBody["tool_choice"]).toEqual({ type: "function", name: "subagents__spawn_agent" });
	});

	it("命名空间缺少 tools 数组时报 400", async () => {
		const context = upstreamContext({
			operation: "responses",
			inbound: "responses",
			upstream: "responses",
			model: "grok-4.1",
			body: { model: "grok-4.1", input: "hi", tools: [{ type: "namespace", name: "subagents" }] },
		});
		const error = await captureApiError(async () => adapter.build(context));
		expect(error.statusCode).toBe(400);
	});

	it("命名空间子工具不是 function 时报 400", async () => {
		const context = upstreamContext({
			operation: "responses",
			inbound: "responses",
			upstream: "responses",
			model: "grok-4.1",
			body: {
				model: "grok-4.1",
				input: "hi",
				tools: [{ type: "namespace", name: "subagents", tools: [{ type: "web_search" }] }],
			},
		});
		const error = await captureApiError(async () => adapter.build(context));
		expect(error.statusCode).toBe(400);
		expect(error.message).toContain("function");
	});

	it("展开后名字冲突时报 400", async () => {
		const context = upstreamContext({
			operation: "responses",
			inbound: "responses",
			upstream: "responses",
			model: "grok-4.1",
			body: {
				model: "grok-4.1",
				input: "hi",
				tools: [
					{ type: "namespace", name: "a", tools: [{ type: "function", name: "b__c" }] },
					{ type: "namespace", name: "a__b", tools: [{ type: "function", name: "c" }] },
				],
			},
		});
		const error = await captureApiError(async () => adapter.build(context));
		expect(error.statusCode).toBe(400);
		expect(error.message).toContain("冲突");
	});

	it("超长工具名按插件规则截断，并可还原", async () => {
		const namespace = "namespace-with-a-very-long-name-indeed";
		const name = "tool-with-a-very-long-name-indeed";
		const wire = flattenToolName(name, namespace);
		expect(wire).toHaveLength(64);
		expect(wire.startsWith(`${namespace}__${name}`.slice(0, 50))).toBe(true);
		expect(wire.slice(50, 52)).toBe("__");
		expect(wire.slice(52)).toMatch(/^[0-9a-f]{12}$/);
	});
});

describe("Responses 工具标识还原", () => {
	const adapter = createOpenCodeProvider({ accounts: fakeStore([fakeAccount()]) });
	const requestBody = {
		model: "opencode-go/grok-4.1",
		input: "hi",
		tools: [
			{ type: "namespace", name: "subagents", tools: [{ type: "function", name: "spawn_agent" }] },
			{ type: "custom", name: "shell" },
		],
	};

	/** 构造已登记工具的请求上下文。 */
	async function preparedContext(inbound: SubscriptionInboundProtocol): Promise<SubscriptionUpstreamContext> {
		const context = upstreamContext({
			operation: "responses",
			inbound: "responses",
			upstream: "responses",
			model: "grok-4.1",
			body: requestBody,
		});
		await adapter.build(context);
		return { ...context, inbound: inbound };
	}

	it("非流式响应还原命名空间与 custom 形状", async () => {
		const context = await preparedContext("responses");
		const upstreamResponse = {
			output: [
				{ type: "function_call", id: "item-1", call_id: "call-1", name: "subagents__spawn_agent", arguments: "{}" },
				{ type: "function_call", id: "item-2", call_id: "call-2", name: "shell", arguments: '{"input":"ls"}' },
			],
		};
		const restored = requireHook(adapter.transformUpstreamBody)(context, upstreamResponse);
		const output = list(restored["output"]).map((item) => record(item));
		expect(output[0]).toEqual({
			type: "function_call",
			id: "item-1",
			call_id: "call-1",
			name: "spawn_agent",
			namespace: "subagents",
			arguments: "{}",
		});
		expect(output[1]).toEqual({ type: "custom_tool_call", id: "item-2", call_id: "call-2", name: "shell", input: "ls" });
	});

	it("跨协议入口只还原工具名，不改 custom 形状", async () => {
		const context = await preparedContext("chat");
		const upstreamResponse = {
			output: [
				{ type: "function_call", name: "subagents__spawn_agent", arguments: "{}" },
				{ type: "function_call", name: "shell", arguments: '{"input":"ls"}' },
			],
		};
		const restored = requireHook(adapter.transformUpstreamBody)(context, upstreamResponse);
		const output = list(restored["output"]).map((item) => record(item));
		expect(output[0]).toMatchObject({ type: "function_call", name: "spawn_agent", namespace: "subagents" });
		expect(output[1]).toMatchObject({ type: "function_call", name: "shell", arguments: '{"input":"ls"}' });
		expect(output[1]).not.toHaveProperty("input");
	});

	it("流式事件逐个还原，custom 参数完成事件改写形状", async () => {
		const context = await preparedContext("responses");
		const transform = requireHook(adapter.transformUpstreamEvent);
		const added = requireEvent(
			transform(context, {
				type: "response.output_item.added",
				item: { type: "function_call", id: "item-2", call_id: "call-2", name: "shell", arguments: "" },
			}),
		);
		expect(record(added["item"])).toEqual({
			type: "custom_tool_call",
			id: "item-2",
			call_id: "call-2",
			name: "shell",
			input: "",
		});
		const done = requireEvent(
			transform(context, {
				type: "response.output_item.done",
				item: { type: "function_call", id: "item-2", call_id: "call-2", name: "shell", arguments: '{"input":"ls"}' },
			}),
		);
		expect(record(done["item"])).toEqual({
			type: "custom_tool_call",
			id: "item-2",
			call_id: "call-2",
			name: "shell",
			input: "ls",
		});
		const argumentsDone = transform(context, {
			type: "response.function_call_arguments.done",
			item_id: "item-2",
			arguments: '{"input":"ls -la"}',
		});
		expect(argumentsDone).toEqual({
			type: "response.custom_tool_call_input.done",
			input: "ls -la",
			item_id: "item-2",
		});
		const namespacedDone = requireEvent(
			transform(context, {
				type: "response.function_call_arguments.done",
				name: "subagents__spawn_agent",
				arguments: "{}",
			}),
		);
		expect(namespacedDone["name"]).toBe("spawn_agent");
		const completed = requireEvent(
			transform(context, {
				type: "response.completed",
				response: {
					output: [
						{ type: "function_call", id: "item-1", call_id: "call-1", name: "subagents__spawn_agent", arguments: "{}" },
					],
				},
			}),
		);
		expect(recordAt(record(completed["response"])["output"], 0)).toMatchObject({
			name: "spawn_agent",
			namespace: "subagents",
		});
	});

	it("没有登记时响应与事件原样返回", async () => {
		const context = await preparedContext("responses");
		const gptContext = { ...context, model: "gpt-6-luna" };
		const response = { output: [{ type: "function_call", name: "subagents__spawn_agent", arguments: "{}" }] };
		expect(requireHook(adapter.transformUpstreamBody)(gptContext, response)).toBe(response);
		const event = { type: "response.output_item.done", item: { type: "function_call", name: "subagents__spawn_agent" } };
		expect(requireHook(adapter.transformUpstreamEvent)(gptContext, event)).toBe(event);
	});
});

describe("custom 工具输入展开", () => {
	it("按字段优先级与单键对象展开", () => {
		expect(unwrapCustomToolInput('{"input":"a"}')).toBe("a");
		expect(unwrapCustomToolInput('{"code":"b"}')).toBe("b");
		expect(unwrapCustomToolInput('{"arguments":{"x":1}}')).toBe('{"x":1}');
		expect(unwrapCustomToolInput('{"payload":"c"}')).toBe("c");
		expect(unwrapCustomToolInput("not-json")).toBe("not-json");
	});
});

describe("模型目录", () => {
	it("用第一个可用账号的 key 拉取动态目录并标记协议", async () => {
		const { calls, fetchImpl } = stubFetch([
			{ body: { data: [{ id: "glm-5.3" }, { id: "kimi-k3" }, { id: "claude-haiku-5-5" }] } },
		]);
		const adapter = createOpenCodeProvider({
			accounts: fakeStore([
				fakeAccount({ id: "disabled", fileName: "a.json", disabled: true, raw: { api_key: "disabled-key" } }),
				fakeAccount({ id: "active", fileName: "b.json", raw: { api_key: "oc_sk_active" } }),
			]),
			fetch: fetchImpl,
		});
		const models = await adapter.catalog();
		expect(calls).toHaveLength(1);
		expect(calls[0]?.url).toBe("https://opencode.ai/zen/go/v1/models");
		expect(calls[0]?.headers["Authorization"]).toBe("Bearer oc_sk_active");
		expect(models.map((model) => model.id)).toEqual(["glm-5.3", "kimi-k3", "claude-haiku-5-5"]);
		expect(models[0]?.protocol).toBe("chat");
		expect(models[1]?.protocol).toBe("chat");
		expect(models[2]?.protocol).toBeUndefined();
	});

	it("没有账号时直接回退内置目录", async () => {
		const { calls, fetchImpl } = stubFetch([]);
		const adapter = createOpenCodeProvider({ accounts: fakeStore([]), fetch: fetchImpl });
		const models = await adapter.catalog();
		expect(calls).toHaveLength(0);
		expect(models.map((model) => model.id)).toEqual(["deepseek-v4.1-flash"]);
		expect(models[0]?.protocol).toBe("chat");
	});

	it("账号没有 api_key 或拉取失败时回退内置目录", async () => {
		const noKey = stubFetch([]);
		const adapterWithoutKey = createOpenCodeProvider({
			accounts: fakeStore([fakeAccount({ raw: {} })]),
			fetch: noKey.fetchImpl,
		});
		expect((await adapterWithoutKey.catalog()).map((model) => model.id)).toEqual(["deepseek-v4.1-flash"]);
		expect(noKey.calls).toHaveLength(0);

		const failing = stubFetch([{ status: 500, body: "upstream error" }]);
		const adapterFailing = createOpenCodeProvider({ accounts: fakeStore([fakeAccount()]), fetch: failing.fetchImpl });
		expect((await adapterFailing.catalog()).map((model) => model.id)).toEqual(["deepseek-v4.1-flash"]);
	});

	it("第一个账号失败时尝试下一个账号", async () => {
		const { calls, fetchImpl } = stubFetch([
			{ status: 500, body: "upstream error" },
			{ body: { data: [{ id: "minimax-m3" }] } },
		]);
		const adapter = createOpenCodeProvider({
			accounts: fakeStore([
				fakeAccount({ id: "first", fileName: "a.json", raw: { api_key: "oc_sk_first" } }),
				fakeAccount({ id: "second", fileName: "b.json", raw: { api_key: "oc_sk_second" } }),
			]),
			fetch: fetchImpl,
		});
		const models = await adapter.catalog();
		expect(calls.map((call) => call.headers["Authorization"])).toEqual(["Bearer oc_sk_first", "Bearer oc_sk_second"]);
		expect(models.map((model) => model.id)).toEqual(["minimax-m3"]);
		expect(models[0]?.protocol).toBe("messages");
	});
});

describe("额度查询", () => {
	it("归一化 rolling/weekly/monthly 三个窗口", async () => {
		const { calls, fetchImpl } = stubFetch([
			{
				body: {
					usage: {
						rolling: { percent: 25, resetsAt: "2026-01-01T00:00:00Z" },
						weekly: { percent: 100 },
						monthly: { percent: 0, resetsAt: "2026-02-01T00:00:00Z" },
					},
				},
			},
		]);
		const adapter = createOpenCodeProvider({ accounts: fakeStore([fakeAccount()]), fetch: fetchImpl });
		const snapshot = await adapter.quota(fakeAccount());
		expect(calls).toHaveLength(1);
		expect(calls[0]?.url).toBe("https://opencode.ai/zen/go/v1/usage");
		expect(calls[0]?.headers["Authorization"]).toBe("Bearer oc_sk_test");
		expect(snapshot.plan).toBe("Go");
		expect(snapshot.windows?.map((window) => window.name)).toEqual(["5 小时", "周", "月"]);
		expect(snapshot.windows?.[0]?.remainingFraction).toBe(0.75);
		expect(snapshot.windows?.[1]?.remainingFraction).toBe(0);
		expect(snapshot.windows?.[2]?.remainingFraction).toBe(1);
		expect(snapshot.windows?.[0]?.resetTime).toBe("2026-01-01T00:00:00.000Z");
		expect(Number.isNaN(Date.parse(snapshot.fetchedAt))).toBe(false);
	});

	it("账号缺少 API key 时按不可用报错", async () => {
		const adapter = createOpenCodeProvider({ accounts: fakeStore([fakeAccount({ raw: {} })]) });
		const error = await captureApiError(async () => adapter.auth.ensureCredential(fakeAccount({ raw: {} })));
		expect(error.statusCode).toBe(503);
	});

	it("上游失败时抛出可重试的不可用错误", async () => {
		const { fetchImpl } = stubFetch([{ status: 500, body: "upstream error" }]);
		const adapter = createOpenCodeProvider({ accounts: fakeStore([fakeAccount()]), fetch: fetchImpl });
		await expect(adapter.quota(fakeAccount())).rejects.toMatchObject({ statusCode: 503 });
	});
});

describe("适配器元数据", () => {
	it("来源与展示名符合订阅运行时契约", () => {
		const adapter = createOpenCodeProvider({ accounts: fakeStore([]) });
		expect(adapter.source).toBe(OPENCODE_SOURCE);
		expect(adapter.source).toBe("opencode-go");
		expect(adapter.displayName).toBe("OpenCode Go");
		expect(adapter.auth.source).toBe("opencode-go");
	});
});
