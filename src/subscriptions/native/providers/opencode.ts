/**
 * OpenCode Go 订阅 Provider 适配器。
 *
 * 上游是 OpenCode Go 的 OpenAI 兼容网关：按模型家族把请求分派到
 * `/v1/chat/completions`、`/v1/messages` 或 `/v1/responses`，认证使用账号
 * 的 `api_key`。这里只做 provider 特化：家族路由、上游 URL/请求头、模型
 * 改写、Chat/Messages 的兼容修复，以及 Responses 工具命名空间的展开与还原；
 * 跨协议翻译由协议桥负责。
 */

import { ApiError } from "../../../core/api/ApiError";
import { createApiKeyAuth } from "../auth/apiKey";
import { catalogForSource, refreshDynamicCatalog } from "../catalog/catalog";
import { OPENCODE_API_BASE } from "../catalog/dynamicCatalog";
import { quotaForAccount } from "../quota/quota";
import { headerValue, sanitizeHeaderValue, sessionKeyValue, stableDeviceId } from "../session";
import { normalizeToolNames } from "../toolNames";
import type {
	SubscriptionAccount,
	SubscriptionCatalogModel,
	SubscriptionOperation,
	SubscriptionProviderAdapter,
	SubscriptionQuotaSnapshot,
	SubscriptionRequestContext,
	SubscriptionSource,
	SubscriptionUpstreamContext,
	SubscriptionUpstreamPlan,
	SubscriptionWireProtocol,
} from "../types";
import type { SubscriptionProviderDependencies } from "./types";
import { JSON_HEADERS, SSE_HEADERS, asBodyRecord, asString, bearerHeaders, joinUrl, jsonPlan } from "./shared";
import {
	normalizeResponsesRequest,
	restoreResponsesBody,
	restoreResponsesEvent,
	type ResponseToolRegistry,
} from "./opencodeResponses";

/** 账号来源。 */
export const OPENCODE_SOURCE: SubscriptionSource = "opencode-go";

/** 展示名。 */
export const OPENCODE_DISPLAY_NAME = "OpenCode Go";

/** 没有下游客户端标识时使用的 User-Agent。 */
export const OPENCODE_USER_AGENT = "litellm-ts";

/** Anthropic 兼容端点要求的版本头。 */
const ANTHROPIC_VERSION = "2023-06-01";

/** Messages 路由缺失 `max_tokens` 时的缺省值。 */
const DEFAULT_CLAUDE_MAX_TOKENS = 4096;

/** OpenCode Go 的三条上游路由。 */
type OpenCodeRoute = "chat" | "messages" | "responses";

/** 路由到上游端点路径（基址已包含 `/v1`）。 */
const ROUTE_ENDPOINTS: Readonly<Record<OpenCodeRoute, string>> = {
	chat: "/chat/completions",
	messages: "/messages",
	responses: "/responses",
};

/**
 * 模型家族前缀 → 上游路由。
 *
 * 与插件内置路由表一致；匹配时取最长前缀，未命中任何家族的模型没有确定
 * 路由，适配器拒绝承接。
 */
const FAMILY_ROUTES: ReadonlyArray<readonly [string, OpenCodeRoute]> = [
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

/**
 * 创建 OpenCode Go 适配器。
 * @param dependencies - 账号仓库与可注入的 fetch
 * @returns 适配器实例
 */
export function createOpenCodeProvider(dependencies: SubscriptionProviderDependencies): SubscriptionProviderAdapter {
	const auth = createApiKeyAuth(OPENCODE_SOURCE);
	const fetchImpl = dependencies.fetch ?? fetch;
	const registries = new WeakMap<Record<string, unknown>, ResponseToolRegistry>();

	/**
	 * 该操作/模型是否由本适配器承接。
	 * @param operation - 端点操作
	 * @param model - 请求模型
	 * @returns 已知家族的三类对话操作返回 true
	 */
	function supports(operation: SubscriptionOperation, model: string): boolean {
		if (operation !== "chat" && operation !== "messages" && operation !== "responses") {
			return false;
		}
		return routeOfModel(model) !== undefined;
	}

	/**
	 * 选择上游协议。
	 * @param context - 请求上下文
	 * @returns 上游协议
	 * @throws ApiError 模型家族未知时抛出
	 */
	function route(context: SubscriptionRequestContext): SubscriptionWireProtocol {
		const matched = routeOfModel(context.model);
		if (matched === undefined) {
			throw ApiError.badRequest(`${OPENCODE_DISPLAY_NAME} 不支持模型：${context.model}`);
		}
		return matched;
	}

	/**
	 * 把公开模型映射为上游模型：只去掉 `opencode-go/` 前缀。
	 * @param model - 公开模型 ID
	 * @returns 上游模型 ID
	 */
	function resolveModel(model: string): string {
		return bareModelId(model);
	}

	/**
	 * 构造上游请求。
	 * @param context - 已翻译的上游请求上下文
	 * @returns 上游请求计划
	 * @throws ApiError 请求体或协议不受支持时抛出
	 */
	async function build(context: SubscriptionUpstreamContext): Promise<SubscriptionUpstreamPlan> {
		const upstreamRoute = routeOfWireProtocol(context.upstream);
		const upstreamModel = bareModelId(context.model);
		const body = asBodyRecord(context.upstreamBody);
		let upstreamBody: Record<string, unknown>;
		if (upstreamRoute === "chat") {
			upstreamBody = normalizeChatBody(body, upstreamModel);
		} else if (upstreamRoute === "messages") {
			upstreamBody = normalizeMessagesBody(body, upstreamModel);
		} else {
			const normalized = normalizeResponsesRequest(body, upstreamModel, {
				flattenTools: !isGptModel(upstreamModel),
			});
			upstreamBody = normalized.body;
			registries.set(context.body, normalized.registry);
		}
		if (upstreamRoute !== "responses") {
			registries.delete(context.body);
		}
		const toolNames = upstreamRoute === "responses" ? undefined : normalizeToolNames(upstreamBody);
		const plan = jsonPlan(
			joinUrl(OPENCODE_API_BASE, ROUTE_ENDPOINTS[upstreamRoute]),
			upstreamHeaders(context, upstreamRoute),
			upstreamBody,
			upstreamModel,
			context.stream,
			upstreamRoute,
		);
		return toolNames === undefined ? plan : { ...plan, toolNames: toolNames };
	}

	/**
	 * 还原 Responses 响应里的工具标识。
	 * @param context - 请求上下文
	 * @param body - 上游响应体
	 * @returns 同一个响应体；没有需要还原的条目时原样返回
	 */
	function transformUpstreamBody(
		context: SubscriptionRequestContext,
		body: Record<string, unknown>,
	): Record<string, unknown> {
		const registry = registries.get(context.body);
		if (!registry || registry.identities.size === 0 || routeOfModel(context.model) !== "responses") {
			return body;
		}
		return restoreResponsesBody(registry, body, { restoreCustom: context.inbound === "responses" });
	}

	/**
	 * 还原 Responses SSE 事件里的工具标识。
	 * @param context - 请求上下文
	 * @param event - 上游事件数据
	 * @returns 原事件或改写后的事件
	 */
	function transformUpstreamEvent(
		context: SubscriptionRequestContext,
		event: Record<string, unknown>,
	): Record<string, unknown> {
		const registry = registries.get(context.body);
		if (!registry || registry.identities.size === 0 || routeOfModel(context.model) !== "responses") {
			return event;
		}
		return restoreResponsesEvent(registry, event, { restoreCustom: context.inbound === "responses" });
	}

	/**
	 * 拉取模型目录。
	 *
	 * 优先用第一个可用账号的 key 拉取动态目录；没有账号、没有 key 或全部
	 * 账号拉取失败时回退内置目录。
	 * @returns 模型目录
	 */
	async function catalog(): Promise<readonly SubscriptionCatalogModel[]> {
		const fallback = catalogForSource(OPENCODE_SOURCE);
		let accounts: readonly SubscriptionAccount[];
		try {
			accounts = await dependencies.accounts.list(OPENCODE_SOURCE);
		} catch {
			return fallback;
		}
		for (const account of accounts) {
			if (account.disabled) {
				continue;
			}
			const apiKey = asString(account.raw["api_key"]);
			if (apiKey === undefined) {
				continue;
			}
			try {
				const models = await refreshDynamicCatalog(OPENCODE_SOURCE, apiKey, fetchImpl);
				if (models !== fallback) {
					return models;
				}
			} catch {
				// 单个账号失败时继续尝试下一个可用账号。
			}
		}
		return fallback;
	}

	/**
	 * 查询一个账号的额度。
	 * @param account - 选中账号
	 * @returns 归一化额度快照
	 * @throws ApiError 凭据缺失或上游查询失败时抛出
	 */
	async function quota(account: SubscriptionAccount): Promise<SubscriptionQuotaSnapshot> {
		const credential = await auth.ensureCredential(account);
		const snapshot = await quotaForAccount(OPENCODE_SOURCE, account, credential, fetchImpl);
		const balances: Record<string, number> = {};
		for (const balance of snapshot.balances) {
			balances[balance.label] = Math.max(0, balance.limit - balance.used);
		}
		const windows = snapshot.windows.map((window) => ({
			name: window.label.length > 0 ? window.label : window.id,
			...(window.remaining_percent === null ? {} : { remainingFraction: window.remaining_percent / 100 }),
			...(window.resets_at === null ? {} : { resetTime: window.resets_at }),
			raw: {
				id: window.id,
				used_percent: window.used_percent,
				remaining_percent: window.remaining_percent,
				resets_at: window.resets_at,
			},
		}));
		return {
			...(snapshot.plan === null ? {} : { plan: snapshot.plan }),
			...(snapshot.subscription_expires_at === null ? {} : { expiresAt: snapshot.subscription_expires_at }),
			...(snapshot.balances.length === 0 ? {} : { balances: balances }),
			windows: windows,
			fetchedAt: snapshot.fetched_at,
		};
	}

	return {
		source: OPENCODE_SOURCE,
		displayName: OPENCODE_DISPLAY_NAME,
		auth: auth,
		supports: supports,
		route: route,
		resolveModel: resolveModel,
		build: build,
		transformUpstreamBody: transformUpstreamBody,
		transformUpstreamEvent: transformUpstreamEvent,
		catalog: catalog,
		quota: quota,
	};
}

/**
 * 去掉公开模型 ID 上的 `opencode-go/` 前缀。
 * @param model - 模型 ID
 * @returns 上游模型 ID
 */
function bareModelId(model: string): string {
	const trimmed = model.trim();
	const separator = trimmed.indexOf("/");
	if (separator > 0 && trimmed.slice(0, separator).toLowerCase() === OPENCODE_SOURCE) {
		return trimmed.slice(separator + 1).trim();
	}
	return trimmed;
}

/**
 * 按模型家族选择上游路由。
 * @param model - 模型 ID
 * @returns 路由；未知家族返回 undefined
 */
function routeOfModel(model: string): OpenCodeRoute | undefined {
	const name = bareModelId(model).toLowerCase();
	let matched: OpenCodeRoute | undefined;
	let matchedLength = 0;
	for (const [prefix, protocol] of FAMILY_ROUTES) {
		if (name.startsWith(prefix) && prefix.length > matchedLength) {
			matched = protocol;
			matchedLength = prefix.length;
		}
	}
	return matched;
}

/**
 * 判断上游协议是否由 OpenCode Go 支持。
 * @param protocol - 上游协议
 * @returns 对应的路由
 * @throws ApiError 协议不是 chat/messages/responses 时抛出
 */
function routeOfWireProtocol(protocol: SubscriptionWireProtocol): OpenCodeRoute {
	if (protocol === "chat" || protocol === "messages" || protocol === "responses") {
		return protocol;
	}
	throw ApiError.badRequest(`${OPENCODE_DISPLAY_NAME} 不支持上游协议：${protocol}`);
}

/**
 * 判断模型是否属于 GPT 家族；该家族的 Responses 端点原生支持 namespace 工具。
 * @param model - 上游模型 ID
 * @returns 是否 GPT 家族
 */
function isGptModel(model: string): boolean {
	return model.toLowerCase().startsWith("gpt");
}

/**
 * 构造上游请求头。
 * @param context - 上游请求上下文
 * @param route - 上游路由
 * @returns 请求头
 */
function upstreamHeaders(context: SubscriptionUpstreamContext, route: OpenCodeRoute): Record<string, string> {
	const headers: Record<string, string> = context.stream ? { ...SSE_HEADERS } : { ...JSON_HEADERS };
	headers["x-opencode-session"] = sessionHeaderValue(context.sessionKey);
	headers["User-Agent"] = clientUserAgent(context.headers);
	const client = headerValue(context.headers, "x-opencode-client");
	if (client !== undefined) {
		headers["x-opencode-client"] = sanitizeHeaderValue(client);
	}
	const project = headerValue(context.headers, "x-opencode-project");
	if (project !== undefined) {
		headers["x-opencode-project"] = sanitizeHeaderValue(project);
	}
	if (route === "messages") {
		// Anthropic 兼容端点只接受 x-api-key，Bearer 由 chat/responses 使用。
		headers["x-api-key"] = context.credential;
		headers["anthropic-version"] = ANTHROPIC_VERSION;
		return headers;
	}
	return bearerHeaders(context.credential, headers);
}

/**
 * 计算 `x-opencode-session` 头。
 *
 * 桥接层已按旧插件同源规则算出会话键（显式会话头、请求体会话键或首条用户
 * 消息摘要），这里原样传给上游；没有会话线索时使用空输入摘要。
 * @param sessionKey - 桥接层会话键
 * @returns 会话头值
 */
function sessionHeaderValue(sessionKey: string): string {
	const sanitized = sanitizeHeaderValue(sessionKeyValue(sessionKey));
	return sanitized.length > 0 ? sanitized : stableDeviceId("");
}

/**
 * 选择下游客户端标识。
 * @param headers - 下游请求头
 * @returns 下游 User-Agent；缺失时使用默认标识
 */
function clientUserAgent(headers: Record<string, string>): string {
	const value = headerValue(headers, "user-agent");
	if (value === undefined) {
		return OPENCODE_USER_AGENT;
	}
	const sanitized = sanitizeHeaderValue(value);
	return sanitized.length > 0 ? sanitized : OPENCODE_USER_AGENT;
}

/**
 * Chat 路由的请求体修复：developer 角色改为 system，丢弃畸形的 thinking。
 * @param body - 已翻译的请求体
 * @param upstreamModel - 上游模型 ID
 * @returns 上游请求体
 */
function normalizeChatBody(body: Record<string, unknown>, upstreamModel: string): Record<string, unknown> {
	const next: Record<string, unknown> = { ...body, model: upstreamModel };
	const thinking = next["thinking"];
	if (thinking !== undefined && !isValidThinking(thinking)) {
		delete next["thinking"];
	}
	const messages = next["messages"];
	if (Array.isArray(messages)) {
		next["messages"] = messages.map((message) => {
			const record = asRecord(message);
			if (!record || record["role"] !== "developer") {
				return message;
			}
			return { ...record, role: "system" };
		});
	}
	return next;
}

/**
 * Messages 路由的请求体修复：补齐 `max_tokens`，合并历史 system 轮次。
 * @param body - 已翻译的请求体
 * @param upstreamModel - 上游模型 ID
 * @returns 上游请求体
 * @throws ApiError system 轮次内容不是文本时抛出
 */
function normalizeMessagesBody(body: Record<string, unknown>, upstreamModel: string): Record<string, unknown> {
	const next: Record<string, unknown> = { ...body, model: upstreamModel };
	const maxTokens = next["max_tokens"];
	if (typeof maxTokens !== "number" || !Number.isFinite(maxTokens) || maxTokens <= 0) {
		next["max_tokens"] = DEFAULT_CLAUDE_MAX_TOKENS;
	}
	const messages = next["messages"];
	if (Array.isArray(messages)) {
		const folded = foldSystemMessages(messages);
		if (folded.found) {
			next["messages"] = folded.messages;
			if (folded.folded.length > 0) {
				next["system"] = mergeSystemField(next["system"], folded.folded);
			}
		}
	}
	return next;
}

/**
 * 判断 thinking 字段是否有效：必须是带非空字符串 type 的对象。
 * @param value - thinking 字段
 * @returns 是否有效
 */
function isValidThinking(value: unknown): boolean {
	const record = asRecord(value);
	if (!record) {
		return false;
	}
	const type = record["type"];
	return typeof type === "string" && type.trim().length > 0;
}

/**
 * 把历史消息里的 system 轮次折叠出来。
 * @param messages - 历史消息
 * @returns 保留下来的消息、折叠文本与是否存在 system 轮次
 * @throws ApiError system 轮次内容不是文本时抛出
 */
function foldSystemMessages(messages: readonly unknown[]): {
	readonly messages: unknown[];
	readonly folded: string[];
	readonly found: boolean;
} {
	const kept: unknown[] = [];
	const folded: string[] = [];
	let found = false;
	for (const message of messages) {
		const record = asRecord(message);
		if (record && record["role"] === "system") {
			found = true;
			const text = systemTurnText(record["content"]);
			if (text.length > 0) {
				folded.push(text);
			}
			continue;
		}
		kept.push(message);
	}
	return { messages: kept, folded: folded, found: found };
}

/**
 * 把一个 system 轮次的内容压平成文本。
 * @param content - 消息内容
 * @returns 文本；空内容返回空串
 * @throws ApiError 内容包含图片或未知块类型时抛出
 */
function systemTurnText(content: unknown): string {
	if (content === undefined || content === null) {
		return "";
	}
	if (typeof content === "string") {
		return content;
	}
	if (!Array.isArray(content)) {
		throw ApiError.badRequest("system 消息内容必须是字符串或内容块数组");
	}
	let text = "";
	for (const rawBlock of content) {
		const block = asRecord(rawBlock);
		if (!block) {
			throw ApiError.badRequest("system 消息内容块格式无效");
		}
		const type = block["type"];
		if (type === "text") {
			if (text.length > 0) {
				text += "\n\n";
			}
			text += typeof block["text"] === "string" ? block["text"] : "";
			continue;
		}
		if (type === "image") {
			throw ApiError.badRequest("system 消息不支持图片内容");
		}
		if (type === "thinking" || type === "redacted_thinking") {
			continue;
		}
		throw ApiError.badRequest(`不支持的 system 内容块类型：${typeof type === "string" ? type : "unknown"}`);
	}
	return text;
}

/**
 * 把折叠出的 system 文本并入顶层 system 字段。
 * @param existing - 现有 system 字段
 * @param folded - 折叠出的文本
 * @returns 新的 system 字段
 * @throws ApiError 现有 system 字段格式无效时抛出
 */
function mergeSystemField(existing: unknown, folded: readonly string[]): unknown {
	const joined = folded.join("\n\n");
	if (existing === undefined || existing === null || existing === "") {
		return joined;
	}
	if (typeof existing === "string") {
		return existing.length > 0 ? `${existing}\n\n${joined}` : joined;
	}
	if (Array.isArray(existing)) {
		return [...existing, { type: "text", text: joined }];
	}
	throw ApiError.badRequest("system 字段格式无效");
}

/**
 * 断言对象。
 * @param value - 待判定值
 * @returns 对象记录；不是对象时为 undefined
 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}
