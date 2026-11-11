/**
 * Claude 订阅 Provider 适配器。
 *
 * 上游是 Anthropic 官方 Messages API（`/v1/messages`），因此 chat / responses
 * 入口都先由桥接层翻译成 Messages，再交给本适配器做 Claude 专属特化：
 *
 * - 端点：`/v1/messages?beta=true` 与 `/v1/messages/count_tokens?beta=true`；
 * - 凭据：OAuth access token 以 `Authorization: Bearer` 发送，并按 Go 执行器
 *   补齐 Claude Code 的客户端指纹头与 `anthropic-beta` 列表；
 * - 请求体：clamping `max_tokens`、system 重定位与 Cloaking、thinking 与采样参数
 *   约束、cache_control 断点、工具块归一化；
 * - 计费头：`x-anthropic-billing-header` 的 CCH 签名，签名字节通过 raw body
 *   直接发送，保证签名与线上字节一致；
 * - 压缩：把 Responses compact 请求转成 Messages 摘要请求，并把摘要封装成
 *   `response.compaction` 的加密胶囊。
 *
 * 与 Go 实现的差异：
 * - uTLS/HTTP2 指纹无法在纯 Node 中复刻，这里保留全部协议字段并提供
 *   `settings.cchHook` 允许部署侧替换 CCH 计算；传输层仍使用 Node fetch。
 * - Go 支持把 compact 的流式结果合成为 SSE 分块；本适配器只返回非流式 JSON，
 *   因为桥接层的流式包装只处理上游本身就是 SSE 的响应。
 * - 敏感词混淆、当前日期 reminder、传入的 fallbacks 等纯 Cloaking 装饰未移植；
 *   调用方显式给出的 betas 与字段仍原样透传。
 */

import { ApiError } from "../../../core/api/ApiError";
import type { CliProxyAccountQuota } from "../../../cliproxy/CliProxyTypes";
import { createClaudeAuth } from "../auth/claude";
import { sanitizeClaudeMessagesSignatures } from "../protocol/signatureTargets";
import { normalizeToolNames } from "../toolNames";
import { catalogForSource } from "../catalog/catalog";
import { quotaForAccount } from "../quota/quota";
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
import { asBodyRecord } from "./shared";
import {
	buildClaudeCompactionRequest,
	buildClaudeCompactionResponse,
	claudeMessagesEndpoint,
	claudeRequestHeaders,
	prepareClaudeCountTokensBody,
	prepareClaudeMessagesBody,
	resolveClaudeBaseUrl,
	stripClaudeThinkingSuffix,
	type ClaudePreparedBody,
	type ClaudeRequestSettings,
} from "./claudeRequest";

/** 适配器承接的操作。 */
const CLAUDE_SUPPORTED_OPERATIONS: ReadonlySet<SubscriptionOperation> = new Set<SubscriptionOperation>([
	"chat",
	"messages",
	"responses",
	"count_tokens",
	"compact",
]);

/** 可被 Provider 前缀包装的模型名前缀。 */
const CLAUDE_PROVIDER_PREFIXES: readonly RegExp[] = [/^claude-subscription\//i, /^claude\//i, /^anthropic\//i];

/** Provider 构造选项。 */
export interface ClaudeProviderOptions {
	/** 请求特化设置；缺省启用 Cloaking 与 CCH 签名。 */
	readonly settings?: ClaudeRequestSettings;
}

/**
 * 创建 Claude 订阅 Provider 适配器。
 * @param dependencies - 账号仓库与可注入 fetch
 * @param options - 请求特化设置
 * @returns 适配器实例
 */
export function createClaudeProvider(
	dependencies: SubscriptionProviderDependencies,
	options: ClaudeProviderOptions = {},
): SubscriptionProviderAdapter {
	const settings = options.settings ?? {};
	const auth = createClaudeAuth({
		accounts: dependencies.accounts,
		...(dependencies.fetch === undefined ? {} : { fetch: dependencies.fetch }),
	});
	const fetchImpl = dependencies.fetch ?? fetch;

	/**
	 * 构造 Messages 端点请求。
	 * @param context - 上游上下文
	 * @param prepared - 已特化的请求体
	 * @param stream - 是否流式
	 * @param toolNames - 安全工具名到原始名称的映射
	 */
	const messagesPlan = (
		context: SubscriptionUpstreamContext,
		prepared: ClaudePreparedBody,
		stream: boolean,
		toolNames?: ReadonlyMap<string, string>,
	): SubscriptionUpstreamPlan => {
		const model = resolveClaudeModel(context.model);
		const baseUrl = resolveClaudeBaseUrl(context.account, settings);
		const headers = claudeRequestHeaders({
			context: context.stream === stream ? context : { ...context, stream: stream },
			account: context.account,
			credential: context.credential,
			baseUrl: baseUrl,
			model: model,
			body: prepared.body,
			settings: settings,
			countTokens: false,
		});
		return {
			url: claudeMessagesEndpoint(baseUrl, false),
			method: "POST",
			headers: headers,
			body: prepared.raw ?? prepared.body,
			bodyEncoding: prepared.raw === undefined ? "json" : "raw",
			stream: stream,
			protocol: "messages",
			model: model,
			...(toolNames === undefined ? {} : { toolNames: toolNames }),
		};
	};

	/**
	 * 构造对话请求（chat / messages / responses 共用）。
	 * @param context - 上游上下文
	 */
	const conversationPlan = (context: SubscriptionUpstreamContext): SubscriptionUpstreamPlan => {
		const model = resolveClaudeModel(context.model);
		const body = asBodyRecord(context.upstreamBody);
		// Claude 没有跨供应商 thinking 签名 bypass；必须在 CCH 签名前清理，
		// 否则 raw body 会带着无法回放的签名发给上游。
		sanitizeClaudeMessagesSignatures(body);
		// 必须在 CCH 签名前改名，否则 raw body 与签名不一致。
		const toolNames = normalizeToolNames(body);
		const prepared = prepareClaudeMessagesBody({
			body: body,
			context: context,
			account: context.account,
			model: model,
			settings: settings,
		});
		return messagesPlan(context, prepared, context.stream, toolNames);
	};

	/**
	 * 构造 Anthropic 原生 count_tokens 请求。
	 * @param context - 上游上下文
	 */
	const countTokensPlan = (context: SubscriptionUpstreamContext): SubscriptionUpstreamPlan => {
		const model = resolveClaudeModel(context.model);
		const baseUrl = resolveClaudeBaseUrl(context.account, settings);
		const upstreamBody = asBodyRecord(context.upstreamBody);
		sanitizeClaudeMessagesSignatures(upstreamBody);
		const toolNames = normalizeToolNames(upstreamBody);
		const body = prepareClaudeCountTokensBody({
			body: upstreamBody,
			context: context,
			account: context.account,
			model: model,
			settings: settings,
		});
		const headers = claudeRequestHeaders({
			context: context,
			account: context.account,
			credential: context.credential,
			baseUrl: baseUrl,
			model: model,
			body: body,
			settings: settings,
			countTokens: true,
		});
		return {
			url: claudeMessagesEndpoint(baseUrl, true),
			method: "POST",
			headers: headers,
			body: body,
			bodyEncoding: "json",
			stream: false,
			// count_tokens 按入口语义原样返回 Anthropic 的 `{input_tokens}`。
			protocol: context.inbound,
			model: model,
			...(toolNames === undefined ? {} : { toolNames: toolNames }),
		};
	};

	/**
	 * 构造 Responses compact 请求：先转成 Messages 摘要请求，再把摘要封装成胶囊。
	 * @param context - 上游上下文
	 */
	const compactionPlan = (context: SubscriptionUpstreamContext): SubscriptionUpstreamPlan => {
		const model = resolveClaudeModel(context.model);
		const source = asBodyRecord(context.upstreamBody);
		const summaryRequest = buildClaudeCompactionRequest(source, model);
		const prepared = prepareClaudeMessagesBody({
			body: summaryRequest,
			context: { ...context, stream: false },
			account: context.account,
			model: model,
			settings: settings,
		});
		return messagesPlan(context, prepared, false);
	};

	return {
		source: "claude",
		displayName: "Claude",
		auth: auth,
		/**
		 * 判断操作/模型是否由 Claude 承接。
		 * @param operation - 端点操作
		 * @param model - 上游模型
		 */
		supports: (operation: SubscriptionOperation, model: string): boolean => {
			if (!CLAUDE_SUPPORTED_OPERATIONS.has(operation)) {
				return false;
			}
			return resolveClaudeModel(model).length > 0;
		},
		/**
		 * 对话类请求固定走 Messages；count_tokens / compact 的入口语义是 Responses。
		 * @param context - 请求上下文
		 */
		route: (context: SubscriptionRequestContext): SubscriptionWireProtocol => {
			if (context.operation === "count_tokens" || context.operation === "compact") {
				return context.inbound;
			}
			return "messages";
		},
		/**
		 * 去掉 provider 前缀、`[1m]` 标记与 thinking 后缀；其余模型 ID 原样使用。
		 * @param model - 公开模型 ID
		 */
		resolveModel: (model: string): string => {
			return resolveClaudeModel(model);
		},
		/**
		 * 构造 Claude 上游请求。
		 * @param context - 上游上下文
		 */
		build: async (context: SubscriptionUpstreamContext): Promise<SubscriptionUpstreamPlan> => {
			switch (context.operation) {
				case "chat":
				case "messages":
				case "responses":
					return conversationPlan(context);
				case "count_tokens":
					return countTokensPlan(context);
				case "compact":
					return compactionPlan(context);
				default:
					throw ApiError.badRequest(`Claude 不支持该操作：${context.operation}`);
			}
		},
		/**
		 * compact 的上游是 Messages 摘要响应，这里转换成 Responses 的压缩结果。
		 * @param context - 请求上下文
		 * @param body - 上游 JSON
		 */
		transformUpstreamBody: (context: SubscriptionRequestContext, body: Record<string, unknown>): Record<string, unknown> => {
			if (context.operation !== "compact") {
				return body;
			}
			return buildClaudeCompactionResponse(body, resolveClaudeModel(context.model));
		},
		/**
		 * 模型目录：Claude 静态目录。
		 */
		catalog: async (): Promise<readonly SubscriptionCatalogModel[]> => {
			return catalogForSource("claude");
		},
		/**
		 * 查询 Claude 账号额度并映射为订阅快照。
		 * @param account - 选中账号
		 */
		quota: async (account: SubscriptionAccount): Promise<SubscriptionQuotaSnapshot> => {
			const credential = await auth.ensureCredential(account);
			const quota = await quotaForAccount("claude", account, credential, fetchImpl);
			return mapClaudeQuota(quota);
		},
	};
}

/**
 * 归一化 Claude 模型 ID。
 * @param model - 公开模型 ID
 * @returns 上游模型 ID；空输入返回空串
 */
function resolveClaudeModel(model: string): string {
	let trimmed = typeof model === "string" ? model.trim() : "";
	if (!trimmed) {
		return "";
	}
	for (const prefix of CLAUDE_PROVIDER_PREFIXES) {
		trimmed = trimmed.replace(prefix, "");
	}
	trimmed = stripClaudeThinkingSuffix(trimmed.trim());
	trimmed = trimmed.replace(/\[1m\]$/i, "").trim();
	return trimmed;
}

/**
 * 把共享额度层的归一化结果转换为订阅额度快照。
 * @param quota - 共享额度层的归一化结果
 * @returns 订阅额度快照
 */
function mapClaudeQuota(quota: CliProxyAccountQuota): SubscriptionQuotaSnapshot {
	const balances: Record<string, number> = {};
	for (const balance of quota.balances) {
		balances[balance.label || balance.unit] = Math.max(0, balance.limit - balance.used);
	}
	const windows: SubscriptionQuotaWindow[] = quota.windows.map((window) => ({
		name: window.label || window.id,
		...(window.remaining_percent === null
			? {}
			: { remainingFraction: Math.min(1, Math.max(0, window.remaining_percent / 100)) }),
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
