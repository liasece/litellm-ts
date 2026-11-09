import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Request } from "express";
import WebSocket, { WebSocketServer } from "ws";
import { runCommonChecks } from "../auth/AuthChecks";
import { ApiError } from "../core/api/ApiError";
import type { ServiceContainer } from "../container";
import { resolveHostedModel } from "../subscriptions/HostedModel";
import { enterCliProxyRequest, isCliProxyDraining } from "./CliProxyDrainGate";
import { hostedProvider, isSubscriptionProvider, subscriptionTarget } from "../subscriptions/SubscriptionProviders";
import type { Deployment } from "../types/router";
import { applyReasoningEffortOverride } from "../router/ReasoningEffortOverride";
import { expressRequest, guardUpgradeSocket, runMiddleware, writeUpgradeError } from "../core/http/UpgradeRequest";

const WS_AUTH_SUBPROTOCOL_PREFIX = "litellm_";
const MAX_BUFFERED_WEBSOCKET_BYTES = 4 * 1024 * 1024;
const UPSTREAM_BLOCKED_HEADERS = new Set([
	"authorization",
	"x-api-key",
	"x-litellm-key",
	"x-litellm-api-key",
	"api-key",
	"x-goog-api-key",
	"cookie",
	"host",
	"connection",
	"upgrade",
	"sec-websocket-key",
	"sec-websocket-version",
	"sec-websocket-extensions",
	"sec-websocket-protocol",
]);

interface WebSocketRoute {
	readonly pattern: RegExp;
	readonly target: (path: string) => string;
	readonly capability: "inference" | "management";
}

const WEBSOCKET_ROUTES: readonly WebSocketRoute[] = [
	{ pattern: /^\/v1\/responses$/, target: () => "/v1/responses", capability: "inference" },
	{
		pattern: /^\/backend-api\/codex\/responses$/,
		target: () => "/backend-api/codex/responses",
		capability: "inference",
	},
	{ pattern: /^\/v1\/live\/[^/]+$/, target: (path) => path, capability: "inference" },
	{ pattern: /^\/v1\/realtime\/calls\/[^/]+$/, target: (path) => path, capability: "inference" },
	{ pattern: /^\/v1\/realtime$/, target: () => "/v1/realtime", capability: "inference" },
	{ pattern: /^\/v1\/ws$/, target: () => "/v1/ws", capability: "management" },
];

function safeProtocols(req: IncomingMessage): string[] {
	const source = req.headers["sec-websocket-protocol"];
	if (typeof source !== "string") {
		return [];
	}
	return source
		.split(",")
		.map((value) => value.trim())
		.filter((value) => value.length > 0 && !value.startsWith(WS_AUTH_SUBPROTOCOL_PREFIX));
}

function rewriteWebSocketModel(value: unknown, container: ServiceContainer, req: Request): { value: unknown; foundModel: boolean } {
	if (Array.isArray(value)) {
		let foundModel = false;
		const result = value.map((item) => {
			const rewritten = rewriteWebSocketModel(item, container, req);
			foundModel ||= rewritten.foundModel;
			return rewritten.value;
		});
		return { value: result, foundModel: foundModel };
	}
	if (typeof value !== "object" || value === null) {
		return { value: value, foundModel: false };
	}
	let foundModel = false;
	const result: Record<string, unknown> = {};
	let directDeployment: Deployment | undefined;
	for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
		if (key === "model" && typeof item === "string") {
			const resolved = resolveHostedModel(container.router, container.cliProxyRuntime, item);
			if (!resolved) {
				throw ApiError.unavailable(`CLIProxy 模型 ${item} 当前没有可用 deployment`);
			}
			if (req.auth) {
				runCommonChecks(req.auth, resolved.publicModel);
			}
			const runtime = container.cliProxyRuntime;
			const provider = hostedProvider(resolved.deployment.litellm_params);
			const responses = req.path.endsWith("/responses");
			const compatibility = resolved.deployment.litellm_params.subscription_transport === "compatibility";
			// Run the same source checks as HTTP before sending a frame over an unscoped transport.
			subscriptionTarget(runtime, resolved.deployment.litellm_params, responses ? "/v1/responses" : req.path);
			const explicitBinding = runtime.sourceBuiltSubscriptions && !compatibility && responses &&
				isSubscriptionProvider(provider) && runtime.subscriptionCatalog.owner(resolved.upstreamModel) !== provider;
			result[key] = explicitBinding ? "litellm-subscription/" + provider + "/" + resolved.upstreamModel : resolved.upstreamModel;
			directDeployment = resolved.deployment;
			foundModel = true;
			continue;
		}
		const rewritten = rewriteWebSocketModel(item, container, req);
		result[key] = rewritten.value;
		foundModel ||= rewritten.foundModel;
	}
	const outbound =
		directDeployment && req.path.includes("responses") ? applyReasoningEffortOverride(result, directDeployment, "responses") : result;
	return { value: outbound, foundModel: foundModel };
}

function rewriteClientMessage(data: WebSocket.RawData, isBinary: boolean, container: ServiceContainer, req: Request): WebSocket.RawData {
	if (isBinary) {
		return data;
	}
	const source = Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
	let parsed: unknown;
	try {
		parsed = JSON.parse(source);
	} catch {
		return data;
	}
	if (isCliProxyDraining() && typeof parsed === "object" && parsed !== null && "type" in parsed &&
		(parsed.type === "response.create" || parsed.type === "response.append")) {
		throw ApiError.unavailable("订阅运行时正在排空，请稍后重试");
	}
	const rewritten = rewriteWebSocketModel(parsed, container, req);
	return rewritten.foundModel ? Buffer.from(JSON.stringify(rewritten.value)) : data;
}

function upstreamHeaders(req: IncomingMessage, internalApiKey: string): Record<string, string> {
	const headers: Record<string, string> = { Authorization: `Bearer ${internalApiKey}` };
	for (const [key, value] of Object.entries(req.headers)) {
		if (UPSTREAM_BLOCKED_HEADERS.has(key.toLowerCase()) || value === undefined) {
			continue;
		}
		headers[key] = Array.isArray(value) ? value.join(", ") : value;
	}
	return headers;
}

// ws reports reserved status codes for transports that closed without a close frame.
function relayCloseCode(code: number): number {
	return code === 1005 ? 1000 : code === 1006 || code === 1015 ? 1011 : code;
}

function relayWebSocket(
	downstream: WebSocket,
	req: Request,
	container: ServiceContainer,
	targetPath: string,
	query: URLSearchParams,
): void {
	query.delete("key");
	const upstreamBase = container.cliProxyRuntime.baseUrl.replace(/^http/, "ws");
	const queryString = query.toString();
	const route = container.cliProxyRuntime.sourceBuiltSubscriptions && targetPath.endsWith("/responses") ? "/_litellm/ws" + targetPath : targetPath;
	const upstreamUrl = `${upstreamBase}${route}${queryString ? `?${queryString}` : ""}`;
	const protocols = safeProtocols(req);
	const options = { headers: upstreamHeaders(req, container.cliProxyRuntime.internalApiKey) };
	const upstream = protocols.length > 0 ? new WebSocket(upstreamUrl, protocols, options) : new WebSocket(upstreamUrl, options);
	const pending: Array<{ data: WebSocket.RawData; isBinary: boolean }> = [];
	let pendingBytes = 0;

	const closeBoth = (code = 1011, reason = "CLIProxy WebSocket relay closed"): void => {
		if (downstream.readyState === WebSocket.OPEN || downstream.readyState === WebSocket.CONNECTING) {
			downstream.close(code, reason);
		}
		if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) {
			upstream.close(code, reason);
		}
	};

	downstream.on("message", (data, isBinary) => {
		try {
			const rewritten = rewriteClientMessage(data, isBinary, container, req);
			if (upstream.readyState === WebSocket.OPEN) {
				upstream.send(rewritten, { binary: isBinary });
				return;
			}
			const size = Array.isArray(rewritten) ? rewritten.reduce((total, item) => total + item.length, 0) : rewritten.byteLength;
			pendingBytes += size;
			if (pendingBytes > MAX_BUFFERED_WEBSOCKET_BYTES) {
				closeBoth(1009, "Buffered WebSocket messages exceed 4 MB");
				return;
			}
			pending.push({ data: rewritten, isBinary: isBinary });
		} catch (error) {
			if (error instanceof ApiError && error.statusCode === 503 && isCliProxyDraining()) {
				if (downstream.readyState === WebSocket.OPEN) {
					downstream.send(JSON.stringify({ type: "error", error: { type: "server_error", message: error.message } }));
				}
				return;
			}
			const message = error instanceof Error ? error.message : "Model authorization failed";
			if (downstream.readyState === WebSocket.OPEN) {
				downstream.send(JSON.stringify({ type: "error", error: { type: "permission_error", message: message } }));
			}
			closeBoth(1008, "Model authorization failed");
		}
	});

	upstream.on("open", () => {
		for (const item of pending.splice(0)) {
			upstream.send(item.data, { binary: item.isBinary });
		}
		pendingBytes = 0;
	});
	upstream.on("message", (data, isBinary) => {
		if (downstream.readyState === WebSocket.OPEN) {
			downstream.send(data, { binary: isBinary });
		}
	});
	upstream.on("close", (code, reason) => {
		if (downstream.readyState === WebSocket.OPEN) {
			downstream.close(relayCloseCode(code), reason.toString());
		}
	});
	downstream.on("close", (code, reason) => {
		// downstream 可能在 upstream 握手完成（CONNECTING）前断开；此时不关闭会让 upstream
		// 在 open 后永久悬挂（无下游消费、pending 缓冲不清）。CONNECTING 下 close() 会中止握手。
		if (upstream.readyState !== WebSocket.CLOSED && upstream.readyState !== WebSocket.CLOSING) {
			upstream.close(relayCloseCode(code), reason.toString());
		}
	});
	upstream.on("error", () => closeBoth());
	downstream.on("error", () => closeBoth());
}

/** upgrade 注册选项。 */
export interface CliProxyWebSocketPassthroughOptions {
	/**
	 * 由其他处理器负责的路径（如日志详情流）。
	 *
	 * Node 会把 `upgrade` 事件通知给所有监听器，而本处理器负责清理无人认领的连接；
	 * 声明这些路径后，它们不会被误当成非法升级而断开。
	 */
	readonly additionalUpgradePaths?: readonly string[];
}

/**
 * Attach authenticated WebSocket upgrades for the CLIProxyAPI v7.2.110
 * Responses, Live, Realtime, and provider relay routes.
 * @param server
 * @param container
 * @param options - 额外声明给其他处理器的路径
 */
export function registerCliProxyWebSocketPassthrough(
	server: HttpServer,
	container: ServiceContainer,
	options: CliProxyWebSocketPassthroughOptions = {},
): void {
	const webSocketServer = new WebSocketServer({
		noServer: true,
		handleProtocols: (protocols) => [...protocols].find((value) => !value.startsWith(WS_AUTH_SUBPROTOCOL_PREFIX)) || false,
	});
	server.on("upgrade", (incoming, socket, head) => {
		guardUpgradeSocket(socket);
		void (async () => {
			const url = new URL(incoming.url ?? "/", "http://127.0.0.1");
			const route = WEBSOCKET_ROUTES.find((item) => item.pattern.test(url.pathname));
			if (!route) {
				// 其他处理器（日志详情流等）的路径交给它们自己处理，这里只清理无人认领的连接。
				if (!(options.additionalUpgradePaths ?? []).includes(url.pathname)) {
					socket.destroy();
				}
				return;
			}
			const req = expressRequest(incoming, url.pathname, url.searchParams);
			await runMiddleware(container.authMiddleware, req);
			await runMiddleware(container.authorizationGuard.middleware(route.capability), req);
			const snapshot = await container.runtimeConfigService.loadSnapshot(container.router);
			if (socket.destroyed) {return;}
			if (route.capability === "inference") {
				// Account handoff waits for both responses and long-lived realtime sessions.
				socket.once("close", enterCliProxyRequest());
			}
			container.router.runWithRuntimeSnapshot(snapshot, () => {
				webSocketServer.handleUpgrade(incoming, socket, head, (downstream) => {
					relayWebSocket(downstream, req, container, route.target(url.pathname), url.searchParams);
				});
			});
		})().catch((error: unknown) => writeUpgradeError(socket, error, "CLIProxy WebSocket connection failed"));
	});
	server.once("close", () => webSocketServer.close());
}
