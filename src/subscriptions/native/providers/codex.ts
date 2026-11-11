/**
 * Codex 订阅 Provider 适配器。
 *
 * Codex 上游使用 ChatGPT 后端的 Responses API（`/backend-api/codex`），与 OpenAI
 * 公共 Responses API 的差异集中在请求头、持久化、托管工具与部分字段：
 * - 必须带 `ChatGPT-Account-Id` 与 Codex 客户端标识（Originator / User-Agent）；
 * - 一律 `store: false`，历史通过 `input` 回放，推理项用 `encrypted_content`；
 * - 内置 `image_generation` / `web_search` 工具由客户端声明，Codex 后端要求补齐；
 * - 图片接口既支持 Responses 托管工具，也支持直连 `/images/*` 端点，这里使用直连
 *   端点，避免把 SSE 图片事件交给只处理 JSON 的图片端点。
 */

import { createHash } from "node:crypto";
import { ApiError } from "../../../core/api/ApiError";
import type { CliProxyAccountQuota } from "../../../cliproxy/CliProxyTypes";
import { createCodexAuth } from "../auth/codex";
import { normalizeToolNames } from "../toolNames";
import { normalizeCodexEncryptedContent } from "../protocol/signatureCompatibility";
import { translateRequest } from "../protocol/types";
import { catalogForSource } from "../catalog/catalog";
import { quotaForAccount } from "../quota/quota";
import type {
	SubscriptionAccount,
	SubscriptionCatalogModel,
	SubscriptionOperation,
	SubscriptionProviderAdapter,
	SubscriptionQuotaSnapshot,
	SubscriptionRequestContext,
	SubscriptionUpstreamContext,
	SubscriptionUpstreamPlan,
	SubscriptionWireProtocol,
} from "../types";
import type { SubscriptionProviderDependencies } from "./types";
import { countCodexTokens } from "./codexTokens";
import { accountString, asBodyRecord, asNumber, asString, joinUrl, jsonPlan } from "./shared";

/** Codex 默认上游根地址。 */
export const CODEX_DEFAULT_BASE_URL = "https://chatgpt.com/backend-api/codex";

/** Codex 客户端 User-Agent；与 Go 执行器的默认值保持一致。 */
const CODEX_USER_AGENT = "codex-tui/0.154.0 (Mac OS 26.5.2; arm64) iTerm.app/3.6.11 (codex-tui; 0.154.0)";

/** Responses / compact / 图片请求的 Originator。 */
const CODEX_ORIGINATOR = "codex-tui";

/** Alpha Search 的 Originator。 */
const CODEX_SEARCH_ORIGINATOR = "codex_cli_rs";

/** Responses Lite 能力头。 */
const CODEX_RESPONSES_LITE_HEADER = "X-Openai-Internal-Codex-Responses-Lite";

/** Codex 直连图片端点支持的模型；与 Go registry 的内置图片模型一致。 */
const CODEX_IMAGE_MODELS: Readonly<Record<string, string>> = {
	"gpt-image-1.5": "GPT Image 1.5",
	"gpt-image-2": "GPT Image 2",
	"gpt-image-2.5-flare": "GPT Image 2.5 Flare",
	"gpt-image-2.5-sunburst": "GPT Image 2.5 Sunburst",
	"gpt-image-2.5": "GPT Image 2.5",
	"gpt-image-2.6-flare": "GPT Image 2.6 Flare",
	"gpt-image-2.6-sunburst": "GPT Image 2.6 Sunburst",
	"gpt-image-2.6": "GPT Image 2.6",
};

/** 适配器承接的操作。 */
const SUPPORTED_OPERATIONS: ReadonlySet<SubscriptionOperation> = new Set<SubscriptionOperation>([
	"chat",
	"messages",
	"responses",
	"compact",
	"images.generations",
	"images.edits",
	"alpha.search",
	"count_tokens",
]);

/** Responses 请求中 Codex 不接受、需要删除的字段。 */
const CODEX_DELETED_BODY_FIELDS: readonly string[] = [
	"max_completion_tokens",
	"max_tokens",
	"temperature",
	"top_p",
	"truncation",
	"prompt_cache_options",
	"prompt_cache_retention",
	"metadata",
	"user",
	"previous_response_id",
	"generate",
	"safety_identifier",
	"stream_options",
	"context_management",
];

/** 从客户端透传给 Codex 的请求头。 */
const FORWARDED_RESPONSE_HEADERS: ReadonlyArray<readonly [string, string]> = [
	["version", "Version"],
	["originator", "Originator"],
	["user-agent", "User-Agent"],
	["session-id", "Session-Id"],
	["thread-id", "Thread-Id"],
	["x-client-request-id", "X-Client-Request-Id"],
	["x-codex-window-id", "X-Codex-Window-Id"],
	["x-codex-turn-metadata", "X-Codex-Turn-Metadata"],
	["x-codex-turn-state", "X-Codex-Turn-State"],
	["x-codex-beta-features", "X-Codex-Beta-Features"],
	["x-openai-internal-codex-responses-lite", "X-Openai-Internal-Codex-Responses-Lite"],
	["openai-beta", "OpenAI-Beta"],
];

/** Alpha Search 透传的请求头；Go 实现使用 `Session_id` 而非 `Session-Id`。 */
const FORWARDED_SEARCH_HEADERS: ReadonlyArray<readonly [string, string]> = [
	["version", "Version"],
	["user-agent", "User-Agent"],
	["session_id", "Session_id"],
	["x-client-request-id", "X-Client-Request-Id"],
];

/** input 项类型到 Codex ID 前缀。 */
const INPUT_ID_PREFIXES: Readonly<Record<string, string>> = {
	message: "msg",
	reasoning: "rs",
	function_call: "fc",
	custom_tool_call: "ctc",
	custom_tool_call_output: "ctco",
	tool_search_call: "tsc",
};

/** Codex input 项 ID 长度上限。 */
const INPUT_ITEM_ID_LIMIT = 64;


/** Responses Lite 模型前缀。 */
const RESPONSES_LITE_MODEL_PREFIX = "gpt-6";

/**
 * Go registry `models/codex_client_models.json`（v8.0.57）中
 * `use_responses_lite: true` 的非 `gpt-6*` 模型。目录里的 gpt-5.6-* 与
 * codex-auto-review 均属于 Lite，行为与 gpt-6 系列一致。
 */
const RESPONSES_LITE_MODELS: ReadonlySet<string> = new Set<string>([
	"gpt-6.1-sol",
	"gpt-6-astra",
	"gpt-6-chat-thinking",
	"gpt-6.1-terra",
	"gpt-6-sol",
	"gpt-reserve",
	"gpt-6-luna",
	"gpt-5.6-sol",
	"gpt-5.6-terra",
	"gpt-5.6-luna",
	"codex-auto-review",
]);

/** 普通对象。 */
type Body = Record<string, unknown>;

/** 请求体特化选项。 */
interface CodexBodyOptions {
	/** 上游模型（已去 provider 前缀）。 */
	readonly model: string;
	/** 是否流式。 */
	readonly stream: boolean;
	/** 是否 Responses Lite。 */
	readonly lite: boolean;
	/** 是否免费套餐（不注入图片工具）。 */
	readonly freePlan: boolean;
}

/**
 * 创建 Codex 订阅 Provider 适配器。
 * @param dependencies - 账号仓库与可注入 fetch
 */
export function createCodexProvider(dependencies: SubscriptionProviderDependencies): SubscriptionProviderAdapter {
	const auth = createCodexAuth({ accounts: dependencies.accounts, fetch: dependencies.fetch });
	const fetchImpl = dependencies.fetch ?? fetch;

	/**
	 * 构造公共请求头。
	 * @param context - 上游上下文
	 * @param stream - 是否流式
	 * @param sessionId - 会话 ID
	 * @param originator - Originator 默认值
	 * @param forwarded - 从客户端透传的头
	 */
	const commonHeaders = (
		context: SubscriptionUpstreamContext,
		stream: boolean,
		sessionId: string | undefined,
		originator: string,
		forwarded: ReadonlyArray<readonly [string, string]>,
	): Record<string, string> => {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			Accept: stream ? "text/event-stream" : "application/json",
			Authorization: `Bearer ${context.credential}`,
			"Chatgpt-Account-Id": codexAccountId(context.account),
			Originator: originator,
			"User-Agent": CODEX_USER_AGENT,
			Connection: "Keep-Alive",
		};
		for (const [source, target] of forwarded) {
			const value = readHeader(context.headers, source);
			if (value) {
				headers[target] = value;
			}
		}
		// 缓存 ID 是最终会话标识，覆盖客户端透传的 Session-Id（与 Go 的 cacheHelper 一致）。
		if (sessionId) {
			headers["Session-Id"] = sessionId;
		}
		return headers;
	};

	/**
	 * 构造 `/responses` 计划。
	 * @param context - 上游上下文
	 */
	const responsesPlan = (context: SubscriptionUpstreamContext): SubscriptionUpstreamPlan => {
		const model = resolveCodexModel(context.model);
		const lite = isResponsesLite(context, model, context.upstreamBody);
		const sessionId = codexSessionId(context);
		const body = normalizeResponsesBody(
			context.upstreamBody,
			{
				model: model,
				stream: true,
				lite: lite,
				freePlan: isFreePlan(context.account),
			},
			sessionId,
		);
		const headers = commonHeaders(context, true, sessionId, CODEX_ORIGINATOR, FORWARDED_RESPONSE_HEADERS);
		const tier = asString(body["service_tier"]);
		headers["X-Codex-Routing-Hint"] = tier ? `model=${model};tier=${tier}` : `model=${model}`;
		// Codex 接受更长的工具名，但仍需清掉非法字符；上限与上游契约一致。
		const toolNames = normalizeToolNames(body, 128);
		return {
			...jsonPlan(joinUrl(codexBaseUrl(context.account), "/responses"), headers, body, model, true, "responses"),
			aggregateSse: !context.stream,
			...(toolNames === undefined ? {} : { toolNames: toolNames }),
		};
	};

	/**
	 * 构造 compact 请求；`/responses/compact` 返回 JSON，强制非流式。
	 * @param context - 上游上下文
	 */
	function compactPlan(context: SubscriptionUpstreamContext): SubscriptionUpstreamPlan {
		const model = resolveCodexModel(context.model);
		const sessionId = codexSessionId(context);
		const body = asBodyRecord(context.upstreamBody);
		body["model"] = model;
		body["store"] = false;
		delete body["stream"];
		normalizeInstructions(body);
		if (sessionId) {
			body["prompt_cache_key"] = sessionId;
		}
		const lite = isResponsesLite(context, model, body);
		const stripSearchHistory = lite && !hasWebSearchTool(Array.isArray(body["tools"]) ? body["tools"] : undefined);
		const summary = normalizeInput(body, stripSearchHistory);
		normalizeTools(body, {
			model: model,
			lite: lite,
			freePlan: true,
			hasWebSearchHistory: summary.hasWebSearch,
		});
		const headers = commonHeaders(context, false, sessionId, CODEX_ORIGINATOR, FORWARDED_RESPONSE_HEADERS);
		const tier = asString(body["service_tier"]);
		headers["X-Codex-Routing-Hint"] = tier ? `model=${model};tier=${tier}` : `model=${model}`;
		return jsonPlan(joinUrl(codexBaseUrl(context.account), "/responses/compact"), headers, body, model, false, "responses");
	}

	/**
	 * 构造 Alpha Search 请求；请求体保持客户端原样。
	 * @param context - 上游上下文
	 */
	function searchPlan(context: SubscriptionUpstreamContext): SubscriptionUpstreamPlan {
		const body = asBodyRecord(context.upstreamBody);
		const headers = commonHeaders(context, false, undefined, CODEX_SEARCH_ORIGINATOR, FORWARDED_SEARCH_HEADERS);
		return jsonPlan(
			joinUrl(codexBaseUrl(context.account), "/alpha/search"),
			headers,
			body,
			resolveCodexModel(context.model),
			false,
			"responses",
		);
	}

	/**
	 * 构造直连图片端点请求。
	 * @param context - 上游上下文
	 * @param kind - 生成或编辑
	 */
	async function imagePlan(context: SubscriptionUpstreamContext, kind: "generation" | "edit"): Promise<SubscriptionUpstreamPlan> {
		const model = directImageModel(context.model);
		if (!model) {
			throw ApiError.badRequest(
				`Codex 图片接口仅支持 ${Object.keys(CODEX_IMAGE_MODELS).join(" / ")}，收到 ${context.model || "(空模型)"}`,
			);
		}
		const body =
			kind === "edit" && isFormData(context.rawBody)
				? await imageEditFormBody(context.rawBody, model)
				: asBodyRecord(context.upstreamBody);
		body["model"] = model;
		delete body["stream"];
		const headers = commonHeaders(context, false, codexSessionId(context), CODEX_ORIGINATOR, FORWARDED_RESPONSE_HEADERS);
		// 直连图片端点不转发客户端 User-Agent，避免 Cloudflare 1010（Go 的 applyCodexDirectImageHeaders）。
		headers["User-Agent"] = CODEX_USER_AGENT;
		const path = kind === "edit" ? "/images/edits" : "/images/generations";
		return jsonPlan(joinUrl(codexBaseUrl(context.account), path), headers, body, model, false, "responses");
	}

	return {
		source: "codex",
		displayName: "Codex",
		auth: auth,
		/**
		 * 判断操作是否由 Codex 承接。
		 * @param operation - 端点操作
		 * @param model - 上游模型
		 */
		supports: (operation: SubscriptionOperation, model: string): boolean => {
			if (!SUPPORTED_OPERATIONS.has(operation)) {
				return false;
			}
			if (operation === "alpha.search") {
				return true;
			}
			return resolveCodexModel(model).length > 0;
		},
		/**
		 * Codex 的 chat / messages / responses / 图片 / compact / search 都使用 Responses 协议。
		 * @param _context - 请求上下文
		 */
		route: (_context: SubscriptionRequestContext): SubscriptionWireProtocol => {
			return "responses";
		},
		/**
		 * 去掉订阅 provider 前缀；Codex 模型 ID 与上游一致。
		 * @param model - 公开模型 ID
		 */
		resolveModel: (model: string): string => {
			return resolveCodexModel(model);
		},
		/**
		 * 构造 Codex 上游请求。
		 * @param context - 上游上下文
		 */
		build: async (context: SubscriptionUpstreamContext): Promise<SubscriptionUpstreamPlan> => {
			switch (context.operation) {
				case "chat":
				case "messages":
				case "responses":
					return responsesPlan(context);
				case "compact":
					return compactPlan(context);
				case "images.generations":
					return imagePlan(context, "generation");
				case "images.edits":
					return await imagePlan(context, "edit");
				case "alpha.search":
					return searchPlan(context);
				default:
					throw ApiError.badRequest(`Codex 不支持该操作：${context.operation}`);
			}
		},
		/**
		 * Codex 本地 token 计数：先翻译成 Responses，再用 tiktoken 编码。
		 * @param context - 请求上下文
		 */
		countTokens: async (context: SubscriptionRequestContext): Promise<number> => {
			const model = resolveCodexModel(context.model);
			// `/v1/messages/count_tokens` 的桥接操作没有独立入口协议，桥接层会把它标成
			// responses；这里按请求体形态识别 Anthropic Messages，避免把 messages 当成
			// 空 input 计成 0。
			const messagesBody =
				Array.isArray(context.body["messages"]) ||
				typeof context.body["system"] === "string" ||
				Array.isArray(context.body["system"]);
			const inbound = context.inbound === "responses" && messagesBody ? "messages" : context.inbound;
			const body =
				inbound === "responses"
					? context.body
					: translateRequest(inbound, "responses", context.body, {
							model: context.model,
							upstreamModel: model,
						});
			return countCodexTokens(body, model);
		},
		/**
		 * Codex 模型目录：静态目录 + 内置图片模型。
		 */
		catalog: async (): Promise<readonly SubscriptionCatalogModel[]> => {
			const models = new Map<string, SubscriptionCatalogModel>();
			for (const model of catalogForSource("codex")) {
				models.set(model.id, model);
			}
			for (const [id, displayName] of Object.entries(CODEX_IMAGE_MODELS)) {
				if (models.has(id)) {
					continue;
				}
				models.set(id, {
					id: id,
					upstreamId: id,
					displayName: displayName,
					protocol: "responses",
					metadata: { catalogKey: "codex-image", type: "image" },
				});
			}
			return [...models.values()];
		},
		/**
		 * 查询 Codex 额度并映射为订阅快照。
		 * @param account - 选中账号
		 */
		quota: async (account: SubscriptionAccount): Promise<SubscriptionQuotaSnapshot> => {
			try {
				const credential = await auth.ensureCredential(account);
				const quota = await quotaForAccount("codex", account, credential, fetchImpl);
				return mapCodexQuota(quota);
			} catch (error) {
				return {
					fetchedAt: new Date().toISOString(),
					error: error instanceof Error ? error.message : String(error),
				};
			}
		},
	};
}

/**
 * 读取 Codex 账号 ID。
 *
 * Codex 上游按 `ChatGPT-Account-Id` 归属请求；缺失时必须失败，不能把请求发到
 * 默认账号，否则会串用其他订阅账号的额度与数据。
 * @param account - 账号
 * @returns account id
 * @throws ApiError 账号缺少 account_id 时抛出
 */
function codexAccountId(account: SubscriptionAccount): string {
	const accountId = accountString(account, "account_id", "chatgpt_account_id", "chatgptAccountId");
	if (!accountId) {
		throw ApiError.unavailable("Codex 账号缺少 account_id，无法确定上游账号");
	}
	return accountId;
}

/**
 * 读取 Codex 上游根地址；允许账号级覆盖（私有部署或测试）。
 * @param account - 账号
 * @returns 规范化后的根地址
 * @throws ApiError base_url 不是合法 HTTP(S) 地址时抛出
 */
function codexBaseUrl(account: SubscriptionAccount): string {
	const base = accountString(account, "base_url", "baseUrl") ?? CODEX_DEFAULT_BASE_URL;
	try {
		const parsed = new URL(base);
		if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
			throw new Error("unsupported protocol");
		}
	} catch {
		throw ApiError.unavailable("Codex 账号 base_url 无效");
	}
	return base.replace(/\/+$/, "");
}

/**
 * 免费套餐不注入内置图片工具（Go 执行器同样跳过）。
 * @param account - 账号
 */
function isFreePlan(account: SubscriptionAccount): boolean {
	const plan = accountString(account, "plan_type", "planType", "plan");
	return plan?.toLowerCase() === "free";
}

/**
 * 去掉 Codex 订阅前缀并归一化模型 ID。
 * @param model - 公开模型 ID
 */
function resolveCodexModel(model: string): string {
	const trimmed = typeof model === "string" ? model.trim() : "";
	if (!trimmed) {
		return "";
	}
	const withoutProvider = trimmed.replace(/^codex-subscription\//i, "").replace(/^codex\//i, "");
	return withoutProvider.trim();
}

/**
 * 归一化上游模型 slug：去路径前缀并小写。
 * @param model - 模型 ID
 */
function modelSlug(model: string): string {
	const normalized = resolveCodexModel(model).toLowerCase();
	const slash = normalized.lastIndexOf("/");
	return slash >= 0 && slash < normalized.length - 1 ? normalized.slice(slash + 1).trim() : normalized;
}

/**
 * 是否为 Responses Lite 请求。
 * @param context - 上游上下文
 * @param model - 上游模型
 * @param body - 请求体
 */
function isResponsesLite(context: SubscriptionUpstreamContext, model: string, body: unknown): boolean {
	if (readHeader(context.headers, CODEX_RESPONSES_LITE_HEADER)?.toLowerCase() === "true") {
		return true;
	}
	const slug = modelSlug(model);
	if (slug.startsWith(RESPONSES_LITE_MODEL_PREFIX) || RESPONSES_LITE_MODELS.has(slug)) {
		return true;
	}
	const record = asRecord(body);
	const metadata = asRecord(record?.["client_metadata"]);
	const flag = metadata?.["ws_request_header_x_openai_internal_codex_responses_lite"];
	return flag === true || (typeof flag === "string" && flag.trim().toLowerCase() === "true");
}

/**
 * 计算会话 ID：优先请求体 `prompt_cache_key`（Go 端以缓存 ID 为准并在最后写回
 * `Session-Id`），其次客户端 `Session-Id`，再按会话亲和键派生 UUID。
 * @param context - 上游上下文
 */
function codexSessionId(context: SubscriptionUpstreamContext): string | undefined {
	const cacheKey = asString(context.body["prompt_cache_key"]);
	if (cacheKey) {
		return cacheKey;
	}
	const clientSession = readHeader(context.headers, "session-id");
	if (clientSession) {
		return clientSession;
	}
	return context.sessionKey ? sessionUuid(context.sessionKey) : undefined;
}

/**
 * 由稳定种子派生 UUID v5 形状的会话 ID。
 * @param seed - 会话亲和键
 */
function sessionUuid(seed: string): string {
	const hex = createHash("sha256").update(`litellm:codex:session:${seed}`).digest("hex");
	const variant = ((Number.parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(18, 20)}-${hex.slice(20, 32)}`;
}

/**
 * 构造 `/responses` 请求体。
 * @param source - 已翻译的请求体
 * @param options - 特化选项
 * @param sessionId - 会话 ID
 */
function normalizeResponsesBody(source: Body, options: CodexBodyOptions, sessionId: string | undefined): Body {
	const body = asBodyRecord(source);
	body["model"] = options.model;
	body["store"] = false;
	body["stream"] = options.stream;
	normalizeInstructions(body);
	if (asNumber(body["max_output_tokens"]) === undefined) {
		const maxTokens = asNumber(body["max_completion_tokens"]) ?? asNumber(body["max_tokens"]);
		if (maxTokens !== undefined) {
			body["max_output_tokens"] = maxTokens;
		}
	}
	for (const key of CODEX_DELETED_BODY_FIELDS) {
		delete body[key];
	}
	normalizeServiceTier(body);
	const stripSearchHistory = options.lite && !hasWebSearchTool(Array.isArray(body["tools"]) ? body["tools"] : undefined);
	const summary = normalizeInput(body, stripSearchHistory);
	const include = Array.isArray(body["include"]) ? body["include"] : [];
	const includeSources = include.includes("web_search_call.action.sources");
	body["include"] = includeSources ? ["reasoning.encrypted_content", "web_search_call.action.sources"] : ["reasoning.encrypted_content"];
	normalizeTools(body, {
		model: options.model,
		lite: options.lite,
		freePlan: options.freePlan,
		hasWebSearchHistory: summary.hasWebSearch,
	});
	if (sessionId) {
		body["prompt_cache_key"] = sessionId;
	}
	return body;
}

/**
 * 确保 `instructions` 是字符串；Codex 对缺失值要求空串。
 * @param body - 请求体
 */
function normalizeInstructions(body: Body): void {
	if (typeof body["instructions"] !== "string") {
		body["instructions"] = "";
	}
}

/**
 * 归一化 `service_tier`：priority / fast → priority，ultrafast 保留，其他删除。
 * @param body - 请求体
 */
function normalizeServiceTier(body: Body): void {
	const tier = asString(body["service_tier"])?.toLowerCase();
	if (tier === "priority" || tier === "fast") {
		body["service_tier"] = "priority";
	} else if (tier === "ultrafast") {
		body["service_tier"] = "ultrafast";
	} else {
		delete body["service_tier"];
	}
}

/**
 * 归一化 input：字符串转消息数组、清理缓存断点、修角色/参数/ID。
 * @param body - 请求体
 * @param stripSearchHistory - 是否移除 web_search_call 历史（仅 Lite 且未声明 web_search 工具）
 * @returns 是否包含 web_search_call 历史
 */
function normalizeInput(body: Body, stripSearchHistory: boolean): { readonly hasWebSearch: boolean } {
	const input = body["input"];
	if (typeof input === "string") {
		body["input"] = [
			{
				type: "message",
				role: "user",
				content: [{ type: "input_text", text: input }],
			},
		];
		return { hasWebSearch: false };
	}
	if (!Array.isArray(input)) {
		return { hasWebSearch: false };
	}
	let hasWebSearch = false;
	const items: unknown[] = [];
	for (const item of input) {
		const record = asRecord(item);
		if (!record) {
			items.push(item);
			continue;
		}
		if (record["type"] === "web_search_call") {
			hasWebSearch = true;
			if (stripSearchHistory) {
				continue;
			}
		}
		const cleaned = normalizeInputItem(record);
		if (cleaned) {
			items.push(cleaned);
		}
	}
	body["input"] = items;
	return { hasWebSearch: stripSearchHistory ? false : hasWebSearch };
}

/**
 * 归一化单个 input 项；返回 undefined 表示需要丢弃。
 * @param source - 原始项
 */
function normalizeInputItem(source: Body): Body | undefined {
	const item: Body = { ...source };
	delete item["prompt_cache_breakpoint"];
	if (item["type"] === "reasoning" || item["type"] === "compaction") {
		const encrypted = asString(item["encrypted_content"]);
		if (encrypted !== undefined) {
			const normalized = normalizeCodexEncryptedContent(encrypted);
			if (normalized === undefined) {
				return undefined;
			}
			if (normalized !== encrypted) {
				item["encrypted_content"] = normalized;
			}
		}
	}
	if (item["role"] === "system") {
		item["role"] = "developer";
	}
	if (item["type"] === "function_call" && typeof item["arguments"] === "string" && item["arguments"].trim() === "") {
		item["arguments"] = "{}";
	}
	for (const key of ["content", "output"] as const) {
		const parts = item[key];
		if (Array.isArray(parts)) {
			item[key] = parts.map((part) => {
				const value = asRecord(part);
				if (!value || !("prompt_cache_breakpoint" in value)) {
					return part;
				}
				const cleaned: Body = { ...value };
				delete cleaned["prompt_cache_breakpoint"];
				return cleaned;
			});
		}
	}
	const id = item["id"];
	if (typeof id === "string" && id.length > 0) {
		if (item["type"] === "reasoning" && id.length > INPUT_ITEM_ID_LIMIT && asString(item["encrypted_content"])) {
			return undefined;
		}
		const normalizedId = normalizeInputItemId(typeof item["type"] === "string" ? item["type"] : "", id);
		if (normalizedId !== id) {
			item["id"] = normalizedId;
		}
	}
	return item;
}

/**
 * 按 Codex 规则修复 input 项 ID 前缀、字符与长度。
 * @param type - 项类型
 * @param id - 原始 ID
 */
function normalizeInputItemId(type: string, id: string): string {
	const prefix = INPUT_ID_PREFIXES[type];
	if (!prefix) {
		return id;
	}
	let normalized = id;
	if (type === "tool_search_call" && id.startsWith("ts_")) {
		normalized = `tsc_${id.slice(3)}`;
	} else if (!id.startsWith(prefix)) {
		normalized = `${prefix}_${id}`;
	}
	if (normalized.length > INPUT_ITEM_ID_LIMIT) {
		const suffix = `_${createHash("sha256").update(normalized).digest("hex").slice(0, 16)}`;
		normalized = `${sanitizeIdChars(normalized.slice(0, INPUT_ITEM_ID_LIMIT - suffix.length))}${suffix}`;
	}
	return sanitizeIdChars(normalized);
}

/**
 * 只保留 Codex 接受的 ID 字符。
 * @param id - ID
 */
function sanitizeIdChars(id: string): string {
	return id.replace(/[^A-Za-z0-9_-]/g, "_");
}

/**
 * 归一化工具声明、补齐 web_search 与 image_generation 托管工具。
 * @param body - 请求体
 * @param options - 工具选项
 */
function normalizeTools(
	body: Body,
	options: {
		readonly model: string;
		readonly lite: boolean;
		readonly freePlan: boolean;
		readonly hasWebSearchHistory: boolean;
	},
): void {
	const toolsValue = body["tools"];
	const tools = Array.isArray(toolsValue) ? toolsValue.map((tool) => normalizeToolAlias(tool)) : undefined;
	if (tools) {
		body["tools"] = tools;
	}
	if (options.hasWebSearchHistory && !hasWebSearchTool(tools)) {
		if (options.lite) {
			// Lite 请求不声明顶层托管工具，历史里的 web_search_call 已在 input 清理时移除。
		} else if (tools) {
			tools.push({ type: "web_search" });
		} else {
			body["tools"] = [{ type: "web_search" }];
		}
	}
	const currentTools = Array.isArray(body["tools"]) ? body["tools"] : undefined;
	if (!options.lite && !options.freePlan && !modelSlug(options.model).endsWith("spark")) {
		if (!currentTools || currentTools.length === 0) {
			body["tools"] = [{ type: "image_generation", output_format: "png" }];
		} else if (!currentTools.some(isImageGenerationTool)) {
			currentTools.push({ type: "image_generation", output_format: "png" });
		}
	}
	stripImageToolComplexity(body);
	normalizeToolChoice(body);
	const finalTools = body["tools"];
	if (!Array.isArray(finalTools) || finalTools.length === 0) {
		delete body["tools"];
		if (options.lite) {
			// Go 对 Lite 请求无条件写 false（即使没有工具），标准请求则在无工具时删除。
			body["parallel_tool_calls"] = false;
		} else {
			delete body["parallel_tool_calls"];
		}
		return;
	}
	if (options.lite) {
		body["parallel_tool_calls"] = false;
	} else if (body["parallel_tool_calls"] !== false) {
		body["parallel_tool_calls"] = true;
	}
}

/**
 * 归一化内置工具别名。
 * @param source - 工具声明
 */
function normalizeToolAlias(source: unknown): unknown {
	const tool = asRecord(source);
	if (!tool) {
		return source;
	}
	const copy: Body = { ...tool };
	const type = copy["type"];
	if (type === "web_search_preview" || type === "web_search_preview_2025_03_11") {
		copy["type"] = "web_search";
	}
	if (Array.isArray(copy["tools"])) {
		copy["tools"] = copy["tools"].map((nested) => normalizeToolAlias(nested));
	}
	return copy;
}

/**
 * 判断是否已有 web_search 托管工具。
 * @param tools - 工具数组
 */
function hasWebSearchTool(tools: readonly unknown[] | undefined): boolean {
	if (!tools) {
		return false;
	}
	return tools.some((tool) => {
		const type = asRecord(tool)?.["type"];
		return type === "web_search" || type === "web_search_preview" || type === "web_search_preview_2025_03_11";
	});
}

/**
 * 判断是否为图片生成工具（托管工具、`image_gen.imagegen` 函数或命名空间）。
 * @param source - 工具声明
 */
function isImageGenerationTool(source: unknown): boolean {
	const tool = asRecord(source);
	if (!tool) {
		return false;
	}
	if (tool["type"] === "image_generation") {
		return true;
	}
	if (tool["type"] === "function" && tool["name"] === "image_gen.imagegen") {
		return true;
	}
	if (tool["type"] === "namespace" && tool["name"] === "image_gen" && Array.isArray(tool["tools"])) {
		return tool["tools"].some((nested) => {
			const value = asRecord(nested);
			return value?.["type"] === "function" && value["name"] === "imagegen";
		});
	}
	return false;
}

/**
 * 删除托管图片工具不接受的 `complexity` 参数。
 * @param body - 请求体
 */
function stripImageToolComplexity(body: Body): void {
	stripComplexityAt(body, "tools");
	if (!Array.isArray(body["input"])) {
		return;
	}
	for (const item of body["input"]) {
		const record = asRecord(item);
		if (record?.["type"] !== "additional_tools") {
			continue;
		}
		stripComplexityAt(record, "tools");
	}
}

/**
 * 删除某个工具数组里 image_generation 的 complexity。
 * @param owner - 持有 tools 的对象
 * @param key - tools 字段名
 */
function stripComplexityAt(owner: Body, key: string): void {
	const tools = owner[key];
	if (!Array.isArray(tools)) {
		return;
	}
	owner[key] = tools.map((tool) => {
		const record = asRecord(tool);
		if (!record || record["type"] !== "image_generation" || !("complexity" in record)) {
			return tool;
		}
		const copy: Body = { ...record };
		delete copy["complexity"];
		return copy;
	});
}

/**
 * 归一化 `tool_choice` 中的内置工具别名与嵌套工具。
 * @param body - 请求体
 */
function normalizeToolChoice(body: Body): void {
	const choice = body["tool_choice"];
	if (!choice || typeof choice !== "object" || Array.isArray(choice)) {
		return;
	}
	const record: Body = { ...(choice as Body) };
	if (record["type"] === "web_search_preview" || record["type"] === "web_search_preview_2025_03_11") {
		record["type"] = "web_search";
	}
	if (Array.isArray(record["tools"])) {
		record["tools"] = record["tools"].map((tool) => normalizeToolAlias(tool));
	}
	body["tool_choice"] = record;
}

/**
 * 把 multipart 图片编辑请求转换为 Codex 直连端点接受的 JSON。
 * @param form - 客户端 FormData
 * @param model - 直连图片模型
 * @returns Codex 图片编辑 JSON 请求体
 * @throws ApiError 缺少源图或 prompt 时抛出
 */
async function imageEditFormBody(form: FormData, model: string): Promise<Body> {
	const body: Body = { model: model };
	const images: Array<{ image_url: string }> = [];
	for (const [key, value] of form.entries()) {
		if (typeof value === "string") {
			setImageEditFormValue(body, key, value);
			continue;
		}
		const dataUrl = await blobDataUrl(value);
		if (key === "image" || key === "image[]") {
			images.push({ image_url: dataUrl });
		} else if (key === "mask") {
			body["mask"] = { image_url: dataUrl };
		}
	}
	if (images.length === 0) {
		throw ApiError.badRequest("Codex 图片编辑缺少源图");
	}
	body["images"] = images;
	if (typeof body["prompt"] !== "string") {
		throw ApiError.badRequest("Codex 图片编辑缺少 prompt");
	}
	return body;
}

/**
 * 写入一个表单字段；数字字段按 Codex 规则转数字，mask 字段转嵌套路径。
 * @param body - 目标 JSON
 * @param key - 表单键
 * @param value - 表单值
 */
function setImageEditFormValue(body: Body, key: string, value: string): void {
	if (key === "mask[file_id]") {
		body["mask"] = { ...(asRecord(body["mask"]) ?? {}), file_id: value };
		return;
	}
	if (key === "mask[image_url]") {
		body["mask"] = { ...(asRecord(body["mask"]) ?? {}), image_url: value };
		return;
	}
	if (key === "n" || key === "output_compression" || key === "partial_images") {
		const parsed = Number(value);
		body[key] = Number.isInteger(parsed) ? parsed : value;
		return;
	}
	body[key] = value;
}

/**
 * 读取 Blob 并构造 data URL。
 * @param blob - 文件内容
 */
async function blobDataUrl(blob: Blob): Promise<string> {
	const buffer = Buffer.from(await blob.arrayBuffer());
	const type = blob.type || "application/octet-stream";
	return `data:${type};base64,${buffer.toString("base64")}`;
}

/**
 * 从模型 ID 解析直连图片模型。
 * @param model - 模型 ID
 */
function directImageModel(model: string): string | undefined {
	const slug = modelSlug(model);
	return Object.prototype.hasOwnProperty.call(CODEX_IMAGE_MODELS, slug) ? slug : undefined;
}

/**
 * 是否为 FormData。
 * @param value - 原始请求体
 */
function isFormData(value: unknown): value is FormData {
	return typeof FormData !== "undefined" && value instanceof FormData;
}

/**
 * 以大小写不敏感方式读取请求头。
 * @param headers - 请求头
 * @param name - 头名称
 */
function readHeader(headers: Readonly<Record<string, string>>, name: string): string | undefined {
	const target = name.toLowerCase();
	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() === target && typeof value === "string" && value.trim()) {
			return value.trim();
		}
	}
	return undefined;
}

/**
 * 普通对象判断。
 * @param value - 未知值
 */
function asRecord(value: unknown): Body | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Body) : undefined;
}

/**
 * 把 Codex 额度映射为订阅额度快照。
 * @param quota - CLIProxy 归一化后的额度
 */
function mapCodexQuota(quota: CliProxyAccountQuota): SubscriptionQuotaSnapshot {
	const balances: Record<string, number> = {};
	for (const balance of quota.balances) {
		balances[balance.label] = Math.max(0, balance.limit - balance.used);
	}
	const windows = quota.windows.map((window) => ({
		name: window.label || window.id,
		...(window.remaining_percent === null ? {} : { remainingFraction: Math.min(1, Math.max(0, window.remaining_percent / 100)) }),
		...(window.resets_at ? { resetTime: window.resets_at } : {}),
		raw: {
			id: window.id,
			label: window.label,
			used_percent: window.used_percent,
			remaining_percent: window.remaining_percent,
			resets_at: window.resets_at,
		},
	}));
	return {
		...(quota.plan ? { plan: quota.plan } : {}),
		...(quota.subscription_expires_at ? { expiresAt: quota.subscription_expires_at } : {}),
		...(Object.keys(balances).length > 0 ? { balances: balances } : {}),
		...(windows.length > 0 ? { windows: windows } : {}),
		fetchedAt: quota.fetched_at,
	};
}
