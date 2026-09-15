import type { Router as ExpressRouter, Request, Response } from "express";
import { registerRoute } from "../core/api/registerRoute";
import { ApiError } from "../core/api/ApiError";
import { runCommonChecks } from "../auth/AuthChecks";
import type { Router as LiteLLMRouter } from "../router/Router";
import type { CliProxyRuntimeManager } from "./CliProxyRuntimeManager";
import { CLIPROXY_PROVIDER } from "./CliProxyTypes";
import type { DrizzleDb } from "../core/db/Database";
import { createEndpointSpendLifecycle, reserveEndpointSpend } from "../spend/SpendReservation";
import { buildSpendLogFromRequest, checkpointActiveRequest, trackSpendLog } from "../spend/SpendTracker";
import { CallType, SpendLogStatus } from "../types/spend";
import { buildDeploymentSpendInfo } from "../router/RouterSpendInfo";
import { applyReasoningEffortOverride } from "../router/ReasoningEffortOverride";
import {
	attachUpstreamLogContext,
	createUpstreamLogContext,
	getUpstreamLogContext,
	type UpstreamLogContext,
} from "../router/UpstreamLogContext";
import { buildPassthroughLogRequest } from "./CliProxyUpstreamLogging";
import { createModuleLogger } from "../core/utils/logger";
import { CliProxyResponsesExecution, type CliProxyResponsesExecutionSnapshot } from "./CliProxyResponsesExecution";
import {
	executeWithFallbackChain,
	ProviderUpstreamError,
	type FallbackExecutionStats,
	type UpstreamAttempt,
} from "../proxy/AnthropicUpstreamDispatch";

const logger = createModuleLogger("CLIProxy:Responses");

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
const RESPONSES_CLIENT_DISCONNECT_TAIL_GRACE_MS = 250;
const RESPONSES_CLIENT_DISCONNECT_TEXT_TAIL_GRACE_MS = 1_500;
const RESPONSES_POST_OUTPUT_DRAIN_TIMEOUT_MS = 5_000;
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

interface PipeUpstreamResponseOptions {
	/**
	 * Responses 客户端可能在收到成功或 incomplete 终态后立即关闭下游 SSE，而 CLIProxy 的 HTTP body
	 * 尚未来得及返回 EOF。此时保留完整终态并按实际结果落库，而不是把收尾竞态误记为失败。
	 */
	readonly acceptResponsesTerminalOnAbort?: boolean;
}

const RESPONSES_SUCCESS_TERMINAL_EVENT_TYPES = new Set(["response.completed", "response.incomplete"]);

function parseResponsesSseEvent(event: string): Record<string, unknown> | null {
	const data = event
		.split(/\r?\n/)
		.filter((line) => line.startsWith("data:"))
		.map((line) => line.slice(5).replace(/^ /, ""))
		.join("\n");
	if (!data) {
		return null;
	}
	try {
		const payload: unknown = JSON.parse(data);
		return typeof payload === "object" && payload !== null && !Array.isArray(payload) ? (payload as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

function hasCompleteResponsesTerminalEvent(raw: string): boolean {
	const eventBoundary = /\r?\n\r?\n/g;
	let eventStart = 0;
	let boundary: RegExpExecArray | null;
	while ((boundary = eventBoundary.exec(raw)) !== null) {
		const event = raw.slice(eventStart, boundary.index);
		eventStart = eventBoundary.lastIndex;
		const payload = parseResponsesSseEvent(event);
		if (payload && RESPONSES_SUCCESS_TERMINAL_EVENT_TYPES.has(String(payload["type"] ?? ""))) {
			return true;
		}
	}
	return false;
}

function isAbortError(error: unknown): boolean {
	return typeof error === "object" && error !== null && (error as { name?: unknown }).name === "AbortError";
}

class ClientDisconnectedError extends Error {
	readonly statusCode = 499;

	constructor(source: string) {
		super(`Client disconnected before the upstream response reached a terminal event (${source}).`);
		this.name = "ClientDisconnected";
	}
}

async function pipeUpstreamResponse(
	upstream: globalThis.Response,
	res: Response,
	execution?: CliProxyResponsesExecution,
	options: PipeUpstreamResponseOptions = {},
): Promise<CapturedNativeResponse> {
	let fallbackRaw = "";
	let fallbackFirstChunkAt: Date | null = null;
	const recordDecodedChunk = (chunk: string): void => {
		if (!chunk) {
			return;
		}
		if (execution) {
			execution.recordDecodedChunk(chunk);
			return;
		}
		fallbackFirstChunkAt ??= new Date();
		fallbackRaw += chunk;
		if (fallbackRaw.length > 2_000_000) {
			fallbackRaw = fallbackRaw.slice(-2_000_000);
		}
	};
	const captured = (): CapturedNativeResponse => ({
		raw: execution?.snapshot.raw ?? fallbackRaw,
		firstChunkAt: execution?.snapshot.firstChunkAt ?? fallbackFirstChunkAt,
	});
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
		return captured();
	}
	const reader = upstream.body.getReader();
	const decoder = new TextDecoder();
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}
			const decoded = decoder.decode(value, { stream: true });
			recordDecodedChunk(decoded);
			if (!res.destroyed && !res.writableEnded) {
				res.write(Buffer.from(value));
			}
		}
		const decodedTail = decoder.decode();
		recordDecodedChunk(decodedTail);
		if (!res.writableEnded) {
			res.end();
		}
		return captured();
	} catch (error) {
		const decodedTail = decoder.decode();
		recordDecodedChunk(decodedTail);
		const capture = captured();
		if (options.acceptResponsesTerminalOnAbort === true && isAbortError(error) && hasCompleteResponsesTerminalEvent(capture.raw)) {
			return capture;
		}
		throw error;
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
	let responsesBase: Record<string, unknown> | undefined;
	let responsesEventSeen = false;
	let responsesTerminalSeen = false;
	let lastResponsesEvent: Record<string, unknown> | undefined;
	let partialOutputText = "";
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
		const type = candidate["type"];
		if (typeof type === "string" && type.startsWith("response.")) {
			responsesEventSeen = true;
			lastResponsesEvent = candidate;
			responsesBase = nestedResponse ?? responsesBase;
			responsesTerminalSeen ||= ["response.completed", "response.incomplete", "response.failed", "response.cancelled"].includes(type);
			if (type === "response.output_text.delta" && typeof candidate["delta"] === "string") {
				partialOutputText += candidate["delta"];
			} else if (type === "response.output_text.done" && typeof candidate["text"] === "string") {
				partialOutputText = candidate["text"];
			}
		}
	}
	if (responsesEventSeen && !responsesTerminalSeen) {
		response = {
			...(responsesBase ?? {}),
			status: responsesBase?.["status"] ?? "in_progress",
			partial_output_text: partialOutputText || undefined,
			last_event: lastResponsesEvent,
		};
	}
	return { response: response, usage: usage };
}

function responsesExecutionMetadata(
	snapshot: CliProxyResponsesExecutionSnapshot,
	extracted: ReturnType<typeof extractNativeResponse>,
	finalStatus?: SpendLogStatus,
): Record<string, unknown> {
	let state = "running";
	if (finalStatus === SpendLogStatus.Success) {
		state = "completed";
	} else if (finalStatus === SpendLogStatus.Cancelled) {
		state = "client_cancelled";
	} else if (finalStatus === SpendLogStatus.Failure) {
		state = snapshot.cancellationRequested ? "cancelled" : "failed";
	} else if (snapshot.terminalReceived) {
		state = "terminal_received";
	} else if (snapshot.cancellationRequested) {
		state = "cancel_requested";
	}
	return {
		state: state,
		client_disconnected: snapshot.clientDisconnected,
		cancel_requested: snapshot.cancellationRequested,
		cancel_strategy: snapshot.cancellationStrategy,
		cancel_source: snapshot.cancellationSource,
		client_disconnected_at: snapshot.cancellationRequestedAt?.toISOString() ?? null,
		upstream_abort_issued: snapshot.upstreamAbortIssued,
		upstream_abort_issued_at: snapshot.upstreamAbortIssuedAt?.toISOString() ?? null,
		completed_output_received: snapshot.completedOutputReceived,
		terminal_received: snapshot.terminalReceived,
		terminal_received_at: snapshot.terminalReceivedAt?.toISOString() ?? null,
		last_sse_event: snapshot.lastSseEventType ?? null,
		last_sse_event_at: snapshot.lastSseEventAt?.toISOString() ?? null,
		first_chunk_at: snapshot.firstChunkAt?.toISOString() ?? null,
		captured_characters: snapshot.capturedCharacters,
		captured_truncated: snapshot.capturedTruncated,
		response: extracted.response ?? null,
		usage: extracted.usage ?? null,
	};
}

function responsesTerminalFailure(response: Record<string, unknown> | undefined): Error | undefined {
	const status = response?.["status"];
	if (status !== "failed" && status !== "cancelled" && status !== "canceled") {
		return undefined;
	}
	const error = response?.["error"];
	const message =
		typeof error === "object" && error !== null && typeof (error as Record<string, unknown>)["message"] === "string"
			? String((error as Record<string, unknown>)["message"])
			: `CLIProxy Responses request ${status}`;
	return new Error(message);
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
		const streaming = body["stream"] === true;
		const stopKeepAlive = streaming ? startResponsesSseKeepAlive(res) : undefined;
		const upstreamUrl = `${runtime.baseUrl}/v1/responses`;
		const spendInfo = buildDeploymentSpendInfo(candidate.deployment, upstreamUrl);
		const execution = new CliProxyResponsesExecution({
			postOutputDrainTimeoutMs: RESPONSES_POST_OUTPUT_DRAIN_TIMEOUT_MS,
			terminalTailGraceMs: RESPONSES_CLIENT_DISCONNECT_TAIL_GRACE_MS,
			textTerminalTailGraceMs: RESPONSES_CLIENT_DISCONNECT_TEXT_TAIL_GRACE_MS,
			onCheckpoint:
				reservation?.requestId && db
					? async (snapshot): Promise<void> => {
							const extracted = extractNativeResponse(snapshot.raw);
							await checkpointActiveRequest(db, reservation.requestId, responsesExecutionMetadata(snapshot, extracted));
						}
					: undefined,
			onCheckpointError: (error): void => {
				logger.warn("Responses execution checkpoint failed", { error: error, requestId: reservation?.requestId });
			},
		});
		const cancelExecution = (): void => execution.requestClientCancellation("request_aborted");
		const cancelOnResponseClose = (): void => {
			if (!res.writableEnded) {
				execution.requestClientCancellation("response_closed");
			}
		};
		req.once("aborted", cancelExecution);
		res.once("close", cancelOnResponseClose);
		try {
			await execution.start(async (work): Promise<void> => {
				let upstreamLogContext: UpstreamLogContext | undefined;
				let upstream: globalThis.Response | undefined;
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

				const finalizeLog = async (error: unknown, status: SpendLogStatus): Promise<void> => {
					if (lifecycle.isFinalized() || !req.auth) {
						return;
					}
					const snapshot = work.snapshot;
					const extracted = extractNativeResponse(snapshot.raw);
					if (upstream) {
						upstreamLogContext = createUpstreamLogContext(logRequest, upstream, extracted.response);
					}
					await work.flushCheckpoints();
					const endTime = new Date();
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
						endTime: endTime,
						completionStartTime: snapshot.firstChunkAt ?? endTime,
						messages: body["input"],
						response: extracted.response,
						usage: extracted.usage,
						error: error,
						upstreamLogContext: upstreamLogContext,
						status: status,
						metadataOverrides: { responses_execution: responsesExecutionMetadata(snapshot, extracted, status) },
					});
					await lifecycle.finalize(() => trackSpendLog(db, log).then(() => undefined));
				};

				try {
					upstream = await fetch(upstreamUrl, {
						method: "POST",
						headers: buildForwardHeaders(req, runtime.internalApiKey),
						body: JSON.stringify(upstreamBody),
						signal: work.signal,
					});
					upstreamLogContext = createUpstreamLogContext(logRequest, upstream);
					if (upstream.ok) {
						router.recordDeploymentSuccess(candidate.deployment);
					} else {
						router.recordDeploymentFailure(candidate.deployment, new Error(`CLIProxy returned HTTP ${upstream.status}`));
					}
					deploymentRecorded = true;
					if (streaming && !upstream.ok) {
						const raw = await upstream.text();
						work.recordDecodedChunk(raw);
						writeResponsesSseError(
							res,
							upstream.status,
							upstreamErrorMessage(raw, `CLIProxy returned HTTP ${upstream.status}`),
						);
					} else {
						await pipeUpstreamResponse(upstream, res, work, { acceptResponsesTerminalOnAbort: true });
					}
					const extracted = extractNativeResponse(work.snapshot.raw);
					const upstreamError = upstream.ok
						? responsesTerminalFailure(extracted.response)
						: new Error(`CLIProxy returned HTTP ${upstream.status}`);
					await finalizeLog(upstreamError, upstreamError ? SpendLogStatus.Failure : SpendLogStatus.Success);
				} catch (error) {
					if (!deploymentRecorded && !isAbortError(error)) {
						router.recordDeploymentFailure(candidate.deployment, error instanceof Error ? error : new Error(String(error)));
					}
					const snapshot = work.snapshot;
					const clientCancellation = snapshot.clientDisconnected && snapshot.upstreamAbortIssued && work.signal.aborted;
					await finalizeLog(
						clientCancellation ? new ClientDisconnectedError(snapshot.cancellationSource) : error,
						clientCancellation ? SpendLogStatus.Cancelled : SpendLogStatus.Failure,
					);
					if (streaming && res.headersSent) {
						if (work.snapshot.clientDisconnected) {
							if (!res.destroyed && !res.writableEnded) {
								res.end();
							}
						} else {
							writeResponsesSseError(
								res,
								502,
								error instanceof Error && error.message.length > 0
									? error.message.slice(0, 4_096)
									: "CLIProxy request failed",
							);
						}
						return;
					}
					throw error;
				}
			});
		} finally {
			stopKeepAlive?.();
			lifecycle.stop();
			req.removeListener("aborted", cancelExecution);
			res.removeListener("close", cancelOnResponseClose);
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

interface NativeAnthropicExecution {
	readonly upstream: globalThis.Response;
	readonly attempt: UpstreamAttempt;
	readonly request: ReturnType<typeof buildPassthroughLogRequest> & { readonly stream: boolean };
}

function parsedUpstreamErrorBody(raw: string): unknown {
	if (!raw) {
		return undefined;
	}
	try {
		return JSON.parse(raw) as unknown;
	} catch {
		return { raw: raw.slice(0, 4_096) };
	}
}

function buildFallbackAnthropicHeaders(req: Request, attempt: UpstreamAttempt): Headers {
	const headers = new Headers({ ...attempt.upstreamHeaders, "Content-Type": "application/json" });
	for (const name of ["anthropic-version", "anthropic-beta"] as const) {
		const value = req.headers[name];
		if (typeof value === "string" && value.length > 0) {
			headers.set(name, value);
		}
	}
	return headers;
}

async function executeNativeAnthropicWithFallback(args: {
	readonly req: Request;
	readonly router: LiteLLMRouter;
	readonly runtime: CliProxyRuntimeManager;
	readonly upstreamPath: string;
	readonly body: Record<string, unknown>;
	readonly model: string;
	readonly signal: AbortSignal;
	readonly stats: FallbackExecutionStats;
}): Promise<NativeAnthropicExecution> {
	const { req, router, runtime, upstreamPath, body, model, signal, stats } = args;
	const requestApiKey = typeof body["api_key"] === "string" ? body["api_key"] : undefined;
	const requestAnthropicVersion =
		typeof body["anthropic_version"] === "string"
			? body["anthropic_version"]
			: typeof req.headers["anthropic-version"] === "string"
				? req.headers["anthropic-version"]
				: undefined;

	return executeWithFallbackChain(
		router,
		model,
		requestApiKey,
		requestAnthropicVersion,
		async (attempt) => {
			const cliProxyAttempt = attempt.deployment.litellm_params.custom_llm_provider === CLIPROXY_PROVIDER;
			const upstreamUrl = cliProxyAttempt ? `${runtime.baseUrl}${upstreamPath}` : attempt.upstreamUrl;
			const upstreamBody = applyReasoningEffortOverride({ ...body, model: attempt.upstreamModel }, attempt.deployment, "anthropic");
			const upstreamHeaders = cliProxyAttempt
				? buildForwardHeaders(req, runtime.internalApiKey, true)
				: buildFallbackAnthropicHeaders(req, attempt);
			const upstreamRequest = {
				...buildPassthroughLogRequest({
					url: upstreamUrl,
					method: "POST",
					headers: upstreamHeaders,
					body: upstreamBody,
					model: attempt.upstreamModel,
				}),
				stream: body["stream"] === true,
			};
			const upstream = await fetch(upstreamUrl, {
				method: "POST",
				headers: upstreamHeaders,
				body: JSON.stringify(upstreamBody),
				signal: signal,
			});
			if (!upstream.ok) {
				const raw = await upstream.text().catch(() => "");
				const context = createUpstreamLogContext(upstreamRequest, upstream, parsedUpstreamErrorBody(raw));
				const providerName = cliProxyAttempt ? "CLIProxy" : "Provider";
				throw attachUpstreamLogContext(
					new ProviderUpstreamError(upstream.status, `${providerName} returned HTTP ${upstream.status}: ${raw.slice(0, 500)}`),
					context,
				);
			}
			return { upstream: upstream, attempt: attempt, request: upstreamRequest };
		},
		stats,
	);
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
			const fallbackStats: FallbackExecutionStats = { fallbackDepth: 0, fallbackModels: [] };
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
				let executedDeployment = candidate.deployment;
				let upstreamUrl: string;
				let upstreamRequest: ReturnType<typeof buildPassthroughLogRequest> & { readonly stream: boolean };
				let upstream: globalThis.Response;
				if (anthropicNative) {
					const execution = await executeNativeAnthropicWithFallback({
						req: req,
						router: router,
						runtime: runtime,
						upstreamPath: upstreamPath,
						body: body,
						model: model,
						signal: abortController.signal,
						stats: fallbackStats,
					});
					upstream = execution.upstream;
					upstreamRequest = execution.request;
					executedDeployment = execution.attempt.deployment;
					upstreamUrl = upstreamRequest.url;
					deploymentRecorded = true;
				} else {
					upstreamUrl = `${runtime.baseUrl}${upstreamPath}`;
					const upstreamBody = applyReasoningEffortOverride(
						{ ...body, model: upstreamModel(deploymentModel) },
						candidate.deployment,
						"chat",
					);
					const upstreamHeaders = buildForwardHeaders(req, runtime.internalApiKey, false);
					upstreamRequest = {
						...buildPassthroughLogRequest({
							url: upstreamUrl,
							method: "POST",
							headers: upstreamHeaders,
							body: upstreamBody,
							model: upstreamModel(deploymentModel),
						}),
						stream: body["stream"] === true,
					};
					upstreamLogContext = createUpstreamLogContext(upstreamRequest);
					upstream = await fetch(upstreamUrl, {
						method: "POST",
						headers: upstreamHeaders,
						body: JSON.stringify(upstreamBody),
						signal: abortController.signal,
					});
					if (upstream.ok) {
						router.recordDeploymentSuccess(candidate.deployment);
					} else {
						router.recordDeploymentFailure(candidate.deployment, new Error(`CLIProxy returned HTTP ${upstream.status}`));
					}
					deploymentRecorded = true;
				}
				const captured = await pipeUpstreamResponse(upstream, res);
				const extracted =
					(anthropicNative && body["stream"] === true ? extractAnthropicStreamResponse(captured.raw) : undefined) ??
					extractNativeResponse(captured.raw);
				upstreamLogContext = createUpstreamLogContext(upstreamRequest, upstream, extracted.response);
				const spendInfo = buildDeploymentSpendInfo(executedDeployment, upstreamUrl);
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
						attemptedRetries: anthropicNative ? fallbackStats.fallbackDepth : undefined,
						maxRetries: anthropicNative ? router.maxFallbacks : undefined,
						fallbackModels: anthropicNative ? fallbackStats.fallbackModels : undefined,
						modelResolutionChain: anthropicNative ? fallbackStats.modelResolutionChain : undefined,
						routingTrace: anthropicNative ? fallbackStats.routingTrace : undefined,
					});
					await lifecycle.finalize(() => trackSpendLog(db, log).then(() => undefined));
				}
			} catch (error) {
				if (!anthropicNative && !deploymentRecorded && !(error instanceof DOMException && error.name === "AbortError")) {
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
						upstreamLogContext: getUpstreamLogContext(error) ?? upstreamLogContext,
						status: SpendLogStatus.Failure,
						attemptedRetries: anthropicNative ? fallbackStats.fallbackDepth : undefined,
						maxRetries: anthropicNative ? router.maxFallbacks : undefined,
						fallbackModels: anthropicNative ? fallbackStats.fallbackModels : undefined,
						modelResolutionChain: anthropicNative ? fallbackStats.modelResolutionChain : undefined,
						routingTrace: anthropicNative ? fallbackStats.routingTrace : undefined,
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
