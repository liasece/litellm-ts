/**
 * CommandCode 上游协议细节。
 *
 * 这里只放与 HTTP 无关的纯函数：路由分派、会话头求值、Responses `namespace`
 * 工具的拍平与还原、`reasoning_content` 回填，以及上游请求体的少量清洗。
 * 规则来自原 Go 插件 `commandcode-go-cliproxyapi` 的 `internal/catalog` 与
 * `internal/adapter/shared`，不逐行翻译，只保留会影响线上行为的分支：
 *
 * - 默认路由是 Responses；Claude 家族只能走 Messages（上游在 `/responses` 上
 *   明确拒绝 Claude）。`/chat/completions` 只有显式覆盖才会用到，但工具拍平与
 *   还原规则按插件保留。
 * - `namespace` 工具在 Chat Completions 无法表达，拍平成 `<namespace>__<name>`
 *   （与 LiteLLM Responses 兼容层同名规则），回程再还原成 `name` + `namespace`。
 * - 供应商把思考文本放在 `reasoning` / `reasoning_details[].text`，标准字段是
 *   `reasoning_content`，透传路径要补齐后者。
 */

import { createHash } from "node:crypto";
import { ApiError } from "../../../core/api/ApiError";
import { COMMANDCODE_API_BASE } from "../catalog/dynamicCatalog";
import type { SubscriptionWireProtocol } from "../types";

/** CommandCode Provider API 基址（插件 `config.DefaultBaseURL`）。 */
export const COMMANDCODE_BASE_URL: string = COMMANDCODE_API_BASE;

/** CommandCode 服务的三条上游路由。 */
export type CommandCodeRoute = "chat" | "messages" | "responses";

/**
 * 三条上游路由的端点路径。
 *
 * 插件用 `/v1/...` 拼在基址上并把 `/v1` 前缀丢掉：`{base}` 自带 `/provider/v1`，
 * 最终请求就是 `{base}/chat/completions`、`{base}/messages`、`{base}/responses`。
 */
export const COMMANDCODE_ENDPOINT_PATHS: Readonly<Record<CommandCodeRoute, string>> = {
	chat: "/chat/completions",
	messages: "/messages",
	responses: "/responses",
};

/**
 * 判断上游协议是否由 CommandCode 提供。
 * @param protocol - 上游协议
 */
export function isCommandCodeRoute(protocol: SubscriptionWireProtocol): protocol is CommandCodeRoute {
	return Object.hasOwn(COMMANDCODE_ENDPOINT_PATHS, protocol);
}

/** 会话亲和请求头。 */
export const COMMANDCODE_SESSION_HEADER = "x-commandcode-session";

/**
 * 没有任何用户输入时的会话标识（空串的 SHA-256）。
 *
 * 插件在请求里没有首条用户消息时用这个固定摘要占位，避免每次请求都换一个随机会话。
 */
export const COMMANDCODE_EMPTY_SESSION_ID = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

/** Messages 路由要求的 Anthropic 版本头。 */
export const COMMANDCODE_ANTHROPIC_VERSION = "2023-06-01";

/** 公开模型 ID 前缀（插件 `model-prefix` 默认值）。 */
export const COMMANDCODE_PUBLIC_PREFIX = "commandcode/";

/** Responses `namespace` 工具拍平后的分隔符（与 LiteLLM 兼容层一致）。 */
export const COMMANDCODE_TOOL_SEPARATOR = "__";

/** Chat Completions / Messages 允许的函数名长度上限。 */
export const COMMANDCODE_MAX_TOOL_NAME_LENGTH = 64;

/** namespace 拍平索引：线上函数名 → 客户端声明的 namespace。 */
export type CommandCodeToolNamespaces = ReadonlyMap<string, string>;

/** 会话键前缀：bridge 取值时会给来源加前缀，这里还原成插件认识的裸值。 */
const SESSION_KEY_PREFIXES: ReadonlySet<string> = new Set([
	"x-commandcode-session",
	"x-opencode-session",
	"x-litellm-session",
	"x-session-id",
	"conversation_id",
	"x-conversation-id",
	"prompt_cache_key",
	"session_id",
	"content",
]);

/** 缺失参数时的函数工具 schema：Chat Completions 的校验要求 `type: object`。 */
const EMPTY_PARAMETERS: Readonly<Record<string, unknown>> = Object.freeze({ type: "object", properties: {} });

/**
 * 判断普通 JSON 对象。
 * @param value - 待判定值
 */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 取非空字符串。
 * @param value - 待判定值
 */
function textOf(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * 判断模型 ID 是否属于 Claude 家族。
 *
 * 上游把模型挂在可选的 `vendor/` 前缀下（`claude-sonnet-5-5`、
 * `anthropic/claude-opus-5`），插件按最后一段判断，这里保持一致。
 * @param model - 模型 ID（公开或上游 ID 都可以）
 */
export function isCommandCodeClaudeModel(model: string): boolean {
	const trimmed = model.trim();
	const name = trimmed.includes("/") ? trimmed.slice(trimmed.lastIndexOf("/") + 1) : trimmed;
	return name.toLowerCase().startsWith("claude");
}

/**
 * 按插件 `routeFor`/`DefaultRoute` 选择上游协议。
 * @param model - 模型 ID
 * @returns Claude 走 messages，其余走 responses
 */
export function commandCodeRouteForModel(model: string): SubscriptionWireProtocol {
	return isCommandCodeClaudeModel(model) ? "messages" : "responses";
}

/**
 * 把 bridge 的会话键还原成 `x-commandcode-session` 的取值。
 *
 * bridge 的键形如 `<来源>:<值>`（`x-commandcode-session:abc`、`content:<摘要>`、
 * `metadata.user_id:<值>`）或空串。插件发送的是裸会话 ID；没有会话信息时用空输入
 * 摘要占位，让同一批无会话请求仍能落在同一上游会话里。
 * @param sessionKey - bridge 计算的会话亲和键
 */
export function commandCodeSessionValue(sessionKey: string): string {
	const trimmed = sessionKey.trim();
	if (trimmed.length === 0) {
		return COMMANDCODE_EMPTY_SESSION_ID;
	}
	const separator = trimmed.indexOf(":");
	if (separator > 0) {
		const prefix = trimmed.slice(0, separator);
		const value = trimmed.slice(separator + 1).trim();
		if (value.length > 0 && (SESSION_KEY_PREFIXES.has(prefix) || prefix.startsWith("metadata."))) {
			return value;
		}
	}
	return trimmed;
}

/**
 * 读取工具声明里的类型。
 *
 * Anthropic 的工具没有 `type` 字段，按 `function` 处理；其余来源原样读取。
 * @param tool - 工具声明
 */
function toolTypeOf(tool: Record<string, unknown>): string {
	return textOf(tool["type"]) ?? "function";
}

/**
 * 过滤函数名到上游可接受的字符集（大小写字母、数字、下划线、连字符）。
 * @param name - 原始名字
 */
function sanitizeToolName(name: string): string {
	let out = "";
	for (const character of name) {
		out += /[A-Za-z0-9_-]/.test(character) ? character : "_";
	}
	return out;
}

/**
 * 把 namespace 与嵌套工具名拍平成一个线上函数名。
 *
 * 超长名字用稳定哈希后缀截断，避免两个不同工具被截成同一个名字。
 * @param namespace - 客户端声明的 namespace
 * @param name - namespace 内的工具名
 */
export function commandCodeNamespacedToolName(namespace: string, name: string): string {
	const base = sanitizeToolName(`${namespace}${COMMANDCODE_TOOL_SEPARATOR}${name}`);
	if (base.length <= COMMANDCODE_MAX_TOOL_NAME_LENGTH) {
		return base;
	}
	const digest = createHash("sha256").update(`${namespace}\u0000${name}`).digest("hex").slice(0, 12);
	const suffix = `_${digest}`;
	if (suffix.length >= COMMANDCODE_MAX_TOOL_NAME_LENGTH) {
		return suffix.slice(0, COMMANDCODE_MAX_TOOL_NAME_LENGTH);
	}
	return `${base.slice(0, COMMANDCODE_MAX_TOOL_NAME_LENGTH - suffix.length)}${suffix}`;
}

/**
 * 归一化函数工具的 `parameters`。
 *
 * 与插件 `ObjectSchema` 一致：缺失时补空对象 schema，对象缺 `type` 时补
 * `type: object`；非对象（数组、字符串等）原样透传，由上游给出可读的拒绝，
 * 不在这里替客户端改写语义。
 * @param value - 工具声明里的 parameters
 */
export function normalizeToolParameters(value: unknown): unknown {
	if (value === undefined || value === null) {
		return { ...EMPTY_PARAMETERS };
	}
	if (!isRecord(value)) {
		return value;
	}
	if (textOf(value["type"]) !== undefined) {
		return { ...value };
	}
	return { ...value, type: "object" };
}

/**
 * 收集一个请求里所有 namespace 工具的拍平索引。
 * @param body - 客户端原始请求体（Responses 形态）
 * @returns 线上函数名 → namespace；没有 namespace 工具时为空表
 */
export function commandCodeToolNamespaces(body: Record<string, unknown>): CommandCodeToolNamespaces {
	const index = new Map<string, string>();
	const tools = body["tools"];
	if (!Array.isArray(tools)) {
		return index;
	}
	for (const entry of tools) {
		if (!isRecord(entry) || toolTypeOf(entry) !== "namespace") {
			continue;
		}
		const namespace = textOf(entry["name"]);
		const nested = entry["tools"];
		if (namespace === undefined || !Array.isArray(nested)) {
			continue;
		}
		for (const child of nested) {
			if (!isRecord(child) || toolTypeOf(child) !== "function") {
				continue;
			}
			const name = textOf(child["name"]);
			if (name === undefined) {
				continue;
			}
			const flat = commandCodeNamespacedToolName(namespace, name);
			if (!index.has(flat)) {
				index.set(flat, namespace);
			}
		}
	}
	return index;
}

/**
 * 把一个 namespace 工具展开成扁平的函数工具声明。
 * @param tool - namespace 工具声明
 * @throws ApiError - 声明不完整，或嵌套工具无法在 chat 端点表达时
 */
function flattenNamespaceTool(tool: Record<string, unknown>): Record<string, unknown>[] {
	const namespace = textOf(tool["name"]);
	if (namespace === undefined) {
		throw ApiError.badRequest("CommandCode 的 namespace 工具缺少名称");
	}
	const nested = tool["tools"];
	if (!Array.isArray(nested) || nested.length === 0) {
		throw ApiError.badRequest(`CommandCode 的 namespace 工具「${namespace}」缺少嵌套工具`);
	}
	const specs: Record<string, unknown>[] = [];
	for (const entry of nested) {
		if (!isRecord(entry)) {
			throw ApiError.badRequest(`CommandCode 的 namespace 工具「${namespace}」包含非对象声明`);
		}
		const type = toolTypeOf(entry);
		if (type !== "function") {
			throw ApiError.badRequest(
				`不支持的工具类型「${type}」；/chat/completions 只能承载 function 工具`,
			);
		}
		const name = textOf(entry["name"]);
		if (name === undefined) {
			throw ApiError.badRequest(`CommandCode 的 namespace 工具「${namespace}」包含缺少名称的工具`);
		}
		const description = textOf(entry["description"]) ?? textOf(tool["description"]);
		const fn: Record<string, unknown> = {
			name: commandCodeNamespacedToolName(namespace, name),
			parameters: normalizeToolParameters(entry["parameters"]),
		};
		if (description !== undefined) {
			fn["description"] = description;
		}
		specs.push({ type: "function", function: fn });
	}
	return specs;
}

/**
 * 把 Chat Completions 上游请求体里的工具整理成该端点能承载的形状。
 *
 * 协议转换已经拍平过时这里是无操作；仍是 namespace 声明（或转换层不认识）时
 * 按插件规则展开成 `<namespace>__<name>`，并拒绝 chat 端点无法表达的工具类型。
 * @param body - 待发送的上游请求体
 * @returns 可能替换过 `tools` 的新请求体
 * @throws ApiError - 存在 chat 端点无法承载的工具声明时
 */
export function applyChatToolNamespaces(body: Record<string, unknown>): Record<string, unknown> {
	const tools = body["tools"];
	if (!Array.isArray(tools)) {
		return body;
	}
	const flattened: Record<string, unknown>[] = [];
	let changed = false;
	for (const entry of tools) {
		if (!isRecord(entry)) {
			throw ApiError.badRequest("CommandCode 的工具声明必须是对象");
		}
		const type = toolTypeOf(entry);
		if (type === "namespace") {
			changed = true;
			flattened.push(...flattenNamespaceTool(entry));
			continue;
		}
		if (type !== "function") {
			throw ApiError.badRequest(`不支持的工具类型「${type}」；/chat/completions 只能承载 function 工具`);
		}
		flattened.push(entry);
	}
	return changed ? { ...body, tools: flattened } : body;
}

/**
 * 读取 chat 工具声明的函数名。
 * @param entry - 工具声明
 */
function chatToolName(entry: unknown): string | undefined {
	if (!isRecord(entry)) {
		return undefined;
	}
	const fn = entry["function"];
	if (isRecord(fn)) {
		const nested = textOf(fn["name"]);
		if (nested !== undefined) {
			return nested;
		}
	}
	return textOf(entry["name"]);
}

/**
 * 从客户端请求体补齐 namespace 工具拍平后的函数声明。
 *
 * 协议转换层只认识 function 工具，Responses 的 `namespace` 工具在转成 chat 请求体时
 * 会被丢弃；这里按插件规则从客户端原始请求体补回来，避免显式落到
 * `/chat/completions` 时静默丢工具。同名声明只保留一条。
 * @param body - 已转换的上游请求体
 * @param clientBody - 客户端原始请求体
 * @returns 可能补充过 `tools` 的新请求体
 * @throws ApiError - namespace 声明不完整，或工具类型无法在 chat 端点表达时
 */
export function appendFlattenedNamespaceTools(
	body: Record<string, unknown>,
	clientBody: Record<string, unknown>,
): Record<string, unknown> {
	const tools = clientBody["tools"];
	if (!Array.isArray(tools)) {
		return body;
	}
	const flattened: Record<string, unknown>[] = [];
	for (const entry of tools) {
		if (!isRecord(entry)) {
			continue;
		}
		const type = toolTypeOf(entry);
		if (type === "namespace") {
			flattened.push(...flattenNamespaceTool(entry));
			continue;
		}
		if (type !== "function") {
			throw ApiError.badRequest(`不支持的工具类型「${type}」；/chat/completions 只能承载 function 工具`);
		}
	}
	if (flattened.length === 0) {
		return body;
	}
	const existing = Array.isArray(body["tools"]) ? body["tools"] : [];
	const names = new Set<string>();
	const merged: unknown[] = [];
	for (const entry of [...existing, ...flattened]) {
		const name = chatToolName(entry);
		if (name !== undefined) {
			if (names.has(name)) {
				continue;
			}
			names.add(name);
		}
		merged.push(entry);
	}
	return { ...body, tools: merged };
}

/**
 * 校验 Messages 路由能承载的工具声明。
 *
 * 上游 `/messages` 没有 namespace 形态，插件对这类工具直接报不支持；Claude 模型
 * 一定要走这条路由，所以提前给出可读的拒绝而不是让上游 400。
 * @param body - 客户端原始请求体
 * @throws ApiError 声明了 namespace 工具时抛出
 */
export function assertMessagesCompatibleTools(body: Record<string, unknown>): void {
	const tools = body["tools"];
	if (!Array.isArray(tools)) {
		return;
	}
	for (const entry of tools) {
		if (isRecord(entry) && toolTypeOf(entry) === "namespace") {
			throw ApiError.badRequest(
				'不支持的工具类型 "namespace"；Claude 模型使用的 /messages 端点只能承载 function 工具',
			);
		}
	}
}

/**
 * 清理非法的顶层 `thinking` 对象。
 *
 * DeepSeek 系模型会因为 `thinking` 缺少字符串 `type` 直接报错；插件在 Chat
 * Completions 透传路径上删除这种对象（合法的 Anthropic `thinking` 原样保留）。
 * @param body - 上游请求体
 * @returns 是否删除了字段
 */
export function stripMalformedThinking(body: Record<string, unknown>): boolean {
	if (!Object.hasOwn(body, "thinking")) {
		return false;
	}
	const thinking = body["thinking"];
	const valid = isRecord(thinking) && textOf(thinking["type"]) !== undefined;
	if (valid) {
		return false;
	}
	delete body["thinking"];
	return true;
}

/**
 * 从一条 chat 消息/增量里取供应商思考文本。
 *
 * 优先级与插件 `ReasoningText` 一致：`reasoning_details[].text`（逐 token 的权威
 * 文本）、`reasoning`、最后才是已经标准的 `reasoning_content`。
 * @param message - `choices[].message` 或 `choices[].delta`
 */
function reasoningTextOf(message: Record<string, unknown>): string | undefined {
	const details = message["reasoning_details"];
	if (Array.isArray(details)) {
		const parts: string[] = [];
		for (const detail of details) {
			const text = isRecord(detail) ? detail["text"] : undefined;
			if (typeof text === "string" && text.trim().length > 0) {
				parts.push(text);
			}
		}
		if (parts.length > 0) {
			return parts.join("");
		}
	}
	const reasoning = message["reasoning"];
	if (typeof reasoning === "string" && reasoning.trim().length > 0) {
		return reasoning;
	}
	const content = message["reasoning_content"];
	if (typeof content === "string" && content.trim().length > 0) {
		return content;
	}
	return undefined;
}

/**
 * 把供应商思考文本补齐到标准的 `reasoning_content` 成员。
 *
 * 只处理 chat 形状（`choices[].message` / `choices[].delta`）；已有非空
 * `reasoning_content` 的成员保持原样，没有思考字段的响应体视为不可变。
 * @param body - chat 响应体或流式 chunk
 * @returns 修改后的新对象；不需要修改时为 undefined
 */
export function backfillChatReasoning(body: Record<string, unknown>): Record<string, unknown> | undefined {
	const choices = body["choices"];
	if (!Array.isArray(choices)) {
		return undefined;
	}
	let changed = false;
	const nextChoices = choices.map((choice) => {
		if (!isRecord(choice)) {
			return choice;
		}
		let choiceChanged = false;
		const nextChoice: Record<string, unknown> = { ...choice };
		for (const field of ["message", "delta"]) {
			const holder = choice[field];
			if (!isRecord(holder)) {
				continue;
			}
			const text = reasoningTextOf(holder);
			if (text === undefined) {
				continue;
			}
			const existing = holder["reasoning_content"];
			if (typeof existing === "string" && existing.trim().length > 0) {
				continue;
			}
			nextChoice[field] = { ...holder, reasoning_content: text };
			choiceChanged = true;
		}
		if (!choiceChanged) {
			return choice;
		}
		changed = true;
		return nextChoice;
	});
	return changed ? { ...body, choices: nextChoices } : undefined;
}

/**
 * 把一条 Responses 输出项上的扁平函数名还原成客户端的工具身份。
 * @param item - 输出项
 * @param namespaces - 请求侧的拍平索引
 * @returns 还原后的新输出项；不需要还原时为 undefined
 */
function restoreToolIdentity(
	item: unknown,
	namespaces: CommandCodeToolNamespaces,
): Record<string, unknown> | undefined {
	if (!isRecord(item) || item["type"] !== "function_call") {
		return undefined;
	}
	const name = item["name"];
	if (typeof name !== "string") {
		return undefined;
	}
	const namespace = namespaces.get(name);
	if (namespace === undefined) {
		return undefined;
	}
	const prefix = `${namespace}${COMMANDCODE_TOOL_SEPARATOR}`;
	const restored = name.startsWith(prefix) ? name.slice(prefix.length) : name;
	return { ...item, name: restored, namespace: namespace };
}

/**
 * 批量还原输出项数组。
 * @param items - 输出项数组
 * @param namespaces - 请求侧的拍平索引
 * @returns 还原后的新数组；没有变化时为 undefined
 */
function restoreToolIdentities(
	items: readonly unknown[],
	namespaces: CommandCodeToolNamespaces,
): unknown[] | undefined {
	let changed = false;
	const next = items.map((item) => {
		const restored = restoreToolIdentity(item, namespaces);
		if (restored === undefined) {
			return item;
		}
		changed = true;
		return restored;
	});
	return changed ? next : undefined;
}

/**
 * 在 Responses 非流式响应体里还原被拍平的 namespace 工具。
 * @param body - 入口协议响应体
 * @param namespaces - 请求侧的拍平索引
 * @returns 修改后的新响应体；不需要还原时为 undefined
 */
export function restoreResponsesToolNamespaces(
	body: Record<string, unknown>,
	namespaces: CommandCodeToolNamespaces,
): Record<string, unknown> | undefined {
	if (namespaces.size === 0) {
		return undefined;
	}
	const output = body["output"];
	if (!Array.isArray(output)) {
		return undefined;
	}
	const next = restoreToolIdentities(output, namespaces);
	return next === undefined ? undefined : { ...body, output: next };
}

/**
 * 在 Responses 流式事件里还原被拍平的 namespace 工具。
 *
 * 覆盖 `response.output_item.added/done`（顶层 `item`）、`response.completed`
 * 一类的终态（`response.output`）以及个别只带 `output` 的事件。
 * @param payload - 入口协议事件载荷
 * @param namespaces - 请求侧的拍平索引
 * @returns 修改后的新载荷；不需要还原时为 undefined
 */
export function restoreResponsesEventNamespaces(
	payload: Record<string, unknown>,
	namespaces: CommandCodeToolNamespaces,
): Record<string, unknown> | undefined {
	if (namespaces.size === 0) {
		return undefined;
	}
	let next: Record<string, unknown> = payload;
	let changed = false;
	const restoredItem = restoreToolIdentity(payload["item"], namespaces);
	if (restoredItem !== undefined) {
		next = { ...next, item: restoredItem };
		changed = true;
	}
	const output = payload["output"];
	if (Array.isArray(output)) {
		const restored = restoreToolIdentities(output, namespaces);
		if (restored !== undefined) {
			next = { ...next, output: restored };
			changed = true;
		}
	}
	const response = payload["response"];
	if (isRecord(response)) {
		const responseOutput = response["output"];
		if (Array.isArray(responseOutput)) {
			const restored = restoreToolIdentities(responseOutput, namespaces);
			if (restored !== undefined) {
				next = { ...next, response: { ...response, output: restored } };
				changed = true;
			}
		}
	}
	return changed ? next : undefined;
}
