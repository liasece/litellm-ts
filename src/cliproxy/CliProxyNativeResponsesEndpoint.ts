import type { Router as ExpressRouter, Request, Response } from "express";
import { registerRoute } from "../core/api/registerRoute";
import { ApiError } from "../core/api/ApiError";
import { runCommonChecks } from "../auth/AuthChecks";
import type { Router as LiteLLMRouter } from "../router/Router";
import type { CliProxyRuntimeManager } from "./CliProxyRuntimeManager";
import { CLIPROXY_PROVIDER } from "./CliProxyTypes";
import type { DrizzleDb } from "../core/db/Database";
import { createEndpointSpendLifecycle, reserveEndpointSpend } from "../spend/SpendReservation";
import { buildSpendLogFromRequest, trackSpendLog } from "../spend/SpendTracker";
import { CallType, SpendLogStatus } from "../types/spend";
import { buildDeploymentSpendInfo } from "../router/RouterSpendInfo";
import { applyReasoningEffortOverride } from "../router/ReasoningEffortOverride";
import { createUpstreamLogContext, type UpstreamLogContext } from "../router/UpstreamLogContext";
import { buildPassthroughLogRequest } from "./CliProxyUpstreamLogging";

const REQUEST_BLOCKED_HEADERS = new Set([
	"authorization",
	"x-api-key",
	"cookie",
	"host",
	"content-length",
	"connection",
	"transfer-encoding",
]);
const RESPONSE_BLOCKED_HEADERS = new Set(["connection", "transfer-encoding", "content-length", "keep-alive"]);
const RESPONSES_SSE_KEEPALIVE_INTERVAL_MS = 15_000;
const RESPONSES_SSE_KEEPALIVE_CHUNK = 'event: ping\ndata: {"type":"ping"}\n\n';
// Cloudflare Tunnel can discard SSE comments while it waits for a data event.
// Codex ignores unknown Responses event types, so a padded ping establishes the
// byte stream without changing the response state seen by the client.
const RESPONSES_SSE_INITIAL_PADDING_CHUNK = `event: ping\ndata: ${JSON.stringify({
	type: "ping",
	padding: " ".repeat(4_096),
})}\n\n`;

function isCliProxyModel(router: LiteLLMRouter, model: unknown): boolean {
	if (typeof model !== "string") {
		return false;
	}
	const candidate = router.getAvailableDeployment(model);
	return candidate?.deployment.litellm_params.custom_llm_provider === CLIPROXY_PROVIDER;
}

function upstreamModel(value: string): string {
	return value.startsWith(`${CLIPROXY_PROVIDER}/`) ? value.slice(CLIPROXY_PROVIDER.length + 1) : value;
}

function buildForwardHeaders(req: Request, internalApiKey: string, anthropicNative = false): Headers {
	const headers = new Headers();
	for (const [key, value] of Object.entries(req.headers)) {
		if (REQUEST_BLOCKED_HEADERS.has(key.toLowerCase()) || value === undefined) {
			continue;
		}
		if (Array.isArray(value)) {
			for (const item of value) {
				headers.append(key, item);
			}
		} else {
			headers.set(key, value);
		}
	}
	headers.set("Authorization", `Bearer ${internalApiKey}`);
	if (anthropicNative) {
		headers.set("x-api-key", internalApiKey);
	}
	headers.set("Content-Type", "application/json");
	return headers;
}

interface CapturedNativeResponse {
	readonly raw: string;
	readonly firstChunkAt: Date | null;
}

async function pipeUpstreamResponse(upstream: globalThis.Response, res: Response): Promise<CapturedNativeResponse> {
	if (!res.headersSent) {
		res.status(upstream.status);
		upstream.headers.forEach((value, key) => {
			if (!RESPONSE_BLOCKED_HEADERS.has(key.toLowerCase())) {
				res.setHeader(key, value);
			}
		});
	}
	if (!upstream.body) {
		if (!res.writableEnded) {
			res.end();
		}
		return { raw: "", firstChunkAt: null };
	}
	const reader = upstream.body.getReader();
	const decoder = new TextDecoder();
	let captured = "";
	let firstChunkAt: Date | null = null;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}
			firstChunkAt ??= new Date();
			if (!res.destroyed && !res.writableEnded) {
				res.write(Buffer.from(value));
			}
			captured += decoder.decode(value, { stream: true });
			if (captured.length > 2_000_000) {
				captured = captured.slice(-2_000_000);
			}
		}
		captured += decoder.decode();
		if (!res.writableEnded) {
			res.end();
		}
		return { raw: captured, firstChunkAt: firstChunkAt };
	} finally {
		reader.releaseLock();
	}
}

function startResponsesSseKeepAlive(res: Response): () => void {
	res.status(200);
	res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
	res.setHeader("Cache-Control", "no-cache, no-transform");
	res.setHeader("Connection", "keep-alive");
	res.setHeader("X-Accel-Buffering", "no");
	res.flushHeaders();
	res.write(RESPONSES_SSE_INITIAL_PADDING_CHUNK);
	const interval = setInterval(() => {
		if (!res.destroyed && !res.writableEnded) {
			res.write(RESPONSES_SSE_KEEPALIVE_CHUNK);
		}
	}, RESPONSES_SSE_KEEPALIVE_INTERVAL_MS);
	interval.unref();
	return () => clearInterval(interval);
}

function upstreamErrorMessage(raw: string, fallback: string): string {
	try {
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		const error = parsed["error"];
		if (typeof error === "object" && error !== null) {
			const message = (error as Record<string, unknown>)["message"];
			if (typeof message === "string" && message.length > 0) {
				return message.slice(0, 4_096);
			}
		}
		const message = parsed["message"];
		if (typeof message === "string" && message.length > 0) {
			return message.slice(0, 4_096);
		}
	} catch {
		// Fall back to a bounded plain-text error below.
	}
	const trimmed = raw.trim();
	return trimmed.length > 0 ? trimmed.slice(0, 4_096) : fallback;
}

function writeResponsesSseError(res: Response, status: number, message: string): void {
	if (res.destroyed || res.writableEnded) {
		return;
	}
	res.write(
		`event: error\ndata: ${JSON.stringify({
			type: "error",
			error: {
				type: "server_error",
				code: `http_${status}`,
				message: message,
			},
		})}\n\n`,
	);
	res.end();
}

function normalizeNativeUsage(value: unknown): Record<string, unknown> | undefined {
	if (typeof value !== "object" || value === null) {
		return undefined;
	}
	const usage = value as Record<string, unknown>;
	const cacheRead = typeof usage["cache_read_input_tokens"] === "number" ? usage["cache_read_input_tokens"] : 0;
	const cacheCreation = typeof usage["cache_creation_input_tokens"] === "number" ? usage["cache_creation_input_tokens"] : 0;
	const rawPrompt = typeof usage["prompt_tokens"] === "number" ? usage["prompt_tokens"] : undefined;
	// Anthropic 原生形状（无 prompt_tokens，有 input_tokens）：input_tokens 不含 cache，
	// 按 PY transformation.py:1587-1611 折叠 cache_read + cache_creation 进 prompt_tokens；
	// 否则（Chat/Responses 形状）prompt/input 已含 cache，直接沿用。
	const prompt = rawPrompt ?? (typeof usage["input_tokens"] === "number" ? usage["input_tokens"] + cacheRead + cacheCreation : 0);
	const completion =
		typeof usage["completion_tokens"] === "number"
			? usage["completion_tokens"]
			: typeof usage["output_tokens"] === "number"
				? usage["output_tokens"]
				: 0;
	if (prompt === 0 && completion === 0 && typeof usage["total_tokens"] !== "number") {
		return undefined;
	}
	return {
		...usage,
		prompt_tokens: prompt,
		completion_tokens: completion,
		total_tokens: typeof usage["total_tokens"] === "number" ? usage["total_tokens"] : prompt + completion,
	};
}

function extractAnthropicStreamResponse(raw: string): { response?: Record<string, unknown>; usage?: Record<string, unknown> } | undefined {
	let message: Record<string, unknown> | undefined;
	const content = new Map<number, Record<string, unknown>>();
	const toolInputJson = new Map<number, string>();
	let stopReason: unknown;
	let stopSequence: unknown;
	const usage: Record<string, unknown> = {};

	const mergeUsage = (value: unknown): void => {
		if (typeof value === "object" && value !== null && !Array.isArray(value)) {
			Object.assign(usage, value);
		}
	};
	const consumePayload = (payload: Record<string, unknown>): void => {
		const type = payload["type"];
		if (type === "message_start") {
			const startedMessage = payload["message"];
			if (typeof startedMessage !== "object" || startedMessage === null || Array.isArray(startedMessage)) {
				return;
			}
			message = { ...(startedMessage as Record<string, unknown>) };
			mergeUsage(message["usage"]);
			const initialContent = message["content"];
			if (Array.isArray(initialContent)) {
				for (const [index, block] of initialContent.entries()) {
					if (typeof block === "object" && block !== null && !Array.isArray(block)) {
						content.set(index, { ...(block as Record<string, unknown>) });
					}
				}
			}
			return;
		}
		if (type === "content_block_start" && typeof payload["index"] === "number") {
			const block = payload["content_block"];
			if (typeof block === "object" && block !== null && !Array.isArray(block)) {
				content.set(payload["index"], { ...(block as Record<string, unknown>) });
			}
			return;
		}
		if (type === "content_block_delta" && typeof payload["index"] === "number") {
			const index = payload["index"];
			const delta = payload["delta"];
			const block = content.get(index);
			if (typeof delta !== "object" || delta === null || Array.isArray(delta) || !block) {
				return;
			}
			const deltaRecord = delta as Record<string, unknown>;
			if (deltaRecord["type"] === "text_delta" && typeof deltaRecord["text"] === "string") {
				block["text"] = `${String(block["text"] ?? "")}${deltaRecord["text"]}`;
			} else if (deltaRecord["type"] === "thinking_delta" && typeof deltaRecord["thinking"] === "string") {
				block["thinking"] = `${String(block["thinking"] ?? "")}${deltaRecord["thinking"]}`;
			} else if (deltaRecord["type"] === "signature_delta" && typeof deltaRecord["signature"] === "string") {
				block["signature"] = `${String(block["signature"] ?? "")}${deltaRecord["signature"]}`;
			} else if (deltaRecord["type"] === "input_json_delta" && typeof deltaRecord["partial_json"] === "string") {
				toolInputJson.set(index, `${toolInputJson.get(index) ?? ""}${deltaRecord["partial_json"]}`);
			}
			return;
		}
		if (type === "content_block_stop" && typeof payload["index"] === "number") {
			const index = payload["index"];
			const partialJson = toolInputJson.get(index);
			const block = content.get(index);
			if (partialJson !== undefined && block) {
				try {
					block["input"] = JSON.parse(partialJson);
				} catch {
					block["input"] = partialJson;
				}
			}
			return;
		}
		if (type === "message_delta") {
			const delta = payload["delta"];
			if (typeof delta === "object" && delta !== null && !Array.isArray(delta)) {
				stopReason = (delta as Record<string, unknown>)["stop_reason"];
				stopSequence = (delta as Record<string, unknown>)["stop_sequence"];
			}
			mergeUsage(payload["usage"]);
		}
	};
	const consumeEvent = (event: string): void => {
		const data = event
			.split(/\r?\n/)
			.filter((line) => line.startsWith("data:"))
			.map((line) => line.slice(5).replace(/^ /, ""))
			.join("\n");
		if (!data || data === "[DONE]") {
			return;
		}
		try {
			const parsed: unknown = JSON.parse(data);
			if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
				consumePayload(parsed as Record<string, unknown>);
			}
		} catch {
			// Malformed diagnostic data must never affect the forwarded stream.
		}
	};
	let pending = raw;
	const drain = (): void => {
		while (true) {
			const boundary = /\r?\n\r?\n/.exec(pending);
			if (!boundary || boundary.index === undefined) {
				break;
			}
			consumeEvent(pending.slice(0, boundary.index));
			pending = pending.slice(boundary.index + boundary[0].length);
		}
		if (pending.trim()) {
			consumeEvent(pending);
			pending = "";
		}
	};

	drain();
	if (!message && content.size === 0) {
		return undefined;
	}
	const response = {
		...(message ?? {}),
		type: message?.["type"] ?? "message",
		role: message?.["role"] ?? "assistant",
		content: [...content.entries()].sort(([left], [right]) => left - right).map(([, block]) => block),
		stop_reason: stopReason !== undefined ? stopReason : message?.["stop_reason"],
		stop_sequence: stopSequence !== undefined ? stopSequence : message?.["stop_sequence"],
		usage: { ...usage },
	};
	return { response: response, usage: normalizeNativeUsage(response.usage) };
}

function extractNativeResponse(raw: string): { response?: Record<string, unknown>; usage?: Record<string, unknown> } {
	const candidates: Record<string, unknown>[] = [];
	const trimmed = raw.trim();
	if (trimmed.startsWith("{")) {
		try {
			candidates.push(JSON.parse(trimmed) as Record<string, unknown>);
		} catch {
			// Streaming tail or an oversized non-streaming response.
		}
	}
	for (const line of raw.split(/\r?\n/)) {
		if (!line.startsWith("data: ") || line === "data: [DONE]") {
			continue;
		}
		try {
			candidates.push(JSON.parse(line.slice(6)) as Record<string, unknown>);
		} catch {
			// Ignore non-JSON SSE data.
		}
	}
	let response: Record<string, unknown> | undefined;
	let usage: Record<string, unknown> | undefined;
	for (const candidate of candidates) {
		const nestedResponse =
			typeof candidate["response"] === "object" && candidate["response"] !== null
				? (candidate["response"] as Record<string, unknown>)
				: undefined;
		const message =
			typeof candidate["message"] === "object" && candidate["message"] !== null
				? (candidate["message"] as Record<string, unknown>)
				: undefined;
		response = nestedResponse ?? message ?? candidate;
		usage = normalizeNativeUsage(response["usage"]) ?? normalizeNativeUsage(candidate["usage"]) ?? usage;
	}
	return { response: response, usage: usage };
}

/**
 * Register before the compatibility Responses endpoint. Only CLIProxy models
 * match this route; all other providers fall through to the existing adapter.
 * @param expressRouter
 * @param router
 * @param runtime
 * @param db
 */
export function registerCliProxyNativeResponsesRoutes(
	expressRouter: ExpressRouter,
	router: LiteLLMRouter,
	runtime: CliProxyRuntimeManager,
	db: DrizzleDb,
): void {
	const handler = async (req: Request, res: Response): Promise<void> => {
		let deploymentRecorded = false;
		const body = req.body as Record<string, unknown>;
		const model = body["model"];
		if (typeof model !== "string" || model.length === 0) {
			throw ApiError.badRequest("model 字段缺失");
		}
		if (req.auth) {
			runCommonChecks(req.auth, model);
		}
		const candidate = router.getAvailableDeployment(model);
		if (!candidate || candidate.deployment.litellm_params.custom_llm_provider !== CLIPROXY_PROVIDER) {
			throw ApiError.unavailable(`CLIProxy 模型 ${model} 当前没有可用 deployment`);
		}
		const deploymentModel = candidate.deployment.litellm_params.model || model;
		const startTime = new Date();
		const reservation = await reserveEndpointSpend(db, router, req, model, body, {
			callType: CallType.ACompletion,
			startTime: startTime,
		});
		const lifecycle = createEndpointSpendLifecycle(reservation);
		lifecycle.markProviderStarted();
		const abortController = new AbortController();
		const abort = (): void => abortController.abort();
		req.once("aborted", abort);
		res.once("close", abort);
		const streaming = body["stream"] === true;
		const stopKeepAlive = streaming ? startResponsesSseKeepAlive(res) : undefined;
		// 声明在 try 外：catch 失败路径也要读取 request-only 上游日志。
		let upstreamLogContext: UpstreamLogContext | undefined;
		try {
			const upstreamUrl = `${runtime.baseUrl}/v1/responses`;
			const upstreamBody = applyReasoningEffortOverride(
				{ ...body, model: upstreamModel(deploymentModel) },
				candidate.deployment,
				"responses",
			);
			const logRequest = buildPassthroughLogRequest({
				url: upstreamUrl,
				method: "POST",
				headers: buildForwardHeaders(req, runtime.internalApiKey),
				body: upstreamBody,
				model: upstreamModel(deploymentModel),
			});
			upstreamLogContext = createUpstreamLogContext(logRequest);
			const upstream = await fetch(upstreamUrl, {
				method: "POST",
				headers: buildForwardHeaders(req, runtime.internalApiKey),
				body: JSON.stringify(upstreamBody),
				signal: abortController.signal,
			});
			// 与 registerNativeRoute 一致：responses 协议也参与 deployment 冷却记账。
			if (upstream.ok) {
				router.recordDeploymentSuccess(candidate.deployment);
			} else {
				router.recordDeploymentFailure(candidate.deployment, new Error(`CLIProxy returned HTTP ${upstream.status}`));
			}
			deploymentRecorded = true;
			const captured =
				streaming && !upstream.ok
					? await (async (): Promise<CapturedNativeResponse> => {
							const raw = await upstream.text();
							writeResponsesSseError(
								res,
								upstream.status,
								upstreamErrorMessage(raw, `CLIProxy returned HTTP ${upstream.status}`),
							);
							return { raw: raw, firstChunkAt: new Date() };
						})()
					: await pipeUpstreamResponse(upstream, res);
			const extracted = extractNativeResponse(captured.raw);
			upstreamLogContext = createUpstreamLogContext(logRequest, upstream, extracted.response);
			const spendInfo = buildDeploymentSpendInfo(candidate.deployment, upstreamUrl);
			if (req.auth) {
				const log = await buildSpendLogFromRequest({
					req: req,
					requestId: reservation?.requestId,
					auth: req.auth,
					callType: CallType.ACompletion,
					model: model,
					modelGroup: model,
					modelId: spendInfo.modelId,
					customLlmProvider: spendInfo.customLlmProvider,
					apiBase: spendInfo.apiBase,
					customCostPerToken: spendInfo.customCostPerToken,
					deploymentModel: spendInfo.deploymentModel,
					startTime: startTime,
					endTime: new Date(),
					completionStartTime: captured.firstChunkAt ?? new Date(),
					messages: body["input"],
					response: extracted.response,
					usage: extracted.usage,
					upstreamLogContext: upstreamLogContext,
					status: upstream.ok ? SpendLogStatus.Success : SpendLogStatus.Failure,
					error: upstream.ok ? undefined : new Error(`CLIProxy returned HTTP ${upstream.status}`),
				});
				await lifecycle.finalize(() => trackSpendLog(db, log).then(() => undefined));
			}
		} catch (error) {
			if (!deploymentRecorded && !(error instanceof DOMException && error.name === "AbortError")) {
				router.recordDeploymentFailure(candidate.deployment, error instanceof Error ? error : new Error(String(error)));
			}
			if (!lifecycle.isFinalized() && req.auth) {
				const log = await buildSpendLogFromRequest({
					req: req,
					requestId: reservation?.requestId,
					auth: req.auth,
					callType: CallType.ACompletion,
					model: model,
					startTime: startTime,
					endTime: new Date(),
					messages: body["input"],
					error: error,
					upstreamLogContext: upstreamLogContext,
					status: SpendLogStatus.Failure,
				});
				await lifecycle.finalize(() => trackSpendLog(db, log).then(() => undefined));
			}
			if (streaming && res.headersSent) {
				writeResponsesSseError(
					res,
					502,
					error instanceof Error && error.message.length > 0 ? error.message.slice(0, 4_096) : "CLIProxy request failed",
				);
				return;
			}
			throw error;
		} finally {
			stopKeepAlive?.();
			lifecycle.stop();
			req.removeListener("aborted", abort);
			res.removeListener("close", abort);
		}
	};

	for (const routePath of ["/v1/responses", "/responses", "/backend-api/codex/responses"]) {
		registerRoute(
			expressRouter,
			{ method: "post", path: routePath, matches: (req) => isCliProxyModel(router, req.body?.model) },
			handler,
		);
	}
}

interface NativeRouteOptions {
	readonly expressRouter: ExpressRouter;
	readonly router: LiteLLMRouter;
	readonly runtime: CliProxyRuntimeManager;
	readonly routePath: string;
	readonly upstreamPath: string;
	readonly anthropicNative?: boolean;
	readonly db: DrizzleDb;
}

function registerNativeRoute({
	expressRouter,
	router,
	runtime,
	routePath,
	upstreamPath,
	anthropicNative = false,
	db,
}: NativeRouteOptions): void {
	registerRoute(
		expressRouter,
		{ method: "post", path: routePath, matches: (req) => isCliProxyModel(router, req.body?.model) },
		async (req, res) => {
			let deploymentRecorded = false;
			let upstreamLogContext: UpstreamLogContext | undefined;
			const body = req.body as Record<string, unknown>;
			const model = body["model"];
			if (typeof model !== "string" || model.length === 0) {
				throw ApiError.badRequest("model 字段缺失");
			}
			if (req.auth) {
				runCommonChecks(req.auth, model);
			}
			const candidate = router.getAvailableDeployment(model);
			if (!candidate || candidate.deployment.litellm_params.custom_llm_provider !== CLIPROXY_PROVIDER) {
				throw ApiError.unavailable(`CLIProxy 模型 ${model} 当前没有可用 deployment`);
			}
			const deploymentModel = candidate.deployment.litellm_params.model || model;
			const callType = anthropicNative ? CallType.AMessages : CallType.ACompletion;
			const startTime = new Date();
			const reservation = await reserveEndpointSpend(db, router, req, model, body, { callType: callType, startTime: startTime });
			const lifecycle = createEndpointSpendLifecycle(reservation);
			lifecycle.markProviderStarted();
			const abortController = new AbortController();
			const abort = (): void => abortController.abort();
			req.once("aborted", abort);
			res.once("close", abort);
			try {
				const upstreamUrl = `${runtime.baseUrl}${upstreamPath}`;
				const upstreamBody = applyReasoningEffortOverride(
					{ ...body, model: upstreamModel(deploymentModel) },
					candidate.deployment,
					anthropicNative ? "anthropic" : "chat",
				);
				const upstreamHeaders = buildForwardHeaders(req, runtime.internalApiKey, anthropicNative);
				const upstreamRequest = {
					...buildPassthroughLogRequest({
						url: upstreamUrl,
						method: "POST",
						headers: upstreamHeaders,
						body: upstreamBody,
						model: upstreamModel(deploymentModel),
					}),
					stream: body["stream"] === true,
				};
				const upstreamPromise = fetch(upstreamUrl, {
					method: "POST",
					headers: upstreamHeaders,
					body: JSON.stringify(upstreamBody),
					signal: abortController.signal,
				});
				upstreamLogContext = createUpstreamLogContext(upstreamRequest);
				const upstream = await upstreamPromise;
				if (upstream.ok) {
					router.recordDeploymentSuccess(candidate.deployment);
				} else {
					router.recordDeploymentFailure(candidate.deployment, new Error(`CLIProxy returned HTTP ${upstream.status}`));
				}
				deploymentRecorded = true;
				const captured = await pipeUpstreamResponse(upstream, res);
				const extracted =
					(anthropicNative && body["stream"] === true ? extractAnthropicStreamResponse(captured.raw) : undefined) ??
					extractNativeResponse(captured.raw);
				upstreamLogContext = createUpstreamLogContext(upstreamRequest, upstream, extracted.response);
				const spendInfo = buildDeploymentSpendInfo(candidate.deployment, upstreamUrl);
				if (req.auth) {
					const log = await buildSpendLogFromRequest({
						req: req,
						requestId: reservation?.requestId,
						auth: req.auth,
						callType: callType,
						model: model,
						modelGroup: model,
						modelId: spendInfo.modelId,
						customLlmProvider: spendInfo.customLlmProvider,
						apiBase: spendInfo.apiBase,
						customCostPerToken: spendInfo.customCostPerToken,
						deploymentModel: spendInfo.deploymentModel,
						startTime: startTime,
						endTime: new Date(),
						completionStartTime: captured.firstChunkAt ?? new Date(),
						messages: body["messages"] ?? body["input"],
						proxyServerRequestBody: body,
						response: extracted.response,
						upstreamLogContext: upstreamLogContext,
						usage: extracted.usage,
						status: upstream.ok ? SpendLogStatus.Success : SpendLogStatus.Failure,
						error: upstream.ok ? undefined : new Error(`CLIProxy returned HTTP ${upstream.status}`),
					});
					await lifecycle.finalize(() => trackSpendLog(db, log).then(() => undefined));
				}
			} catch (error) {
				if (!deploymentRecorded && !(error instanceof DOMException && error.name === "AbortError")) {
					router.recordDeploymentFailure(candidate.deployment, error instanceof Error ? error : new Error(String(error)));
				}
				if (!lifecycle.isFinalized() && req.auth) {
					const log = await buildSpendLogFromRequest({
						req: req,
						requestId: reservation?.requestId,
						auth: req.auth,
						callType: callType,
						model: model,
						startTime: startTime,
						endTime: new Date(),
						messages: body["messages"] ?? body["input"],
						proxyServerRequestBody: body,
						error: error,
						upstreamLogContext: upstreamLogContext,
						status: SpendLogStatus.Failure,
					});
					await lifecycle.finalize(() => trackSpendLog(db, log).then(() => undefined));
				}
				throw error;
			} finally {
				lifecycle.stop();
				req.removeListener("aborted", abort);
				res.removeListener("close", abort);
			}
		},
	);
}

/**
 * OpenAI Chat Completions raw pass-through for CLIProxy deployments.
 * @param expressRouter
 * @param router
 * @param runtime
 * @param db
 */
export function registerCliProxyNativeChatRoutes(
	expressRouter: ExpressRouter,
	router: LiteLLMRouter,
	runtime: CliProxyRuntimeManager,
	db: DrizzleDb,
): void {
	registerNativeRoute({
		expressRouter: expressRouter,
		router: router,
		runtime: runtime,
		routePath: "/v1/chat/completions",
		upstreamPath: "/v1/chat/completions",
		db: db,
	});
	registerNativeRoute({
		expressRouter: expressRouter,
		router: router,
		runtime: runtime,
		routePath: "/chat/completions",
		upstreamPath: "/v1/chat/completions",
		db: db,
	});
}

/**
 * Anthropic Messages raw pass-through for CLIProxy deployments.
 * @param expressRouter
 * @param router
 * @param runtime
 * @param db
 */
export function registerCliProxyNativeAnthropicRoutes(
	expressRouter: ExpressRouter,
	router: LiteLLMRouter,
	runtime: CliProxyRuntimeManager,
	db: DrizzleDb,
): void {
	registerNativeRoute({
		expressRouter: expressRouter,
		router: router,
		runtime: runtime,
		routePath: "/v1/messages",
		upstreamPath: "/v1/messages",
		anthropicNative: true,
		db: db,
	});
}
