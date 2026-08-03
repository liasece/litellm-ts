import type { Request, Response, Router as ExpressRouter } from "express";
import { runCommonChecks } from "../auth/AuthChecks";
import { ApiError } from "../core/api/ApiError";
import { registerRoute, type HttpMethodLiteral } from "../core/api/registerRoute";
import type { DrizzleDb } from "../core/db/Database";
import type { Router as LiteLLMRouter } from "../router/Router";
import { buildDeploymentSpendInfo } from "../router/RouterSpendInfo";
import { createEndpointSpendLifecycle, reserveEndpointSpend } from "../spend/SpendReservation";
import { buildSpendLogFromRequest, trackSpendLog } from "../spend/SpendTracker";
import { CallType, SpendLogStatus } from "../types/spend";
import type { CliProxyRuntimeManager } from "./CliProxyRuntimeManager";
import { CLIPROXY_PROVIDER } from "./CliProxyTypes";

const MAX_PASSTHROUGH_BODY_BYTES = 50 * 1024 * 1024;
const DEFAULT_MAX_CAPTURED_RESPONSE_BYTES = 24 * 1024 * 1024;
const MAX_CAPTURED_RESPONSE_BYTES =
	Number(process.env.MAX_CLIPROXY_CAPTURED_RESPONSE_BYTES ?? DEFAULT_MAX_CAPTURED_RESPONSE_BYTES) ||
	DEFAULT_MAX_CAPTURED_RESPONSE_BYTES;
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

type ModelLocation = "body" | "path" | "optional";

interface NativePassthroughRoute {
	readonly method: HttpMethodLiteral;
	readonly path: string;
	readonly upstreamPath: string;
	readonly modelLocation: ModelLocation;
	readonly callType?: CallType;
	readonly conflictsWithLiteLlmRoute?: boolean;
}

interface ResolvedCliProxyModel {
	readonly publicModel: string;
	readonly upstreamModel: string;
}

interface PreparedRequestBody {
	readonly bytes: Buffer | undefined;
	readonly parsed: Record<string, unknown> | undefined;
	readonly logBody: Record<string, unknown> | undefined;
	readonly requestedModel: string | undefined;
	readonly contentType: string | undefined;
}

interface CapturedResponse {
	readonly raw: string;
	readonly firstChunkAt: Date | null;
	readonly truncated: boolean;
}

interface NativeSpendContext {
	readonly db: DrizzleDb;
	readonly req: Request;
	readonly router: LiteLLMRouter;
	readonly resolved: ResolvedCliProxyModel;
	readonly route: NativePassthroughRoute;
	readonly upstreamUrl: string;
	readonly startTime: Date;
	readonly requestId: string | undefined;
	readonly body: PreparedRequestBody;
	readonly captured?: CapturedResponse;
	readonly status: SpendLogStatus;
	readonly error?: unknown;
}

const NATIVE_HTTP_ROUTES: readonly NativePassthroughRoute[] = [
	{
		method: "post",
		path: "/v1/completions",
		upstreamPath: "/v1/completions",
		modelLocation: "body",
		conflictsWithLiteLlmRoute: true,
	},
	{
		method: "post",
		path: "/v1/images/edits",
		upstreamPath: "/v1/images/edits",
		modelLocation: "body",
		callType: CallType.AImageGeneration,
	},
	{ method: "post", path: "/v1/videos", upstreamPath: "/v1/videos", modelLocation: "body" },
	{ method: "post", path: "/v1/videos/generations", upstreamPath: "/v1/videos/generations", modelLocation: "body" },
	{ method: "post", path: "/v1/videos/edits", upstreamPath: "/v1/videos/edits", modelLocation: "body" },
	{ method: "post", path: "/v1/videos/extensions", upstreamPath: "/v1/videos/extensions", modelLocation: "body" },
	{ method: "get", path: "/v1/videos/:request_id", upstreamPath: "/v1/videos/:request_id", modelLocation: "optional" },
	{ method: "post", path: "/openai/v1/videos", upstreamPath: "/openai/v1/videos", modelLocation: "body" },
	{
		method: "get",
		path: "/openai/v1/videos/:video_id",
		upstreamPath: "/openai/v1/videos/:video_id",
		modelLocation: "optional",
	},
	{
		method: "get",
		path: "/openai/v1/videos/:video_id/content",
		upstreamPath: "/openai/v1/videos/:video_id/content",
		modelLocation: "optional",
	},
	{
		method: "post",
		path: "/v1/messages/count_tokens",
		upstreamPath: "/v1/messages/count_tokens",
		modelLocation: "body",
		callType: CallType.AMessages,
		conflictsWithLiteLlmRoute: true,
	},
	{
		method: "post",
		path: "/v1/responses/compact",
		upstreamPath: "/v1/responses/compact",
		modelLocation: "body",
	},
	{ method: "post", path: "/v1/alpha/search", upstreamPath: "/v1/alpha/search", modelLocation: "body" },
	{
		method: "post",
		path: "/backend-api/codex/responses/compact",
		upstreamPath: "/v1/responses/compact",
		modelLocation: "body",
	},
	{
		method: "post",
		path: "/backend-api/codex/alpha/search",
		upstreamPath: "/v1/alpha/search",
		modelLocation: "body",
	},
	{ method: "post", path: "/v1/live", upstreamPath: "/v1/live", modelLocation: "optional" },
	{ method: "get", path: "/v1/live/:call_id", upstreamPath: "/v1/live/:call_id", modelLocation: "optional" },
	{ method: "post", path: "/v1/realtime/calls", upstreamPath: "/v1/realtime/calls", modelLocation: "optional" },
	{
		method: "get",
		path: "/v1/realtime/calls/:call_id",
		upstreamPath: "/v1/realtime/calls/:call_id",
		modelLocation: "optional",
	},
	{ method: "get", path: "/v1/realtime", upstreamPath: "/v1/realtime", modelLocation: "optional" },
	{ method: "get", path: "/v1beta/models", upstreamPath: "/v1beta/models", modelLocation: "optional" },
	{ method: "post", path: "/v1beta/interactions", upstreamPath: "/v1beta/interactions", modelLocation: "body" },
	{ method: "post", path: "/v1beta/models/*", upstreamPath: "/v1beta/models/*", modelLocation: "path" },
	{ method: "get", path: "/v1beta/models/*", upstreamPath: "/v1beta/models/*", modelLocation: "path" },
];

function stripCliProxyPrefix(value: string): string {
	return value.startsWith(`${CLIPROXY_PROVIDER}/`) ? value.slice(CLIPROXY_PROVIDER.length + 1) : value;
}

function isCliProxyDeployment(router: LiteLLMRouter, model: unknown): boolean {
	if (typeof model !== "string") {
		return false;
	}
	const candidate = router.getAvailableDeployment(model);
	return candidate?.deployment.litellm_params.custom_llm_provider === CLIPROXY_PROVIDER;
}

function resolveCliProxyModel(router: LiteLLMRouter, requestedModel: string): ResolvedCliProxyModel | null {
	const direct = router.getAvailableDeployment(requestedModel);
	if (direct?.deployment.litellm_params.custom_llm_provider === CLIPROXY_PROVIDER) {
		return {
			publicModel: requestedModel,
			upstreamModel: stripCliProxyPrefix(direct.deployment.litellm_params.model || requestedModel),
		};
	}
	const deployment = (router.getDeployments?.() ?? []).find(
		(item) =>
			item.litellm_params.custom_llm_provider === CLIPROXY_PROVIDER &&
			stripCliProxyPrefix(item.litellm_params.model) === stripCliProxyPrefix(requestedModel),
	);
	if (!deployment) {
		return null;
	}
	return {
		publicModel: deployment.model_name,
		upstreamModel: stripCliProxyPrefix(deployment.litellm_params.model),
	};
}

function requestContentType(req: Request): string | undefined {
	const value = req.headers["content-type"];
	return Array.isArray(value) ? value[0] : value;
}

function bodyModel(value: unknown): string | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	if (typeof record["model"] === "string") {
		return record["model"];
	}
	const session = record["session"];
	if (typeof session === "object" && session !== null && !Array.isArray(session)) {
		const nestedModel = (session as Record<string, unknown>)["model"];
		if (typeof nestedModel === "string") {
			return nestedModel;
		}
	}
	return undefined;
}

function rawBodyModel(bytes: Buffer, contentType: string | undefined): string | undefined {
	const source = bytes.toString("utf8");
	if (contentType?.includes("application/x-www-form-urlencoded")) {
		const value = new URLSearchParams(source).get("model");
		return value && value.length > 0 ? value : undefined;
	}
	const modelPart = source.search(/name="model"/i);
	if (modelPart >= 0) {
		const headerEnd = source.indexOf("\r\n\r\n", modelPart);
		const valueEnd = headerEnd >= 0 ? source.indexOf("\r\n", headerEnd + 4) : -1;
		if (headerEnd >= 0 && valueEnd > headerEnd) {
			return source.slice(headerEnd + 4, valueEnd).trim();
		}
	}
	const jsonMatch = /"model"\s*:\s*"([^"]+)"/i.exec(source);
	return jsonMatch?.[1];
}

async function readRawRequestBody(req: Request): Promise<Buffer> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of req) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
		size += buffer.length;
		if (size > MAX_PASSTHROUGH_BODY_BYTES) {
			throw new ApiError(413, "CLIProxy 原生透传请求体超过 50 MB", "request_too_large");
		}
		chunks.push(buffer);
	}
	return Buffer.concat(chunks);
}

function appendFormLogValue(target: Record<string, unknown>, key: string, value: unknown): void {
	const current = target[key];
	if (current === undefined) {
		target[key] = value;
	} else if (Array.isArray(current)) {
		current.push(value);
	} else {
		target[key] = [current, value];
	}
}

async function multipartLogBody(bytes: Buffer, contentType: string): Promise<Record<string, unknown> | undefined> {
	try {
		const formData = await new Response(bytes as never, {
			headers: { "content-type": contentType },
		}).formData();
		const result: Record<string, unknown> = {};
		for (const [key, value] of formData.entries()) {
			if (typeof value === "string") {
				appendFormLogValue(result, key, value);
				continue;
			}
			appendFormLogValue(result, key, {
				filename: value.name,
				content_type: value.type || "application/octet-stream",
				size_bytes: value.size,
			});
		}
		return result;
	} catch {
		// Malformed provider-specific multipart bodies still pass through unchanged.
		return undefined;
	}
}

function urlEncodedLogBody(bytes: Buffer): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const [key, value] of new URLSearchParams(bytes.toString("utf8")).entries()) {
		appendFormLogValue(result, key, value);
	}
	return result;
}

async function prepareRequestBody(req: Request): Promise<PreparedRequestBody> {
	const contentType = requestContentType(req);
	if (contentType?.includes("application/json")) {
		const parsed =
			typeof req.body === "object" && req.body !== null && !Array.isArray(req.body) ? (req.body as Record<string, unknown>) : {};
		return {
			bytes: Buffer.from(JSON.stringify(parsed)),
			parsed: parsed,
			logBody: parsed,
			requestedModel: bodyModel(parsed),
			contentType: contentType,
		};
	}
	if (req.method === "GET" || req.method === "HEAD") {
		return { bytes: undefined, parsed: undefined, logBody: undefined, requestedModel: undefined, contentType: contentType };
	}
	const bytes = await readRawRequestBody(req);
	const logBody = contentType?.includes("multipart/form-data")
		? await multipartLogBody(bytes, contentType)
		: contentType?.includes("application/x-www-form-urlencoded")
			? urlEncodedLogBody(bytes)
			: undefined;
	return {
		bytes: bytes,
		parsed: undefined,
		logBody: logBody,
		requestedModel: rawBodyModel(bytes, contentType),
		contentType: contentType,
	};
}

function rewriteModelFields(value: unknown, requestedModel: string, upstreamModel: string): unknown {
	if (Array.isArray(value)) {
		return value.map((item) => rewriteModelFields(item, requestedModel, upstreamModel));
	}
	if (typeof value !== "object" || value === null) {
		return value;
	}
	const result: Record<string, unknown> = {};
	for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
		result[key] = key === "model" && item === requestedModel ? upstreamModel : rewriteModelFields(item, requestedModel, upstreamModel);
	}
	return result;
}

function rewritePreparedBody(body: PreparedRequestBody, resolved: ResolvedCliProxyModel | null): PreparedRequestBody {
	if (!resolved || !body.bytes || !body.requestedModel) {
		return body;
	}
	if (body.parsed) {
		const parsed = rewriteModelFields(body.parsed, body.requestedModel, resolved.upstreamModel) as Record<string, unknown>;
		return {
			bytes: Buffer.from(JSON.stringify(parsed)),
			parsed: parsed,
			logBody: body.logBody,
			requestedModel: body.requestedModel,
			contentType: body.contentType,
		};
	}
	const source = body.bytes.toString("latin1");
	return {
		bytes: Buffer.from(source.split(body.requestedModel).join(resolved.upstreamModel), "latin1"),
		parsed: undefined,
		logBody: body.logBody,
		requestedModel: body.requestedModel,
		contentType: body.contentType,
	};
}

function extractPathModel(req: Request): string | undefined {
	const match = /^\/v1beta\/models\/(.+?)(?::[^/]+)?$/.exec(req.path);
	if (!match?.[1]) {
		return undefined;
	}
	try {
		return decodeURIComponent(match[1]);
	} catch {
		return match[1];
	}
}

function interpolateParams(pathTemplate: string, req: Request): string {
	let result = pathTemplate;
	for (const [key, value] of Object.entries(req.params)) {
		if (key === "0") {
			continue;
		}
		const parameter = Array.isArray(value) ? value[0] : value;
		result = result.replace(`:${key}`, encodeURIComponent(parameter ?? ""));
	}
	if (pathTemplate.includes("*")) {
		const wildcard = req.params[0];
		result = result.replace("*", Array.isArray(wildcard) ? (wildcard[0] ?? "") : (wildcard ?? ""));
	}
	return result;
}

function upstreamRequestPath(
	route: NativePassthroughRoute,
	req: Request,
	resolved: ResolvedCliProxyModel | null,
	requestedModel: string | undefined,
): string {
	let path = interpolateParams(route.upstreamPath, req);
	if (route.modelLocation === "path" && resolved && requestedModel) {
		const encodedRequested = encodeURIComponent(requestedModel);
		const encodedUpstream = encodeURIComponent(resolved.upstreamModel);
		path = path.replace(requestedModel, resolved.upstreamModel).replace(encodedRequested, encodedUpstream);
	}
	const queryIndex = req.originalUrl.indexOf("?");
	return queryIndex >= 0 ? `${path}${req.originalUrl.slice(queryIndex)}` : path;
}

function buildForwardHeaders(req: Request, internalApiKey: string, contentType: string | undefined): Headers {
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
	if (contentType) {
		headers.set("Content-Type", contentType);
	}
	return headers;
}

async function pipeResponse(upstream: globalThis.Response, res: Response): Promise<CapturedResponse> {
	res.status(upstream.status);
	upstream.headers.forEach((value, key) => {
		if (!RESPONSE_BLOCKED_HEADERS.has(key.toLowerCase())) {
			res.setHeader(key, value);
		}
	});
	if (!upstream.body) {
		res.end();
		return { raw: "", firstChunkAt: null, truncated: false };
	}
	const reader = upstream.body.getReader();
	const decoder = new TextDecoder();
	let captured = "";
	let capturedBytes = 0;
	let captureTruncated = false;
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
			if (!captureTruncated) {
				const remaining = MAX_CAPTURED_RESPONSE_BYTES - capturedBytes;
				if (value.byteLength <= remaining) {
					captured += decoder.decode(value, { stream: true });
					capturedBytes += value.byteLength;
				} else {
					if (remaining > 0) {
						captured += decoder.decode(value.slice(0, remaining), { stream: true });
						capturedBytes += remaining;
					}
					captureTruncated = true;
				}
			}
		}
		if (!captureTruncated) {
			captured += decoder.decode();
		}
		if (!res.writableEnded) {
			res.end();
		}
		return { raw: captured, firstChunkAt: firstChunkAt, truncated: captureTruncated };
	} finally {
		reader.releaseLock();
	}
}

function canUseModel(req: Request, model: string): boolean {
	if (!req.auth) {
		return true;
	}
	try {
		runCommonChecks(req.auth, model);
		return true;
	} catch {
		return false;
	}
}

async function sendFilteredGeminiModels(
	upstream: globalThis.Response,
	res: Response,
	req: Request,
	router: LiteLLMRouter,
): Promise<CapturedResponse> {
	if (!upstream.ok) {
		return pipeResponse(upstream, res);
	}
	const value = (await upstream.json()) as Record<string, unknown>;
	const sourceModels = Array.isArray(value["models"])
		? value["models"].filter(
				(item): item is Record<string, unknown> => typeof item === "object" && item !== null && !Array.isArray(item),
			)
		: [];
	const templates = new Map<string, Record<string, unknown>>();
	for (const source of sourceModels) {
		const name = typeof source["name"] === "string" ? source["name"].replace(/^models\//, "") : "";
		if (name) {
			templates.set(name, source);
		}
	}
	const seen = new Set<string>();
	const models = (router.getDeployments?.() ?? []).flatMap((deployment) => {
		if (
			deployment.litellm_params.custom_llm_provider !== CLIPROXY_PROVIDER ||
			seen.has(deployment.model_name) ||
			!canUseModel(req, deployment.model_name)
		) {
			return [];
		}
		seen.add(deployment.model_name);
		const upstreamModel = stripCliProxyPrefix(deployment.litellm_params.model).replace(/^models\//, "");
		const template = templates.get(upstreamModel);
		if (!template) {
			return [];
		}
		return [
			{
				...template,
				name: `models/${deployment.model_name}`,
				displayName: deployment.model_name,
				baseModelId: deployment.model_name,
			},
		];
	});
	const body = JSON.stringify({ ...value, models: models, nextPageToken: undefined });
	res.status(upstream.status);
	res.setHeader("Content-Type", "application/json; charset=utf-8");
	res.end(body);
	return { raw: body, firstChunkAt: new Date(), truncated: false };
}

function parsedResponse(captured: CapturedResponse): { response?: Record<string, unknown>; usage?: Record<string, unknown> } {
	if (captured.truncated) {
		return {
			response: {
				litellm_response_capture_truncated: true,
				captured_bytes: MAX_CAPTURED_RESPONSE_BYTES,
			},
		};
	}
	const candidates: Record<string, unknown>[] = [];
	const trimmed = captured.raw.trim();
	if (trimmed.startsWith("{")) {
		try {
			candidates.push(JSON.parse(trimmed) as Record<string, unknown>);
		} catch {
			// Streaming and binary responses are accounted without a parsed body.
		}
	}
	for (const line of captured.raw.split(/\r?\n/)) {
		if (!line.startsWith("data: ") || line === "data: [DONE]") {
			continue;
		}
		try {
			candidates.push(JSON.parse(line.slice(6)) as Record<string, unknown>);
		} catch {
			// Ignore provider-specific non-JSON streaming chunks.
		}
	}
	const response = candidates.at(-1);
	const usage =
		response && typeof response["usage"] === "object" && response["usage"] !== null
			? (response["usage"] as Record<string, unknown>)
			: undefined;
	return { response: response, usage: usage };
}

function requestMessages(body: PreparedRequestBody): unknown {
	return body.parsed?.["messages"] ?? body.parsed?.["input"] ?? body.parsed?.["prompt"] ?? body.logBody;
}

async function recordSpend(context: NativeSpendContext): Promise<void> {
	if (!context.req.auth) {
		return;
	}
	const candidate = context.router.getAvailableDeployment(context.resolved.publicModel);
	const spendInfo = candidate ? buildDeploymentSpendInfo(candidate.deployment, context.upstreamUrl) : undefined;
	const parsed = context.captured ? parsedResponse(context.captured) : {};
	const log = await buildSpendLogFromRequest({
		req: context.req,
		requestId: context.requestId,
		auth: context.req.auth,
		callType: context.route.callType ?? CallType.ACompletion,
		model: context.resolved.publicModel,
		modelGroup: context.resolved.publicModel,
		modelId: spendInfo?.modelId,
		customLlmProvider: spendInfo?.customLlmProvider,
		apiBase: spendInfo?.apiBase,
		customCostPerToken: spendInfo?.customCostPerToken,
		deploymentModel: spendInfo?.deploymentModel,
		startTime: context.startTime,
		endTime: new Date(),
		completionStartTime: context.captured?.firstChunkAt ?? new Date(),
		messages: requestMessages(context.body),
		proxyServerRequestBody: context.body.logBody,
		response: parsed.response,
		usage: parsed.usage,
		status: context.status,
		error: context.error,
	});
	await trackSpendLog(context.db, log);
}

function handlerForRoute(route: NativePassthroughRoute, router: LiteLLMRouter, runtime: CliProxyRuntimeManager, db: DrizzleDb) {
	return async (req: Request, res: Response): Promise<void> => {
		const prepared = await prepareRequestBody(req);
		const requestedModel = route.modelLocation === "path" ? extractPathModel(req) : prepared.requestedModel;
		if (route.modelLocation !== "optional" && !requestedModel) {
			throw ApiError.badRequest("model 字段缺失");
		}
		const resolved = requestedModel ? resolveCliProxyModel(router, requestedModel) : null;
		if (requestedModel && !resolved) {
			throw ApiError.unavailable(`CLIProxy 模型 ${requestedModel} 当前没有可用 deployment`);
		}
		if (resolved && req.auth) {
			runCommonChecks(req.auth, resolved.publicModel);
		}
		const rewritten = rewritePreparedBody(prepared, resolved);
		const path = upstreamRequestPath(route, req, resolved, requestedModel);
		const upstreamUrl = `${runtime.baseUrl}${path}`;
		const startTime = new Date();
		const reservation = resolved
			? await reserveEndpointSpend(db, router, req, resolved.publicModel, rewritten.parsed ?? {}, {
					callType: route.callType ?? CallType.ACompletion,
					costMode: route.callType === CallType.AImageGeneration ? "image" : undefined,
					startTime: startTime,
				})
			: undefined;
		const lifecycle = createEndpointSpendLifecycle(reservation);
		lifecycle.markProviderStarted();
		const abortController = new AbortController();
		const abort = (): void => abortController.abort();
		req.once("aborted", abort);
		res.once("close", abort);
		try {
			const upstream = await fetch(upstreamUrl, {
				method: route.method.toUpperCase(),
				headers: buildForwardHeaders(req, runtime.internalApiKey, rewritten.contentType),
				body: route.method === "get" ? undefined : rewritten.bytes,
				signal: abortController.signal,
			});
			const captured =
				route.path === "/v1beta/models"
					? await sendFilteredGeminiModels(upstream, res, req, router)
					: await pipeResponse(upstream, res);
			if (resolved) {
				const candidate = router.getAvailableDeployment(resolved.publicModel);
				if (upstream.ok) {
					if (candidate) {
						router.recordDeploymentSuccess(candidate.deployment);
					}
				} else if (candidate) {
					router.recordDeploymentFailure(candidate.deployment, new Error(`CLIProxy returned HTTP ${upstream.status}`));
				}
				await lifecycle.finalize(() =>
					recordSpend({
						db: db,
						req: req,
						router: router,
						resolved: resolved,
						route: route,
						upstreamUrl: upstreamUrl,
						startTime: startTime,
						requestId: reservation?.requestId,
						body: rewritten,
						captured: captured,
						status: upstream.ok ? SpendLogStatus.Success : SpendLogStatus.Failure,
						error: upstream.ok ? undefined : new Error(`CLIProxy returned HTTP ${upstream.status}`),
					}),
				);
			}
		} catch (error) {
			if (resolved) {
				const candidate = router.getAvailableDeployment(resolved.publicModel);
				if (candidate && !(error instanceof DOMException && error.name === "AbortError")) {
					router.recordDeploymentFailure(candidate.deployment, error instanceof Error ? error : new Error(String(error)));
				}
				await lifecycle.finalize(() =>
					recordSpend({
						db: db,
						req: req,
						router: router,
						resolved: resolved,
						route: route,
						upstreamUrl: upstreamUrl,
						startTime: startTime,
						requestId: reservation?.requestId,
						body: rewritten,
						status: SpendLogStatus.Failure,
						error: error,
					}),
				);
			}
			throw error;
		} finally {
			lifecycle.stop();
			req.removeListener("aborted", abort);
			res.removeListener("close", abort);
		}
	};
}

/**
 * Register every non-WebSocket CLIProxyAPI v7.2.110 inference route that is not
 * already covered by the dedicated Chat, Messages, and Responses handlers.
 * @param expressRouter
 * @param router
 * @param runtime
 * @param db
 */
export function registerCliProxyNativePassthroughRoutes(
	expressRouter: ExpressRouter,
	router: LiteLLMRouter,
	runtime: CliProxyRuntimeManager,
	db: DrizzleDb,
): void {
	for (const route of NATIVE_HTTP_ROUTES) {
		registerRoute(
			expressRouter,
			{
				method: route.method,
				path: route.path,
				matches: route.conflictsWithLiteLlmRoute ? (req) => isCliProxyDeployment(router, bodyModel(req.body)) : undefined,
			},
			handlerForRoute(route, router, runtime, db),
		);
	}
}
