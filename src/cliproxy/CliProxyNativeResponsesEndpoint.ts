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
	const prompt =
		typeof usage["prompt_tokens"] === "number"
			? usage["prompt_tokens"]
			: typeof usage["input_tokens"] === "number"
				? usage["input_tokens"]
				: 0;
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
		try {
			const upstreamUrl = `${runtime.baseUrl}/v1/responses`;
			const upstream = await fetch(upstreamUrl, {
				method: "POST",
				headers: buildForwardHeaders(req, runtime.internalApiKey),
				body: JSON.stringify({ ...body, model: upstreamModel(deploymentModel) }),
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
				const upstream = await fetch(upstreamUrl, {
					method: "POST",
					headers: buildForwardHeaders(req, runtime.internalApiKey, anthropicNative),
					body: JSON.stringify({ ...body, model: upstreamModel(deploymentModel) }),
					signal: abortController.signal,
				});
				if (upstream.ok) {
					router.recordDeploymentSuccess(candidate.deployment);
				} else {
					router.recordDeploymentFailure(candidate.deployment, new Error(`CLIProxy returned HTTP ${upstream.status}`));
				}
				deploymentRecorded = true;
				const captured = await pipeUpstreamResponse(upstream, res);
				const extracted = extractNativeResponse(captured.raw);
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
						response: extracted.response,
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
						error: error,
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
