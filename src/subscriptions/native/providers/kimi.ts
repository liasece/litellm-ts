/**
 * Kimi（Moonshot AI）订阅 Provider 适配器。
 *
 * Kimi Code 的上游按入口协议提供三条腿：Messages 走 Anthropic 兼容的
 * `/v1/messages?beta=true`，Chat 走 `/v1/chat/completions`，Responses 走
 * `/v1/responses`。鉴权使用 Kimi OAuth access token 与 `X-Msh-*` 客户端头；
 * Messages 腿沿用 Claude 的请求特化（max_tokens、工具/消息归一化），但不注入
 * Claude Code 的 billing/CCH 归因块，避免 Kimi 把归因当提示词。
 */

import { hostname } from "node:os";
import { ApiError } from "../../../core/api/ApiError";
import { createKimiAuth } from "../auth/kimi";
import { catalogForSource } from "../catalog/catalog";
import type {
	SubscriptionAccount,
	SubscriptionCatalogModel,
	SubscriptionOperation,
	SubscriptionProviderAdapter,
	SubscriptionQuotaSnapshot,
	SubscriptionQuotaWindow,
	SubscriptionRequestContext,
	SubscriptionUpstreamContext,
	SubscriptionUpstreamPlan,
	SubscriptionWireProtocol,
} from "../types";
import type { SubscriptionProviderDependencies } from "./types";
import { prepareClaudeCountTokensBody, prepareClaudeMessagesBody } from "./claudeRequest";
import { stableDeviceId } from "../session";
import { normalizeToolNames } from "../toolNames";
import { accountString, asBodyRecord, asNumber, asString, bearerHeaders, joinUrl, jsonPlan } from "./shared";

/** kimi.com 的 Coding API 根地址。 */
export const KIMI_COM_BASE_URL = "https://api.kimi.com/coding";
/** kimi.ai 的 Coding API 根地址。 */
export const KIMI_AI_BASE_URL = "https://api.kimi.ai/coding";
/** 参考客户端版本；与 Go 运行时的 Kimi 客户端头一致。 */
const KIMI_CLIENT_VERSION = "8.0.57";
/** 默认 max_tokens；Kimi 的 Claude 兼容端点要求该字段。 */
const KIMI_DEFAULT_MAX_TOKENS = 32000;

/** Kimi 适配器承接的操作。 */
const SUPPORTED_OPERATIONS: ReadonlySet<SubscriptionOperation> = new Set<SubscriptionOperation>([
	"chat",
	"messages",
	"responses",
	"count_tokens",
]);

/**
 * 解析账号的 Kimi API 根地址。
 * @param account - 账号
 */
export function resolveKimiBaseUrl(account: SubscriptionAccount): string {
	const configured = accountString(account, "base_url", "baseUrl");
	if (configured) {
		return configured.replace(/\/+$/, "");
	}
	const domain = (accountString(account, "domain", "type") ?? "").toLowerCase();
	return domain.includes("kimi.ai") ? KIMI_AI_BASE_URL : KIMI_COM_BASE_URL;
}

/**
 * 去掉 `/v1` 尾缀，得到 Messages 腿的根地址。
 * @param baseUrl - API 根地址
 */
function kimiMessagesBase(baseUrl: string): string {
	return baseUrl.replace(/\/v1$/i, "");
}

/**
 * 构造 Messages 端点。
 * @param baseUrl - API 根地址
 * @param countTokens - 是否 count_tokens
 */
function kimiMessagesUrl(baseUrl: string, countTokens: boolean): string {
	const root = kimiMessagesBase(baseUrl);
	return `${root}/v1/messages${countTokens ? "/count_tokens" : ""}?beta=true`;
}

/**
 * 保证 base URL 带 `/v1`。
 * @param baseUrl - API 根地址
 */
function kimiApiV1(baseUrl: string): string {
	const root = baseUrl.replace(/\/+$/, "");
	return /\/v1$/i.test(root) ? root : `${root}/v1`;
}

/**
 * 构造 Chat Completions 端点。
 * @param baseUrl - API 根地址
 */
function kimiChatUrl(baseUrl: string): string {
	return joinUrl(kimiApiV1(baseUrl), "/chat/completions");
}

/**
 * 构造 Responses 端点。
 * @param baseUrl - API 根地址
 */
function kimiResponsesUrl(baseUrl: string): string {
	return joinUrl(kimiApiV1(baseUrl), "/responses");
}

/**
 * 归一化 Kimi 公开模型 ID 为上游 ID。
 * @param model - 公开模型
 */
export function resolveKimiModel(model: string): string {
	let value = model.trim();
	const slash = value.lastIndexOf("/");
	if (slash >= 0) {
		value = value.slice(slash + 1);
	}
	const suffixMatch = /\(([^()]*)\)\s*$/.exec(value);
	const suffix = suffixMatch?.[1];
	let base = (suffixMatch ? value.slice(0, suffixMatch.index) : value).trim().toLowerCase();
	if (base.endsWith("[1m]")) {
		base = base.slice(0, -4);
	}
	let normalized: string;
	switch (base) {
		case "kimi-k2.8":
		case "k2.8":
		case "kimi-k2.8-code":
		case "k2.8-code":
		case "kimi-k2.8-preview":
		case "k2.8-preview":
		case "kimi-k2.7-code":
		case "k2.7-code":
		case "kimi-for-coding":
		case "for-coding":
			normalized = "kimi-for-coding";
			break;
		case "kimi-k2.7-code-highspeed":
		case "k2.7-code-highspeed":
		case "kimi-for-coding-highspeed":
		case "for-coding-highspeed":
			normalized = "kimi-for-coding-highspeed";
			break;
		default:
			normalized = base.startsWith("kimi-") ? base.slice(5) : base;
	}
	return suffix ? `${normalized}(${suffix})` : normalized;
}

/**
 * Kimi 客户端身份头。
 * @param account - 账号
 * @param credential - access token
 */
function kimiHeaders(account: SubscriptionAccount, credential: string): Record<string, string> {
	const deviceId = accountString(account, "device_id", "deviceId") ?? stableDeviceId(`kimi-device\u0000${account.id}`);
	const platform = process.platform === "darwin" ? "macOS" : process.platform === "win32" ? "Windows" : "Linux";
	const arch = process.arch === "x64" ? "amd64" : process.arch === "ia32" ? "386" : process.arch;
	return bearerHeaders(credential, {
		"Content-Type": "application/json",
		"User-Agent": `CLIProxyAPI/${KIMI_CLIENT_VERSION}`,
		"X-Msh-Platform": "CLIProxyAPI",
		"X-Msh-Version": KIMI_CLIENT_VERSION,
		"X-Msh-Device-Name": hostname(),
		"X-Msh-Device-Model": `${platform} ${arch}`,
		"X-Msh-Device-Id": deviceId,
	});
}

/**
 * 读取调用方传入的 anthropic-beta；Kimi 只接受调用方自己的 beta 值。
 * @param headers - 请求头
 */
function callerBetas(headers: Readonly<Record<string, string>>): string | undefined {
	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() === "anthropic-beta" && value.trim()) {
			return value.trim();
		}
	}
	return undefined;
}

/**
 * 补齐 Kimi 工具消息的 `tool_call_id`：优先使用 `call_id`，否则从最近一条
 * assistant 的单个 tool_calls 推断。
 * @param body - 请求体
 */
export function normalizeKimiToolLinks(body: Record<string, unknown>): void {
	const messages = body["messages"];
	if (!Array.isArray(messages)) {
		return;
	}
	let lastCallIds: string[] = [];
	for (const raw of messages) {
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
			continue;
		}
		const message = raw as Record<string, unknown>;
		const role = asString(message["role"]);
		if (role === "assistant") {
			const calls = message["tool_calls"];
			lastCallIds = Array.isArray(calls)
				? calls.flatMap((call) => {
						if (!call || typeof call !== "object") {
							return [];
						}
						const id = asString((call as Record<string, unknown>)["id"]);
						return id ? [id] : [];
					})
				: [];
			continue;
		}
		if (role !== "tool" && role !== "function") {
			continue;
		}
		if (asString(message["tool_call_id"])) {
			continue;
		}
		const explicit = asString(message["call_id"]);
		if (explicit) {
			message["tool_call_id"] = explicit;
			continue;
		}
		if (lastCallIds.length === 1) {
			message["tool_call_id"] = lastCallIds[0];
		}
	}
}

/**
 * 创建 Kimi 订阅 Provider。
 * @param dependencies - 账号仓库与可注入 fetch
 */
export function createKimiProvider(dependencies: SubscriptionProviderDependencies): SubscriptionProviderAdapter {
	const auth = createKimiAuth({ accounts: dependencies.accounts, ...(dependencies.fetch ? { fetch: dependencies.fetch } : {}) });
	const fetchImpl = dependencies.fetch ?? fetch;

	/**
	 * 构造 Messages 腿计划。
	 * @param context - 上游上下文
	 * @param countTokens - 是否 count_tokens
	 */
	function messagesPlan(context: SubscriptionUpstreamContext, countTokens: boolean): SubscriptionUpstreamPlan {
		const model = resolveKimiModel(context.model);
		const baseUrl = resolveKimiBaseUrl(context.account);
		const body = countTokens
			? prepareClaudeCountTokensBody({
					body: asBodyRecord(context.upstreamBody),
					context: context,
					account: context.account,
					model: model,
					settings: { cloaking: false, maxTokens: () => KIMI_DEFAULT_MAX_TOKENS },
				})
			: prepareClaudeMessagesBody({
					body: asBodyRecord(context.upstreamBody),
					context: context,
					account: context.account,
					model: model,
					settings: { cloaking: false, maxTokens: () => KIMI_DEFAULT_MAX_TOKENS },
				}).body;
		normalizeKimiToolLinks(body);
		body["model"] = model;
		if (countTokens) {
			delete body["max_tokens"];
			delete body["stream"];
		} else if (typeof body["max_tokens"] !== "number") {
			body["max_tokens"] = KIMI_DEFAULT_MAX_TOKENS;
		}
		const headers = kimiHeaders(context.account, context.credential);
		headers["anthropic-version"] = "2023-06-01";
		const beta = callerBetas(context.headers);
		if (beta) {
			headers["anthropic-beta"] = beta;
		}
		const toolNames = normalizeToolNames(body);
		const plan = jsonPlan(
			kimiMessagesUrl(baseUrl, countTokens),
			headers,
			body,
			model,
			countTokens ? false : context.stream,
			// count 端点按入口协议原样回传计数对象，不能把 responses 入口的
			// `{input_tokens}` 再按 Responses 语义翻译。
			countTokens ? context.inbound : "messages",
		);
		return toolNames === undefined ? plan : { ...plan, toolNames: toolNames };
	}

	/**
	 * 构造 Chat 腿计划。
	 * @param context - 上游上下文
	 */
	function chatPlan(context: SubscriptionUpstreamContext): SubscriptionUpstreamPlan {
		const model = resolveKimiModel(context.model);
		const body = asBodyRecord(context.upstreamBody);
		body["model"] = model;
		normalizeKimiToolLinks(body);
		const toolNames = normalizeToolNames(body);
		const plan = jsonPlan(
			kimiChatUrl(resolveKimiBaseUrl(context.account)),
			kimiHeaders(context.account, context.credential),
			body,
			model,
			context.stream,
			"chat",
		);
		return toolNames === undefined ? plan : { ...plan, toolNames: toolNames };
	}

	/**
	 * 构造 Responses 腿计划。
	 * @param context - 上游上下文
	 */
	function responsesPlan(context: SubscriptionUpstreamContext): SubscriptionUpstreamPlan {
		const model = resolveKimiModel(context.model);
		const body = asBodyRecord(context.upstreamBody);
		body["model"] = model;
		const toolNames = normalizeToolNames(body);
		const plan = jsonPlan(
			kimiResponsesUrl(resolveKimiBaseUrl(context.account)),
			kimiHeaders(context.account, context.credential),
			body,
			model,
			context.stream,
			"responses",
		);
		return toolNames === undefined ? plan : { ...plan, toolNames: toolNames };
	}

	/**
	 * 读取额度窗口剩余比例。
	 * @param value - 上游窗口
	 * @param fallbackLabel - 默认名称
	 */
	function quotaWindow(value: unknown, fallbackLabel: string): SubscriptionQuotaWindow | null {
		if (!value || typeof value !== "object" || Array.isArray(value)) {
			return null;
		}
		const outer = value as Record<string, unknown>;
		const detail =
			outer["detail"] && typeof outer["detail"] === "object" && !Array.isArray(outer["detail"])
				? (outer["detail"] as Record<string, unknown>)
				: outer;
		const used = asNumber(detail["used"]);
		const limit = asNumber(detail["limit"]);
		const remaining = asNumber(detail["remaining"]);
		let remainingFraction: number | undefined;
		if (used !== undefined && limit !== undefined && limit > 0) {
			remainingFraction = Math.max(0, Math.min(1, 1 - used / limit));
		} else if (remaining !== undefined && limit !== undefined && limit > 0) {
			remainingFraction = Math.max(0, Math.min(1, remaining / limit));
		}
		const name = asString(detail["name"] ?? detail["title"] ?? outer["name"] ?? outer["title"]) ?? fallbackLabel;
		const raw = { ...outer, ...detail };
		const reset = asString(raw["resets_at"] ?? raw["reset_at"] ?? raw["resetTime"]);
		return {
			name: name,
			...(remainingFraction === undefined ? {} : { remainingFraction: remainingFraction }),
			...(reset ? { resetTime: reset } : {}),
			raw: raw,
		};
	}

	return {
		source: "kimi",
		displayName: "Kimi",
		auth: auth,
		/**
		 * 判断操作是否由 Kimi 承接。
		 * @param operation - 端点操作
		 * @param model - 上游模型
		 */
		supports: (operation: SubscriptionOperation, model: string): boolean => {
			return SUPPORTED_OPERATIONS.has(operation) && resolveKimiModel(model).length > 0;
		},
		/**
		 * Kimi 三条腿分别对应入口协议；count_tokens 走 Messages。
		 * @param context - 请求上下文
		 */
		route: (context: SubscriptionRequestContext): SubscriptionWireProtocol => {
			return context.operation === "count_tokens" ? "messages" : context.inbound;
		},
		/**
		 * 归一化模型 ID。
		 * @param model - 公开模型
		 */
		resolveModel: (model: string): string => {
			return resolveKimiModel(model);
		},
		/**
		 * 构造上游请求。
		 * @param context - 上游上下文
		 */
		build: async (context: SubscriptionUpstreamContext): Promise<SubscriptionUpstreamPlan> => {
			switch (context.operation) {
				case "count_tokens":
					return messagesPlan(context, true);
				case "messages":
					return messagesPlan(context, false);
				case "chat":
					return chatPlan(context);
				case "responses":
					return responsesPlan(context);
				default:
					throw ApiError.badRequest(`Kimi 不支持该操作：${context.operation}`);
			}
		},
		/**
		 * Kimi 模型目录：使用静态目录。
		 */
		catalog: async (): Promise<readonly SubscriptionCatalogModel[]> => {
			return catalogForSource("kimi");
		},
		/**
		 * 查询 Kimi 账户额度。
		 * @param account - 账号
		 */
		quota: async (account: SubscriptionAccount): Promise<SubscriptionQuotaSnapshot> => {
			const credential = await auth.ensureCredential(account);
			const baseUrl = resolveKimiBaseUrl(account);
			const response = await fetchImpl(`${kimiApiV1(baseUrl)}/usages`, {
				method: "GET",
				headers: kimiHeaders(account, credential),
			});
			if (!response.ok) {
				throw ApiError.unavailable(`Kimi 额度查询失败（HTTP ${response.status}）`);
			}
			const payload = (await response.json()) as unknown;
			if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
				throw ApiError.unavailable("Kimi 额度响应不是 JSON 对象");
			}
			const record = payload as Record<string, unknown>;
			const windows: SubscriptionQuotaWindow[] = [];
			const limits = record["limits"];
			if (Array.isArray(limits)) {
				limits.forEach((value, index) => {
					const window = quotaWindow(value, `限额 ${index + 1}`);
					if (window) {
						windows.push(window);
					}
				});
			}
			const summary = quotaWindow(record["usage"], "周限额");
			if (summary) {
				windows.push(summary);
			}
			return { fetchedAt: new Date().toISOString(), windows: windows };
		},
	};
}
