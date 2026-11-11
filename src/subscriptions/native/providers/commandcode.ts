/**
 * CommandCode 订阅 Provider 适配器。
 *
 * 取代原 Go 插件 `commandcode-go-cliproxyapi`：账号仍是 auth JSON 里的 API key，
 * 上游是 CommandCode 的 Provider API（`https://api.commandcode.ai/provider/v1`）。
 * 适配器只负责「上游怎么说话」——路由、URL、请求头、会话亲和、工具命名空间与
 * reasoning 的线上形态；账号选择、凭据刷新、协议转换与 HTTP 调用由 bridge 完成。
 *
 * 路由与插件 `catalog.routeFor`/`DefaultRoute` 一致：
 *
 * | 入口协议 | Claude 模型 | 其余模型 |
 * | --- | --- | --- |
 * | chat | /messages | /responses |
 * | messages | /messages | /responses |
 * | responses | /messages | /responses |
 *
 * 上游 `/responses` 原样承载 Responses 的 `namespace` 工具与思考摘要，因此默认路由
 * 不需要工具拍平；只有显式落到 `/chat/completions` 时（插件 `route-overrides`
 * 的场景）才拍平成 `<namespace>__<name>` 并在响应里还原，规则与 LiteLLM 的
 * Responses 兼容层一致。
 */

import { ApiError } from "../../../core/api/ApiError";
import type { CliProxyAccountQuota, CliProxyQuotaWindow } from "../../../cliproxy/CliProxyTypes";
import type { SubscriptionAccountStore } from "../accountStore";
import { createApiKeyAuth } from "../auth/apiKey";
import { catalogForSource, refreshDynamicCatalog } from "../catalog/catalog";
import { quotaForAccount } from "../quota/quota";
import type {
	SubscriptionAccount,
	SubscriptionAuthHandler,
	SubscriptionCatalogModel,
	SubscriptionOperation,
	SubscriptionProviderAdapter,
	SubscriptionQuotaSnapshot,
	SubscriptionQuotaWindow,
	SubscriptionRequestContext,
	SubscriptionSource,
	SubscriptionUpstreamContext,
	SubscriptionUpstreamPlan,
	SubscriptionWireProtocol,
} from "../types";
import {
	COMMANDCODE_ANTHROPIC_VERSION,
	COMMANDCODE_BASE_URL,
	COMMANDCODE_ENDPOINT_PATHS,
	COMMANDCODE_PUBLIC_PREFIX,
	COMMANDCODE_SESSION_HEADER,
	appendFlattenedNamespaceTools,
	applyChatToolNamespaces,
	assertMessagesCompatibleTools,
	backfillChatReasoning,
	commandCodeRouteForModel,
	commandCodeSessionValue,
	commandCodeToolNamespaces,
	isCommandCodeRoute,
	restoreResponsesEventNamespaces,
	restoreResponsesToolNamespaces,
	stripMalformedThinking,
} from "./commandcodeProtocol";
import type { SubscriptionProviderDependencies } from "./types";
import { JSON_HEADERS, SSE_HEADERS, asBodyRecord, joinUrl, jsonPlan } from "./shared";

/** 账号来源。 */
export const COMMANDCODE_SOURCE: SubscriptionSource = "commandcode";

/** 展示名。 */
export const COMMANDCODE_DISPLAY_NAME = "CommandCode";

/**
 * 把 0..100 的百分比钳到 0..1 的比例。
 * @param percent - 剩余百分比
 */
function fractionOf(percent: number): number {
	return Math.min(1, Math.max(0, percent / 100));
}

/**
 * 把一个额度窗口映射成订阅快照窗口。
 * @param window - CLIProxy 归一化窗口
 */
function quotaWindowOf(window: CliProxyQuotaWindow): SubscriptionQuotaWindow {
	const remaining = window.remaining_percent;
	return {
		name: window.label.length > 0 ? window.label : window.id,
		...(typeof remaining === "number" && Number.isFinite(remaining) ? { remainingFraction: fractionOf(remaining) } : {}),
		...(window.resets_at ? { resetTime: window.resets_at } : {}),
		raw: {
			id: window.id,
			label: window.label,
			usedPercent: window.used_percent,
			remainingPercent: window.remaining_percent,
			resetsAt: window.resets_at,
		},
	};
}

/**
 * 把 `quotaForAccount` 的结果映射成适配器快照。
 * @param quota - CLIProxy 归一化额度
 */
function quotaSnapshotOf(quota: CliProxyAccountQuota): SubscriptionQuotaSnapshot {
	const windows = quota.windows.map(quotaWindowOf);
	const balances: Record<string, number> = {};
	for (const balance of quota.balances) {
		const remaining = balance.limit - balance.used;
		balances[balance.label] = Number.isFinite(remaining) ? Math.max(0, remaining) : balance.limit;
	}
	return {
		...(quota.plan !== null && quota.plan.length > 0 ? { plan: quota.plan } : {}),
		...(quota.subscription_expires_at ? { expiresAt: quota.subscription_expires_at } : {}),
		...(Object.keys(balances).length > 0 ? { balances: balances } : {}),
		...(windows.length > 0 ? { windows: windows } : {}),
		fetchedAt: quota.fetched_at,
	};
}

/**
 * 构造上游请求头。
 *
 * 鉴权方式随路由不同（插件 `upstreamAuthHeaders`）：`/messages` 是 Anthropic 风格
 * 的 `x-api-key` + `anthropic-version`，`/chat/completions` 与 `/responses` 是
 * OpenAI 风格的 `Authorization: Bearer`。三条路由都带会话亲和头。
 * @param route - 上游协议
 * @param credential - API key
 * @param sessionKey - bridge 计算的会话亲和键
 * @param stream - 是否流式
 */
function commandCodeHeaders(
	route: SubscriptionWireProtocol,
	credential: string,
	sessionKey: string,
	stream: boolean,
): Record<string, string> {
	const headers: Record<string, string> = {
		...(stream ? SSE_HEADERS : JSON_HEADERS),
		[COMMANDCODE_SESSION_HEADER]: commandCodeSessionValue(sessionKey),
	};
	if (route === "messages") {
		headers["x-api-key"] = credential;
		headers["anthropic-version"] = COMMANDCODE_ANTHROPIC_VERSION;
	} else {
		headers["Authorization"] = `Bearer ${credential}`;
	}
	return headers;
}

/**
 * CommandCode 适配器实现。
 */
class CommandCodeProvider implements SubscriptionProviderAdapter {
	/** 账号来源。 */
	readonly source: SubscriptionSource = COMMANDCODE_SOURCE;

	/** 展示名。 */
	readonly displayName: string = COMMANDCODE_DISPLAY_NAME;

	/** 静态 API key 鉴权。 */
	readonly auth: SubscriptionAuthHandler;

	private readonly _accounts: SubscriptionAccountStore;

	private readonly _fetch: typeof fetch | undefined;

	constructor(dependencies: SubscriptionProviderDependencies) {
		this._accounts = dependencies.accounts;
		this._fetch = dependencies.fetch;
		this.auth = createApiKeyAuth(COMMANDCODE_SOURCE);
	}

	/**
	 * 判断某操作能否由 CommandCode 承接。
	 *
	 * 插件只为 `executor.execute`/`execute_stream` 注册了实现：对话三协议可用，
	 * `count_tokens` 与图片等 passthrough HTTP 端点明确返回 unsupported；compact
	 * 在上游没有对应端点（Codex 的 `/responses/compact` 属于另一来源），这里一并拒绝。
	 * @param operation - 端点操作
	 * @param model - 请求模型
	 */
	supports(operation: SubscriptionOperation, model: string): boolean {
		if (model.trim().length === 0) {
			return false;
		}
		switch (operation) {
			case "chat":
			case "messages":
			case "responses":
				return true;
			default:
				return false;
		}
	}

	/**
	 * 选择上游协议。
	 * @param context - 请求上下文
	 */
	route(context: SubscriptionRequestContext): SubscriptionWireProtocol {
		return commandCodeRouteForModel(context.model);
	}

	/**
	 * 把公开模型 ID 还原成上游 ID（去掉 `commandcode/` 前缀）。
	 * @param model - 请求模型
	 */
	resolveModel(model: string): string {
		const trimmed = model.trim();
		const path = trimmed.toLowerCase();
		if (path.startsWith(COMMANDCODE_PUBLIC_PREFIX)) {
			return trimmed.slice(COMMANDCODE_PUBLIC_PREFIX.length).trim();
		}
		return trimmed;
	}

	/**
	 * 构造上游请求。
	 * @param context - 已选定账号与上游协议的执行上下文
	 */
	async build(context: SubscriptionUpstreamContext): Promise<SubscriptionUpstreamPlan> {
		if (context.rawBody !== undefined) {
			throw ApiError.badRequest("CommandCode 只接受 JSON 请求体");
		}
		const credential = context.credential.trim();
		if (credential.length === 0) {
			throw ApiError.unauthorized("CommandCode 账号缺少 API key");
		}
		const upstream = context.upstream;
		if (!isCommandCodeRoute(upstream)) {
			throw ApiError.badRequest(`CommandCode 不支持的上游协议：${upstream}`);
		}
		const model = this.resolveModel(context.model);
		if (model.length === 0) {
			throw ApiError.badRequest("CommandCode 请求缺少模型");
		}
		let body = asBodyRecord(context.upstreamBody);
		body["model"] = model;
		if (context.stream) {
			body["stream"] = true;
		} else {
			delete body["stream"];
		}
		if (upstream === "chat") {
			// DeepSeek 系模型会因为 `thinking` 缺少字符串 type 报错；chat 端点也
			// 只能承载 function 工具。协议转换会丢掉 namespace 声明，这里按客户端
			// 原始请求体补齐拍平后的函数声明。
			stripMalformedThinking(body);
			body = applyChatToolNamespaces(body);
			body = appendFlattenedNamespaceTools(body, context.body);
		} else if (upstream === "messages") {
			// Claude 模型固定走 /messages，而该端点没有 namespace 工具形态。
			assertMessagesCompatibleTools(context.body);
		}
		const path = COMMANDCODE_ENDPOINT_PATHS[upstream];
		return jsonPlan(
			joinUrl(COMMANDCODE_BASE_URL, path),
			commandCodeHeaders(upstream, credential, context.sessionKey, context.stream),
			body,
			model,
			context.stream,
			upstream,
		);
	}

	/**
	 * 上游非流式响应：把供应商的思考文本补齐到 `reasoning_content`。
	 * @param _context - 请求上下文
	 * @param body - 上游响应体
	 */
	transformUpstreamBody(_context: SubscriptionRequestContext, body: Record<string, unknown>): Record<string, unknown> {
		return backfillChatReasoning(body) ?? body;
	}

	/**
	 * 上游流式事件：chat chunk 里的思考文本补齐到 `reasoning_content`。
	 * @param _context - 请求上下文
	 * @param event - 上游事件载荷
	 */
	transformUpstreamEvent(_context: SubscriptionRequestContext, event: Record<string, unknown>): Record<string, unknown> {
		return backfillChatReasoning(event) ?? event;
	}

	/**
	 * 入口协议响应：还原被拍平的 namespace 工具，并补齐 chat 的思考字段。
	 * @param context - 请求上下文
	 * @param body - 已翻译回入口协议的响应体
	 */
	transformInboundBody(context: SubscriptionRequestContext, body: Record<string, unknown>): Record<string, unknown> {
		let result = body;
		if (context.inbound === "chat") {
			result = backfillChatReasoning(result) ?? result;
		}
		if (context.inbound === "responses") {
			result = restoreResponsesToolNamespaces(result, commandCodeToolNamespaces(context.body)) ?? result;
		}
		return result;
	}

	/**
	 * 入口协议流式事件：`function_call` 输出项还原 namespace。
	 * @param context - 请求上下文
	 * @param event - 已翻译回入口协议的事件载荷
	 */
	transformInboundEvent(context: SubscriptionRequestContext, event: Record<string, unknown>): Record<string, unknown> {
		let result = event;
		if (context.inbound === "chat") {
			result = backfillChatReasoning(result) ?? result;
		}
		if (context.inbound === "responses") {
			result = restoreResponsesEventNamespaces(result, commandCodeToolNamespaces(context.body)) ?? result;
		}
		return result;
	}

	/**
	 * 读取模型目录：优先用第一个可用账号的 key 拉上游 `/models`，失败回退内置目录。
	 */
	async catalog(): Promise<readonly SubscriptionCatalogModel[]> {
		const accounts = (await this._accounts.list(COMMANDCODE_SOURCE)).filter((account) => !account.disabled);
		if (accounts.length === 0) {
			return catalogForSource(COMMANDCODE_SOURCE);
		}
		const credential = await this._firstCredential(accounts);
		if (credential === undefined) {
			return catalogForSource(COMMANDCODE_SOURCE);
		}
		try {
			return await refreshDynamicCatalog(COMMANDCODE_SOURCE, credential, this._fetch);
		} catch {
			// 目录属于展示信息：刷新失败时仍要给出内置回退项。
			return catalogForSource(COMMANDCODE_SOURCE);
		}
	}

	/**
	 * 查询账号额度。
	 * @param account - 账号
	 */
	async quota(account: SubscriptionAccount): Promise<SubscriptionQuotaSnapshot> {
		const credential = await this.auth.ensureCredential(account);
		const quota = await quotaForAccount(COMMANDCODE_SOURCE, account, credential, this._fetch);
		return quotaSnapshotOf(quota);
	}

	/**
	 * 取第一个能读出凭据的账号 key。
	 * @param accounts - 已过滤掉禁用账号的列表
	 */
	private async _firstCredential(accounts: readonly SubscriptionAccount[]): Promise<string | undefined> {
		for (const account of accounts) {
			try {
				const credential = (await this.auth.ensureCredential(account)).trim();
				if (credential.length > 0) {
					return credential;
				}
			} catch {
				// 缺少 key 的账号跳过，交给下一个；全部失败时回退内置目录。
			}
		}
		return undefined;
	}
}

/**
 * 创建 CommandCode 适配器。
 * @param dependencies - 账号仓库与可注入的 fetch
 */
export function createCommandCodeProvider(dependencies: SubscriptionProviderDependencies): SubscriptionProviderAdapter {
	return new CommandCodeProvider(dependencies);
}
