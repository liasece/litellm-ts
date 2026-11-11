/**
 * 订阅执行桥。
 *
 * Provider 的同步 transform 只负责把客户端请求整理成入口协议请求体，并把 URL
 * 标记为 `litellm-subscription://`；真正执行时由本模块在进程内完成账号选择、
 * 凭据刷新、协议转换与上游调用，再把响应翻译回入口协议。
 *
 * 这样 Router/端点的 fallback、SpendLog、隐私脱敏、超时与取消逻辑保持不变，
 * 同时不再需要独立的 Go HTTP 子进程。
 */

import { ApiError } from "../../core/api/ApiError";
import { logger } from "../../core/utils/logger";
import type { ProviderRequest } from "../../types/provider";
import type { ProviderRequestExecutionOptions, ProviderRequestExecutionResult } from "../../router/ProviderRequestExecutor";
import { executeProviderRequest, isClientAbortError } from "../../router/ProviderRequestExecutor";
import type { SubscriptionAccountStore } from "./accountStore";
import { disableInvalidAccount, isTerminalRefreshFailure } from "./auth/refreshFailure";
import type { SubscriptionAccountScheduler } from "./scheduler";
import { createStreamTranslator, translateRequest, translateResponse } from "./protocol/types";
import type { ProtocolEvent, ProtocolPayload } from "./protocol/types";
import { encodeSseEvent, isSseResponse, readSseEvents } from "./protocol/sse";
import { resolveSessionKey } from "./session";
import { restoreToolNames } from "./toolNames";
import type {
	SubscriptionAccount,
	SubscriptionInboundProtocol,
	SubscriptionOperation,
	SubscriptionProviderAdapter,
	SubscriptionRateLimitSnapshot,
	SubscriptionRequestContext,
	SubscriptionSource,
	SubscriptionUpstreamPlan,
} from "./types";

/** URL scheme 前缀。 */
const BRIDGE_SCHEME = "litellm-subscription://";

/** 公开的 Provider 注册表视图。 */
export interface SubscriptionProviderLookup {
	/**
	 * 按来源取适配器。
	 * @param source - 账号来源
	 */
	get(source: SubscriptionSource): SubscriptionProviderAdapter | undefined;
	/** 全部适配器。 */
	list(): readonly SubscriptionProviderAdapter[];
}

/** 桥接层依赖。 */
export interface SubscriptionBridgeDependencies {
	/** 账号仓库。 */
	readonly accounts: SubscriptionAccountStore;
	/** 调度器。 */
	readonly scheduler: SubscriptionAccountScheduler;
	/** Provider 适配器。 */
	readonly providers: SubscriptionProviderLookup;
	/** 运行时是否启用；缺省视为启用。 */
	readonly isEnabled?: () => boolean;
}

/** 解析后的桥接 URL。 */
interface BridgeTarget {
	/** 账号来源。 */
	readonly source: SubscriptionSource;
	/** 端点操作。 */
	readonly operation: SubscriptionOperation;
	/** 入口协议；非对话类操作为 chat 占位。 */
	readonly inbound: SubscriptionInboundProtocol;
}

/** 一次执行的内部上下文。 */
interface ExecutionContext {
	/** 桥接目标。 */
	readonly target: BridgeTarget;
	/** 原始请求。 */
	readonly request: ProviderRequest;
	/** 请求上下文。 */
	readonly context: SubscriptionRequestContext;
	/** 适配器。 */
	readonly adapter: SubscriptionProviderAdapter;
}

/**
 * 判断 URL 是否由订阅桥承接。
 * @param url - Provider 生成的 URL
 */
export function isSubscriptionBridgeUrl(url: string): boolean {
	return url.startsWith(BRIDGE_SCHEME);
}

/**
 * 生成 Provider 使用的桥接 URL。
 * @param source - 账号来源
 * @param operation - 操作路径
 */
export function subscriptionBridgeUrl(source: SubscriptionSource, operation: string): string {
	return `${BRIDGE_SCHEME}${source}/${operation}`;
}

/**
 * 解析操作路径。
 * @param raw - URL 中的操作段
 * @throws {ApiError} 未知操作
 */
function parseOperation(raw: string): SubscriptionOperation {
	switch (raw) {
		case "chat":
			return "chat";
		case "messages":
			return "messages";
		case "messages/count_tokens":
			return "count_tokens";
		case "responses":
			return "responses";
		case "responses/compact":
			return "compact";
		case "completions":
		case "compact":
		case "count_tokens":
		case "videos":
		case "speech":
		case "live":
		case "realtime":
		case "models":
			return raw;
		case "images/generations":
			return "images.generations";
		case "images/edits":
			return "images.edits";
		case "alpha/search":
			return "alpha.search";
		default:
			throw ApiError.badRequest(`未知的订阅操作：${raw}`);
	}
}

/**
 * 解析桥接 URL。
 * @param url - 桥接 URL
 * @throws {ApiError} URL 不是订阅桥或缺少来源/操作
 */
function parseTarget(url: string): BridgeTarget {
	const rest = url.slice(BRIDGE_SCHEME.length);
	const slash = rest.indexOf("/");
	if (slash <= 0) {
		throw ApiError.badRequest("订阅请求地址无效");
	}
	const source = rest.slice(0, slash) as SubscriptionSource;
	const rawOperation = rest.slice(slash + 1);
	if (rawOperation === "gemini/count_tokens") {
		return { source: source, operation: "count_tokens", inbound: "gemini" };
	}
	// Gemini 入口复用 chat 操作语义：适配器仍按上游协议选择 messages/responses/gemini。
	const operation = rawOperation === "gemini" ? "chat" : parseOperation(rawOperation);
	const inbound: SubscriptionInboundProtocol =
		rawOperation === "gemini"
			? "gemini"
			: operation === "messages"
				? "messages"
				: operation === "chat" || operation === "completions"
					? "chat"
					: "responses";
	return { source: source, operation: operation, inbound: inbound };
}

/**
 * 从请求体/ProviderRequest 中提取模型。
 * @param body - 请求体
 * @param fallback - ProviderRequest.model
 */
function modelOf(body: unknown, fallback: string): string {
	if (body && typeof body === "object" && !Array.isArray(body)) {
		if (typeof FormData !== "undefined" && body instanceof FormData) {
			const formModel = body.get("model");
			if (typeof formModel === "string" && formModel) {
				return formModel;
			}
		} else {
			const value = (body as Record<string, unknown>)["model"];
			if (typeof value === "string" && value) {
				return value;
			}
		}
	}
	return fallback;
}

/**
 * 计算会话亲和键；保留旧导出名供调用方与测试使用。
 *
 * 具体规则在 `session.ts`，桥接层与会话头清单只维护一份。
 * @param headers - 请求头
 * @param body - 请求体
 */
export function subscriptionSessionKey(headers: Record<string, string>, body: Record<string, unknown>): string {
	return resolveSessionKey(headers, body);
}

/**
 * 判断状态码是否值得刷新凭据后重试。
 * @param status - 上游状态码
 */
/** 可切换账号重试的操作；图片/视频会重复计费，不在此列。 */
const ACCOUNT_RETRY_OPERATIONS = new Set<SubscriptionOperation>(["chat", "messages", "responses", "compact", "alpha.search"]);

/**
 * 上游账号级失败：换账号通常可恢复，且不会重复已完成计费。
 * @param status - HTTP 状态码
 */
function isAccountRetryableStatus(status: number): boolean {
	return status === 401 || status === 403 || status === 408 || status === 429 || status >= 500;
}

function isCredentialFailure(status: number): boolean {
	return status === 401 || status === 403;
}

/**
 * 把上游 Retry-After 解析为毫秒。
 * @param headers - 上游响应头
 */
function retryAfterMs(headers: Headers): number | undefined {
	const raw = headers.get("retry-after")?.trim();
	if (!raw) {
		return undefined;
	}
	const seconds = Number(raw);
	if (Number.isFinite(seconds) && seconds >= 0) {
		return seconds * 1000;
	}
	const date = Date.parse(raw);
	return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

/** 需要捕获的上游限流/额度响应头前缀。 */
const RATE_LIMIT_HEADER_PREFIXES = ["x-ratelimit-", "anthropic-ratelimit-", "x-codex-", "ratelimit-"] as const;

/**
 * 从上游响应提取额度/限流快照。
 * @param status - HTTP 状态
 * @param headers - 响应头
 */
function rateLimitSnapshot(status: number, headers: Headers): SubscriptionRateLimitSnapshot | undefined {
	const captured: Record<string, string> = {};
	for (const [key, value] of headers.entries()) {
		const lower = key.toLowerCase();
		// turn-state / metadata 是会话凭据，不属于限流快照，不能回显到管理面。
		if (lower.includes("turn-state") || lower.includes("turn-metadata")) {
			continue;
		}
		if (RATE_LIMIT_HEADER_PREFIXES.some((prefix) => lower.startsWith(prefix)) || lower === "retry-after") {
			captured[lower] = value.slice(0, 200);
		}
	}
	const retryAfter = retryAfterMs(headers);
	if (Object.keys(captured).length === 0 && retryAfter === undefined) {
		return undefined;
	}
	return {
		capturedAt: new Date().toISOString(),
		limited: status === 429 || (status >= 400 && retryAfter !== undefined),
		...(retryAfter === undefined ? {} : { retryAfterSeconds: Math.ceil(retryAfter / 1000) }),
		headers: captured,
	};
}

/**
 * 订阅执行桥。
 */
export class SubscriptionBridge {
	private readonly _accounts: SubscriptionAccountStore;
	private readonly _scheduler: SubscriptionAccountScheduler;
	private readonly _providers: SubscriptionProviderLookup;
	private readonly _isEnabled: (() => boolean) | undefined;
	private readonly _rateLimits = new Map<string, SubscriptionRateLimitSnapshot>();

	/**
	 * 读取账号最近一次限流快照。
	 * @param accountId - 账号 ID
	 */
	rateLimit(accountId: string): SubscriptionRateLimitSnapshot | undefined {
		return this._rateLimits.get(accountId);
	}

	constructor(dependencies: SubscriptionBridgeDependencies) {
		this._accounts = dependencies.accounts;
		this._scheduler = dependencies.scheduler;
		this._providers = dependencies.providers;
		this._isEnabled = dependencies.isEnabled;
	}

	/**
	 * 执行一个桥接请求；由 ProviderRequestExecutor 在 fetch 前调用。
	 * @param request - Provider 生成的桥接请求
	 * @param options - transport 选项
	 */
	async execute(request: ProviderRequest, options: ProviderRequestExecutionOptions = {}): Promise<ProviderRequestExecutionResult> {
		if (this._isEnabled && !this._isEnabled()) {
			throw ApiError.unavailable("订阅运行时已停用");
		}
		const startedAtMs = Date.now();
		const target = parseTarget(request.url);
		const adapter = this._providers.get(target.source);
		if (!adapter) {
			throw ApiError.unavailable(`订阅 Provider 未启用：${target.source}`);
		}
		const body = normalizeBody(request.body);
		const rawBody = body === request.body ? undefined : request.body;
		const model = modelOf(request.body, request.model);
		if (!adapter.supports(target.operation, model)) {
			throw ApiError.badRequest(`${adapter.displayName} 不支持该操作或模型：${model}`);
		}
		const stream = request.stream === true || body["stream"] === true;
		const sessionKey = resolveSessionKey(request.headers, body);
		const context: SubscriptionRequestContext = {
			source: target.source,
			operation: target.operation,
			model: model,
			inbound: target.inbound,
			body: body,
			headers: request.headers,
			rawBody: rawBody,
			stream: stream,
			signal: options.signal,
			sessionKey: sessionKey,
		};
		if (target.operation === "count_tokens" && adapter.countTokens) {
			const count = await adapter.countTokens(context);
			const counted = { input_tokens: count };
			return {
				response: new Response(JSON.stringify(counted), {
					status: 200,
					headers: { "content-type": "application/json" },
				}),
				body: counted,
				latencyMs: 0,
				startedAtMs: startedAtMs,
			};
		}
		const executionContext: ExecutionContext = {
			target: target,
			request: request,
			context: context,
			adapter: adapter,
		};
		const upstreamModel = adapter.resolveModel?.(model) ?? model;
		const accounts = await this._accounts.list(target.source);
		const retryable = ACCOUNT_RETRY_OPERATIONS.has(target.operation) && accounts.length > 1;
		const maxAttempts = retryable ? Math.min(3, accounts.length) : 1;
		const excluded = new Set<string>();
		for (let attempt = 1; ; attempt += 1) {
			const selection = await this._selectAccount(target.source, sessionKey, excluded);
			let plan = await this._buildPlan(executionContext, selection.account, upstreamModel, undefined);
			let dispatched = await executeProviderRequest(this._planRequest(plan), plan.stream ? { ...options, readJson: false } : options);
			if (isCredentialFailure(dispatched.response.status)) {
				try {
					if (adapter.auth.refreshForRequest) {
						await adapter.auth.refreshForRequest(selection.account, context.headers);
					} else {
						await adapter.auth.refresh(selection.account);
					}
					// refresh 只写入磁盘；必须重新读取账号，否则 ensureCredential 仍会拿旧 token
					// 按旧 exp 判定"未过期"并原样返回，重试必然再次 401。
					const refreshed =
						(await this._accounts.findByFileName(selection.account.fileName).catch(() => undefined)) ?? selection.account;
					const refreshedCredential = adapter.auth.ensureCredentialForRequest
						? await adapter.auth.ensureCredentialForRequest(refreshed, context.headers)
						: await adapter.auth.ensureCredential(refreshed);
					plan = await this._buildPlan(executionContext, refreshed, upstreamModel, refreshedCredential);
					this._scheduler.forget(target.source, sessionKey);
					dispatched = await executeProviderRequest(
						this._planRequest(plan),
						plan.stream ? { ...options, readJson: false } : options,
					);
				} catch (error) {
					if (isTerminalRefreshFailure(error)) {
						await disableInvalidAccount(this._accounts, selection.account, error).catch(() => undefined);
					}
					logger.warn("订阅凭据刷新失败，保留上游错误", {
						source: target.source,
						account: selection.account.fileName,
						error: error instanceof Error ? error.message : String(error),
					});
				}
			}
			const snapshot = rateLimitSnapshot(dispatched.response.status, dispatched.response.headers);
			if (snapshot) {
				this._rateLimits.set(selection.account.id, snapshot);
			}
			if (dispatched.response.status < 400) {
				this._scheduler.markSuccess(target.source, selection.account.id);
			} else {
				this._scheduler.markFailure(
					target.source,
					selection.account.id,
					dispatched.response.status,
					retryAfterMs(dispatched.response.headers),
				);
				this._scheduler.forget(target.source, sessionKey);
			}
			if (attempt < maxAttempts && isAccountRetryableStatus(dispatched.response.status)) {
				excluded.add(selection.account.id);
				logger.warn("订阅账号上游失败，切换账号重试", {
					source: target.source,
					account: selection.account.fileName,
					status: dispatched.response.status,
				});
				continue;
			}
			return this._finalize(dispatched, executionContext, plan, startedAtMs);
		}
	}

	/**
	 * 拉取全部模型目录。
	 */
	async catalog(): Promise<readonly { source: SubscriptionSource; models: readonly string[] }[]> {
		const result: { source: SubscriptionSource; models: readonly string[] }[] = [];
		for (const adapter of this._providers.list()) {
			try {
				const models = await adapter.catalog();
				result.push({ source: adapter.source, models: models.map((model) => model.id) });
			} catch (error) {
				logger.warn("订阅模型目录刷新失败", {
					source: adapter.source,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}
		return result;
	}

	/**
	 * 查询指定来源的全部账号额度。
	 * @param source - 账号来源
	 */
	async quotas(source: SubscriptionSource): Promise<readonly { account: SubscriptionAccount; quota: unknown }[]> {
		const adapter = this._providers.get(source);
		if (!adapter) {
			throw ApiError.notFound(`订阅 Provider 不存在：${source}`);
		}
		const accounts = await this._accounts.list(source);
		return await Promise.all(
			accounts.map(async (account) => ({
				account: account,
				quota: await adapter.quota(account).catch((error: unknown) => ({
					fetchedAt: new Date().toISOString(),
					error: error instanceof Error ? error.message : String(error),
				})),
			})),
		);
	}

	private async _selectAccount(source: SubscriptionSource, sessionKey: string, exclude?: ReadonlySet<string>) {
		const accounts = await this._accounts.list(source);
		if (accounts.length === 0) {
			throw ApiError.unavailable(`没有可用的 ${source} 订阅账号`);
		}
		return this._scheduler.select(source, sessionKey, accounts, exclude);
	}

	private async _buildPlan(
		execution: ExecutionContext,
		account: SubscriptionAccount,
		upstreamModel: string,
		credentialOverride: string | undefined,
	): Promise<SubscriptionUpstreamPlan> {
		const { adapter, context } = execution;
		const credential =
			credentialOverride ??
			(adapter.auth.ensureCredentialForRequest
				? await adapter.auth.ensureCredentialForRequest(account, context.headers)
				: await adapter.auth.ensureCredential(account));
		// ensureCredential 可能刷新 token 或补齐 project_id；重新读取磁盘快照，避免 build 用旧 raw。
		const latest = (await this._accounts.findByFileName(account.fileName).catch(() => undefined)) ?? account;
		const upstream = adapter.route(context);
		let upstreamBody = context.body;
		if (
			context.operation === "chat" ||
			context.operation === "messages" ||
			context.operation === "responses" ||
			context.operation === "count_tokens"
		) {
			upstreamBody =
				upstream === context.inbound
					? { ...context.body }
					: translateRequest(context.inbound, upstream, context.body, {
							model: context.model,
							upstreamModel: upstreamModel,
						});
		}
		return await adapter.build({
			...context,
			upstream: upstream,
			upstreamBody: upstreamBody,
			account: latest,
			credential: credential,
		});
	}

	private _planRequest(plan: SubscriptionUpstreamPlan): ProviderRequest {
		return {
			url: plan.url,
			method: plan.method,
			headers: plan.headers,
			body: plan.body,
			bodyEncoding: plan.bodyEncoding,
			logBody: plan.logBody ?? redactPlanBody(plan.body),
			model: plan.model,
			stream: plan.stream,
		};
	}

	private async _finalize(
		dispatched: ProviderRequestExecutionResult,
		execution: ExecutionContext,
		plan: SubscriptionUpstreamPlan,
		startedAtMs: number,
	): Promise<ProviderRequestExecutionResult> {
		const { adapter, context } = execution;
		let response = dispatched.response;
		let aggregatedBody: Record<string, unknown> | undefined;
		if (!response.ok) {
			return {
				response: response,
				body: dispatched.body,
				latencyMs: dispatched.latencyMs,
				startedAtMs: startedAtMs,
			};
		}
		if (plan.aggregateSse && !context.stream) {
			const parsedBody =
				dispatched.body && typeof dispatched.body === "object" && !Array.isArray(dispatched.body)
					? (dispatched.body as Record<string, unknown>)
					: undefined;
			aggregatedBody = parsedBody ?? (await aggregateUpstreamResponse(response));
			const headers = new Headers(response.headers);
			headers.set("content-type", "application/json");
			headers.delete("content-length");
			headers.delete("content-encoding");
			response = new Response(JSON.stringify(aggregatedBody), { status: response.status, headers: headers });
		}
		const sameProtocol = plan.protocol === context.inbound;
		const hasHooks =
			adapter.transformUpstreamBody !== undefined ||
			adapter.transformUpstreamEvent !== undefined ||
			adapter.transformInboundBody !== undefined ||
			adapter.transformInboundEvent !== undefined;
		if (sameProtocol && !hasHooks) {
			const preserved = aggregatedBody ?? dispatched.body;
			if (plan.toolNames === undefined || preserved === undefined) {
				return {
					response: response,
					body: preserved,
					latencyMs: dispatched.latencyMs,
					startedAtMs: startedAtMs,
				};
			}
			restoreToolNames(plan.toolNames, preserved);
			const headers = new Headers(response.headers);
			headers.set("content-type", "application/json");
			headers.delete("content-length");
			headers.delete("content-encoding");
			return {
				response: new Response(JSON.stringify(preserved), { status: response.status, headers: headers }),
				body: preserved,
				latencyMs: dispatched.latencyMs,
				startedAtMs: startedAtMs,
			};
		}
		// ChatGPT/Codex 的 SSE 响应可能不带 Content-Type，不能只按响应头判断；
		// 流式计划与调用方流式入口同时成立时按 SSE 处理，否则会把实时流当 JSON 读坏。
		const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
		const plannedStream = plan.stream && context.stream && !contentType.includes("application/json");
		if (response.body && (isSseResponse(response) || plannedStream)) {
			const wrapped = this._wrapStream(response, execution, plan);
			return {
				response: wrapped,
				body: undefined,
				latencyMs: dispatched.latencyMs,
				startedAtMs: startedAtMs,
			};
		}
		let resolvedBody: unknown = aggregatedBody ?? dispatched.body;
		if (resolvedBody === undefined && !response.bodyUsed) {
			try {
				resolvedBody = (await response.json()) as unknown;
			} catch {
				resolvedBody = undefined;
			}
		}
		const upstreamBody = asRecord(resolvedBody);
		if (!upstreamBody) {
			return {
				response: response,
				body: dispatched.body,
				latencyMs: dispatched.latencyMs,
				startedAtMs: startedAtMs,
			};
		}
		const transformedUpstream = adapter.transformUpstreamBody ? adapter.transformUpstreamBody(context, upstreamBody) : upstreamBody;
		restoreToolNames(plan.toolNames, transformedUpstream);
		const translated =
			plan.protocol === context.inbound
				? transformedUpstream
				: translateResponse(context.inbound, plan.protocol, transformedUpstream, {
						model: context.model,
						upstreamModel: plan.model,
					});
		const finalBody = adapter.transformInboundBody ? adapter.transformInboundBody(context, translated) : translated;
		const headers = new Headers(response.headers);
		headers.set("content-type", "application/json");
		headers.delete("content-length");
		headers.delete("content-encoding");
		return {
			response: new Response(JSON.stringify(finalBody), { status: response.status, headers: headers }),
			body: finalBody,
			latencyMs: dispatched.latencyMs,
			startedAtMs: startedAtMs,
		};
	}

	private _wrapStream(response: Response, execution: ExecutionContext, plan: SubscriptionUpstreamPlan): Response {
		const { adapter, context } = execution;
		const sameProtocol = plan.protocol === context.inbound;
		const translator = sameProtocol
			? undefined
			: createStreamTranslator(context.inbound, plan.protocol, {
					model: context.model,
					upstreamModel: plan.model,
					includeDone: true,
				});
		const source = response.body;
		if (!source) {
			return response;
		}
		const includeEventName = context.inbound !== "chat" && context.inbound !== "gemini";
		const stream = new ReadableStream<Uint8Array>({
			start: async (controller) => {
				const encoder = new TextEncoder();
				const emit = (event: ProtocolEvent): void => {
					const payload = asRecord(event.data);
					if (adapter.transformInboundEvent && payload) {
						const transformed = adapter.transformInboundEvent(context, payload);
						if (transformed === null) {
							return;
						}
						const next: ProtocolEvent =
							event.event === undefined ? { data: transformed } : { event: event.event, data: transformed };
						controller.enqueue(encoder.encode(encodeSseEvent(next, includeEventName)));
						return;
					}
					controller.enqueue(encoder.encode(encodeSseEvent(event, includeEventName)));
				};
				try {
					for await (const rawEvent of readSseEvents(source)) {
						let event: ProtocolEvent = rawEvent;
						if (adapter.transformUpstreamEvent) {
							const payload = asRecord(event.data);
							if (payload) {
								const transformed = adapter.transformUpstreamEvent(context, payload);
								if (transformed === null) {
									continue;
								}
								event = event.event === undefined ? { data: transformed } : { event: event.event, data: transformed };
							}
						}
						restoreToolNames(plan.toolNames, event.data);
						if (translator) {
							for (const translated of translator.push(event)) {
								emit(translated);
							}
						} else {
							emit(event);
						}
					}
					if (translator) {
						for (const translated of translator.flush()) {
							emit(translated);
						}
					}
					controller.close();
				} catch (error) {
					if (!isClientAbortError(error)) {
						logger.warn("订阅流式转换失败", {
							source: context.source,
							model: context.model,
							error: error instanceof Error ? error.message : String(error),
						});
					}
					controller.error(error);
				}
			},
			cancel: async () => {
				await source.cancel().catch(() => undefined);
			},
		});
		const headers = new Headers(response.headers);
		headers.set("content-type", includeEventName ? "text/event-stream; charset=utf-8" : "text/event-stream");
		headers.set("cache-control", "no-cache");
		headers.delete("content-length");
		headers.delete("content-encoding");
		return new Response(stream, { status: response.status, headers: headers });
	}
}

/**
 * 把未知请求体归一化为记录；FormData/二进制请求返回空对象，由适配器读取原始 body。
 * @param body - 请求体
 */
/**
 * 聚合上游 SSE，返回最终 Responses 对象；上游直接返回 JSON 时原样解析。
 * @param response - 上游响应
 * @throws {ApiError} SSE 没有完成事件或携带失败事件时抛出
 */
async function aggregateUpstreamResponse(response: Response): Promise<Record<string, unknown>> {
	const contentType = response.headers.get("content-type") ?? "";
	if (contentType.includes("application/json")) {
		const parsed = (await response.json()) as unknown;
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
		throw ApiError.unavailable("订阅上游返回了非对象 JSON");
	}
	const raw = await response.text();
	let final: Record<string, unknown> | undefined;
	for (const block of raw.split(/\r?\n\r?\n/)) {
		for (const line of block.split(/\r?\n/)) {
			if (!line.startsWith("data:")) {
				continue;
			}
			const data = line.slice(5).trim();
			if (!data || data === "[DONE]") {
				continue;
			}
			let event: Record<string, unknown>;
			try {
				const parsed = JSON.parse(data) as unknown;
				if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
					continue;
				}
				event = parsed as Record<string, unknown>;
			} catch {
				continue;
			}
			const type = typeof event["type"] === "string" ? event["type"] : "";
			if (type === "response.failed" || type === "error") {
				const detail = typeof event["message"] === "string" ? event["message"] : "上游流式响应失败";
				throw ApiError.unavailable(detail);
			}
			const responseObject = event["response"];
			if (responseObject && typeof responseObject === "object" && !Array.isArray(responseObject)) {
				final = responseObject as Record<string, unknown>;
			}
		}
	}
	if (!final) {
		throw ApiError.unavailable("订阅上游流式响应未产生完整结果");
	}
	return final;
}

/**
 * 递归替换请求体里的图片 data URL，避免上游日志写入大段 base64。
 * @param value - 请求体
 * @param depth - 递归深度
 */
function redactPlanBody(value: unknown, depth = 0): unknown {
	if (depth > 6) {
		return "[truncated]";
	}
	if (typeof value === "string") {
		return value.startsWith("data:image/") ? `[image data url ${value.length} chars]` : value;
	}
	if (Array.isArray(value)) {
		return value.map((item) => redactPlanBody(item, depth + 1));
	}
	if (value && typeof value === "object" && !(typeof FormData !== "undefined" && value instanceof FormData)) {
		const result: Record<string, unknown> = {};
		for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
			result[key] =
				key === "b64_json" && typeof item === "string" ? `[base64 ${item.length} chars]` : redactPlanBody(item, depth + 1);
		}
		return result;
	}
	return value;
}

function normalizeBody(body: unknown): Record<string, unknown> {
	if (body && typeof body === "object" && !Array.isArray(body) && !(typeof FormData !== "undefined" && body instanceof FormData)) {
		return body as Record<string, unknown>;
	}
	return {};
}

/**
 * 断言对象。
 * @param value - 待判定值
 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/**
 * 创建桥接实例。
 * @param dependencies - 依赖
 */
export function createSubscriptionBridge(dependencies: SubscriptionBridgeDependencies): SubscriptionBridge {
	return new SubscriptionBridge(dependencies);
}

/**
 * 供协议转换器复用的载荷判定。
 * @param payload - 事件载荷
 */
export function isObjectPayload(payload: ProtocolPayload): payload is Record<string, unknown> {
	return typeof payload === "object" && payload !== null && !Array.isArray(payload);
}
