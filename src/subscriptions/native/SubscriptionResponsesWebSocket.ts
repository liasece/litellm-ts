/**
 * Responses API 的 WebSocket 入口。
 *
 * Codex 等客户端可以用 `response.create` 在同一连接上连续发起多轮 Responses。
 * 进程内订阅运行时没有独立的 WebSocket 上游，这里把每个 turn 还原成一次
 * Responses HTTP 流，再把 SSE 的 data JSON 原样作为文本帧转发；连接保持打开，
 * 客户端可以继续发送下一轮。`response.interrupt` 取消当前 turn。
 */

import { randomUUID } from "node:crypto";
import type { Server as HttpServer } from "node:http";
import WebSocket, { WebSocketServer } from "ws";
import type { Request as ExpressRequest } from "express";
import { ApiError } from "../../core/api/ApiError";
import { runCommonChecks } from "../../auth/AuthChecks";
import { expressRequest, guardUpgradeSocket, runMiddleware, writeUpgradeError } from "../../core/http/UpgradeRequest";
import type { ServiceContainer } from "../../container";
import { executeProviderRequest } from "../../router/ProviderRequestExecutor";
import type { Router } from "../../router/Router";
import { buildDeploymentSpendInfo } from "../../router/RouterSpendInfo";
import { buildSpendLogFromRequest, calculateAndSetCost } from "../../spend/SpendTracker";
import { queueSpendLog } from "../../spend/SpendSettlementQueue";
import type { DrizzleDb } from "../../core/db/Database";
import type { Deployment } from "../../types/router";
import type { ModelResponse } from "../../types/openai";
import { CallType, SpendLogStatus } from "../../types/spend";
import { createModuleLogger } from "../../core/utils/logger";
import { subscriptionBridgeUrl } from "./bridge";
import { SUBSCRIPTION_PROVIDER_TO_SOURCE } from "./types";
import type { SubscriptionSource } from "./types";

const logger = createModuleLogger("Subscription:ResponsesWS");

/** 同时保持的客户端连接上限。 */
const MAX_CONNECTIONS = 100;

/** 单轮上游请求的最长等待时间。 */
const TURN_TIMEOUT_MS = 15 * 60 * 1_000;

/** WebSocket 心跳周期。 */
const HEARTBEAT_INTERVAL_MS = 25_000;

/** 支持的入口路径。 */
export const SUBSCRIPTION_RESPONSES_WS_PATHS: ReadonlySet<string> = new Set(["/v1/responses", "/backend-api/codex/responses"]);

/** 连接内一轮请求的完成状态。 */
interface TurnResult {
	/** 响应 ID。 */
	readonly responseId: string;
	/** 完成后的 output。 */
	readonly output: unknown[];
	/** usage；没有时为空。 */
	readonly usage?: Record<string, unknown>;
	/** 实际命中的 deployment；用于账务归因。 */
	readonly deployment?: Deployment;
}

/**
 * 从 deployment 上读取订阅来源。
 * @param deployment - 命中的 deployment
 */
function deploymentSource(deployment: { litellm_params: Record<string, unknown> }): SubscriptionSource | undefined {
	const provider = deployment.litellm_params["custom_llm_provider"];
	if (typeof provider !== "string") {
		return undefined;
	}
	return (SUBSCRIPTION_PROVIDER_TO_SOURCE as Record<string, SubscriptionSource | undefined>)[provider];
}

/**
 * 读取对象。
 * @param value - 待判定值
 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/**
 * 把消息安全地写成 WebSocket 文本帧。
 * @param socket - 客户端连接
 * @param payload - 事件或错误对象
 */
function send(socket: WebSocket, payload: unknown): void {
	if (socket.readyState !== WebSocket.OPEN) {
		return;
	}
	socket.send(typeof payload === "string" ? payload : JSON.stringify(payload));
}

/**
 * 生成 WebSocket 错误帧。
 * @param status - HTTP 状态码
 * @param message - 错误文本
 * @param body - 上游错误体
 */
function errorFrame(status: number, message: string, body?: unknown): Record<string, unknown> {
	const record = asRecord(body);
	const nested = asRecord(record?.["error"]);
	return {
		type: "error",
		status: status,
		error: nested ?? record?.["error"] ?? { type: "server_error", message: message },
	};
}

/**
 * 把 Responses 的 input 统一成数组。
 * @param value - input 字段
 */
function inputItems(value: unknown): unknown[] {
	if (Array.isArray(value)) {
		return value;
	}
	if (typeof value === "string" && value) {
		return [{ role: "user", content: value }];
	}
	return [];
}

/**
 * 过滤掉不应在后续 turn 重放的输出项。
 * @param value - 上一轮 output
 */
function replayableOutput(value: unknown): unknown[] {
	return inputItems(value).filter((item) => {
		const type = asRecord(item)?.["type"];
		return typeof type !== "string" || (!type.includes("reasoning") && !type.includes("compaction"));
	});
}

/**
 * 合并增量 transcript：上一轮输入 + 上一轮输出 + 本轮新输入。
 * @param previousInput - 上一轮输入
 * @param previousOutput - 上一轮输出
 * @param nextInput - 本轮新输入
 */
function continueTranscript(previousInput: unknown[], previousOutput: unknown[], nextInput: unknown[]): unknown[] {
	return [...previousInput, ...replayableOutput(previousOutput), ...nextInput];
}

/**
 * 从 SSE data 中取事件对象。
 * @param block - 一个 SSE 事件块
 */
function parseSseData(block: string): Record<string, unknown> | undefined {
	const data: string[] = [];
	for (const rawLine of block.split("\n")) {
		const line = rawLine.replace(/\r$/, "");
		if (line.startsWith("data:")) {
			data.push(line.slice(5).trimStart());
		}
	}
	const payload = data.join("\n").trim();
	if (!payload || payload === "[DONE]") {
		return undefined;
	}
	try {
		const parsed = JSON.parse(payload) as unknown;
		return asRecord(parsed);
	} catch {
		return undefined;
	}
}

/**
 * 判断客户端是否 Codex（决定是否转发 response.metadata）。
 * @param req - 握手请求
 */
function isCodexClient(req: ExpressRequest): boolean {
	const userAgent = typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : "";
	const originator = typeof req.headers["originator"] === "string" ? req.headers["originator"] : "";
	return `${userAgent} ${originator}`.toLowerCase().includes("codex");
}

/**
 * 从 completed/incomplete 事件中提取 turn 结果。
 * @param event - Responses 事件
 * @param outputByIndex - 已累积的 output_item.done
 */
function turnResult(event: Record<string, unknown>, outputByIndex: ReadonlyMap<number, unknown>): TurnResult | undefined {
	const type = typeof event["type"] === "string" ? event["type"] : "";
	if (type !== "response.completed" && type !== "response.incomplete") {
		return undefined;
	}
	const response = asRecord(event["response"]);
	if (!response) {
		return undefined;
	}
	const responseId = typeof response["id"] === "string" ? response["id"] : "";
	const reported = Array.isArray(response["output"]) ? response["output"] : [];
	const output = reported.length > 0 ? reported : [...outputByIndex.values()];
	const usage = asRecord(response["usage"]);
	return { responseId: responseId, output: output, ...(usage ? { usage: usage } : {}) };
}

/**
 * 把一个 turn 的 Responses HTTP 流转发到 WebSocket。
 * @param socket - 客户端连接
 * @param router - 业务 Router
 * @param turnReq - 本轮鉴权请求
 * @param request - Responses 请求体
 * @param signal - 取消信号
 */
async function streamTurn(
	socket: WebSocket,
	router: Router,
	turnReq: ExpressRequest,
	request: Record<string, unknown>,
	signal: AbortSignal,
): Promise<TurnResult> {
	const model = typeof request["model"] === "string" ? request["model"] : "";
	if (!model) {
		throw ApiError.badRequest("缺少 model 字段");
	}
	if (turnReq.auth) {
		runCommonChecks(turnReq.auth, model);
	}
	// 路由的 stream 能力过滤依赖 deployment 元数据；订阅 catalog 的动态模型可能没有该标记，
	// 但订阅上游本身支持 SSE。这里按普通请求选 deployment，再由桥接层强制流式。
	const selected = router.getAvailableDeployment(model);
	const source = selected ? deploymentSource(selected.deployment) : undefined;
	if (!selected || !source) {
		throw ApiError.notFound(`没有可用的订阅 deployment：${model}`);
	}
	const body = { ...request, stream: true };
	const headers: Record<string, string> = { "content-type": "application/json", accept: "text/event-stream" };
	for (const name of [
		"session_id",
		"conversation_id",
		"originator",
		"user-agent",
		"x-codex-turn-state",
		"x-codex-turn-metadata",
		"x-client-request-id",
	]) {
		const value = turnReq.headers[name];
		if (typeof value === "string" && value) {
			headers[name] = value;
		}
	}
	const execution = await executeProviderRequest(
		{
			url: subscriptionBridgeUrl(source, "responses"),
			method: "POST",
			headers: headers,
			body: body,
			model: model,
			stream: true,
		},
		{ readJson: false, signal: signal },
	);
	if (!execution.response.ok) {
		const status = execution.response.status;
		const message = typeof execution.body === "string" ? execution.body : JSON.stringify(execution.body ?? "");
		router.recordDeploymentFailure(selected.deployment, new Error(`Responses 上游返回 ${status}`));
		throw new ApiError(status, message || `Responses WebSocket 上游返回 ${status}`);
	}
	const reader = execution.response.body?.getReader();
	if (!reader) {
		throw ApiError.unavailable("Responses 上游没有返回流");
	}
	const decoder = new TextDecoder();
	let buffer = "";
	let result: TurnResult | undefined;
	let failed = false;
	const outputByIndex = new Map<number, unknown>();
	const codexClient = isCodexClient(turnReq);
	const processBlock = (block: string): void => {
		const event = parseSseData(block);
		if (!event) {
			return;
		}
		const type = typeof event["type"] === "string" ? event["type"] : "";
		if (type === "response.subscription_usage" || (type === "response.metadata" && !codexClient)) {
			return;
		}
		if (type === "response.output_item.done") {
			const index = typeof event["output_index"] === "number" ? event["output_index"] : outputByIndex.size;
			const item = event["item"];
			if (item !== undefined) {
				outputByIndex.set(index, item);
			}
		}
		if (!failed) {
			send(socket, event);
		}
		const completed = turnResult(event, outputByIndex);
		if (completed) {
			result = completed;
		}
		if (type === "response.failed" || type === "error") {
			failed = true;
		}
	};
	try {
		for (;;) {
			const next = await reader.read();
			if (next.done) {
				break;
			}
			buffer += decoder.decode(next.value, { stream: true });
			buffer = buffer.replace(/\r\n/g, "\n");
			let boundary = buffer.indexOf("\n\n");
			while (boundary >= 0) {
				const block = buffer.slice(0, boundary);
				buffer = buffer.slice(boundary + 2);
				processBlock(block);
				boundary = buffer.indexOf("\n\n");
			}
		}
		buffer += decoder.decode();
		if (buffer.trim()) {
			processBlock(buffer);
		}
	} finally {
		reader.releaseLock();
	}
	if (!result && !failed) {
		throw ApiError.unavailable("Responses 上游流在完成事件前结束");
	}
	router.recordDeploymentSuccess(selected.deployment);
	return { ...(result ?? { responseId: "", output: [] }), deployment: selected.deployment };
}

/**
 * 把一轮 Responses WebSocket 请求写入花费日志。
 * @param db - 数据库
 * @param req - 本轮鉴权后的请求
 * @param turn - 本轮结果
 * @param request - 本轮请求体
 * @param startedAt - 开始时间
 */
async function recordTurnSpend(
	db: DrizzleDb | undefined,
	req: ExpressRequest,
	turn: TurnResult,
	request: Record<string, unknown>,
	startedAt: Date,
): Promise<void> {
	if (!db || !req.auth || !turn.deployment) {
		return;
	}
	const deployment = turn.deployment;
	const source = deploymentSource(deployment);
	if (!source) {
		return;
	}
	const model = typeof request["model"] === "string" ? request["model"] : "";
	if (!model) {
		return;
	}
	const rawUsage = turn.usage ?? {};
	const prompt = typeof rawUsage["input_tokens"] === "number" ? rawUsage["input_tokens"] : 0;
	const completion = typeof rawUsage["output_tokens"] === "number" ? rawUsage["output_tokens"] : 0;
	const usage = {
		prompt_tokens: prompt,
		completion_tokens: completion,
		total_tokens: typeof rawUsage["total_tokens"] === "number" ? (rawUsage["total_tokens"] as number) : prompt + completion,
	};
	const spendInfo = buildDeploymentSpendInfo(deployment, subscriptionBridgeUrl(source, "responses"));
	const costResponse = { usage: usage, _spendInfo: spendInfo } as unknown as ModelResponse;
	calculateAndSetCost(costResponse, model, spendInfo.customCostPerToken);
	try {
		await queueSpendLog(
			db,
			await buildSpendLogFromRequest({
				req: req,
				auth: req.auth,
				requestId: randomUUID(),
				callType: CallType.ACompletion,
				model: model,
				modelGroup: model,
				modelId: spendInfo.modelId,
				customLlmProvider: spendInfo.customLlmProvider,
				apiBase: spendInfo.apiBase,
				customCostPerToken: spendInfo.customCostPerToken,
				deploymentModel: spendInfo.deploymentModel,
				startTime: startedAt,
				endTime: new Date(),
				messages: request,
				response: { output: turn.output, usage: turn.usage },
				usage: usage,
				status: SpendLogStatus.Success,
			}),
		);
	} catch (error) {
		logger.warn("Responses WebSocket 花费提交失败", { error: error instanceof Error ? error.message : String(error) });
	}
}

/**
 * 克隆握手请求并替换本轮 body/headers，用于每轮重新鉴权。
 * @param container - 服务容器
 * @param base - 握手请求
 * @param body - 本轮 Responses 请求
 */
async function authenticateTurn(container: ServiceContainer, base: ExpressRequest, body: Record<string, unknown>): Promise<ExpressRequest> {
	const headers = { ...base.headers };
	delete headers["upgrade"];
	delete headers["connection"];
	delete headers["content-length"];
	delete headers["sec-websocket-key"];
	delete headers["sec-websocket-version"];
	delete headers["sec-websocket-extensions"];
	delete headers["sec-websocket-protocol"];
	const turnReq = {
		...base,
		method: "POST",
		headers: headers,
		body: body,
		auth: undefined,
	} as unknown as ExpressRequest;
	await runMiddleware(container.authMiddleware, turnReq);
	await runMiddleware(container.authorizationGuard.middleware("inference"), turnReq);
	return turnReq;
}

/**
 * 判断 input 是否已经带有压缩摘要标记。
 * @param input - 本轮 input
 */
function hasCompaction(input: unknown[]): boolean {
	return input.some((item) => {
		const type = asRecord(item)?.["type"];
		return typeof type === "string" && type.toLowerCase().includes("compaction");
	});
}

/**
 * 处理一条客户端的 Responses WebSocket 会话。
 * @param socket - 客户端连接
 * @param container - 服务容器
 * @param req - 握手请求
 */
async function runSession(socket: WebSocket, container: ServiceContainer, req: ExpressRequest): Promise<void> {
	const router = container.router;
	let lastInput: unknown[] = [];
	let lastOutput: unknown[] = [];
	let lastResponseId = "";
	let lastModel = "";
	let active: AbortController | undefined;
	let interrupted = false;
	const heartbeat = setInterval(() => {
		if (socket.readyState === WebSocket.OPEN) {
			socket.ping();
		}
	}, HEARTBEAT_INTERVAL_MS);
	heartbeat.unref?.();

	const close = (): void => {
		clearInterval(heartbeat);
		active?.abort();
	};
	socket.on("close", close);
	socket.on("error", close);
	socket.on("pong", () => undefined);

	try {
		for await (const message of (async function* (): AsyncGenerator<WebSocket.RawData> {
			for (;;) {
				const value = await new Promise<WebSocket.RawData | undefined>((resolve) => {
					const onMessage = (data: WebSocket.RawData): void => {
						cleanup();
						resolve(data);
					};
					const onClose = (): void => {
						cleanup();
						resolve(undefined);
					};
					const cleanup = (): void => {
						socket.off("message", onMessage);
						socket.off("close", onClose);
					};
					socket.once("message", onMessage);
					socket.once("close", onClose);
				});
				if (value === undefined) {
					return;
				}
				yield value;
			}
		})()) {
			const text = message.toString();
			let payload: Record<string, unknown>;
			try {
				const parsed = JSON.parse(text) as unknown;
				payload = asRecord(parsed) ?? {};
			} catch {
				send(socket, errorFrame(400, "WebSocket 消息必须是 JSON 对象"));
				continue;
			}
			const type = typeof payload["type"] === "string" ? payload["type"] : "";
			if (type === "response.interrupt") {
				if (active) {
					interrupted = true;
					active.abort();
					send(socket, {
						type: "response.incomplete",
						response: {
							id: typeof payload["response_id"] === "string" ? payload["response_id"] : lastResponseId,
							status: "incomplete",
							incomplete_details: { reason: "interrupted" },
							output: [],
						},
					});
				}
				continue;
			}
			if (type !== "response.create" && type !== "response.append") {
				send(socket, errorFrame(400, `不支持的 WebSocket 消息类型：${type || "(empty)"}`));
				continue;
			}
			if (active) {
				send(socket, errorFrame(409, "上一轮尚未结束"));
				continue;
			}
			const request: Record<string, unknown> = { ...payload };
			delete request["type"];
			const requestedModel = typeof request["model"] === "string" ? request["model"] : lastModel;
			if (type === "response.create" && !requestedModel) {
				send(socket, errorFrame(400, "response.create 缺少 model 字段"));
				continue;
			}
			if (!Array.isArray(request["input"])) {
				send(socket, errorFrame(400, "input 必须是数组"));
				continue;
			}
			if (requestedModel) {
				request["model"] = requestedModel;
			}
			const newInput = inputItems(request["input"]);
			const previousResponseId = typeof request["previous_response_id"] === "string" ? request["previous_response_id"] : "";
			if (type === "response.append" && !previousResponseId && !lastModel) {
				send(socket, errorFrame(400, "response.append 还没有可续接的 turn"));
				continue;
			}
			if (previousResponseId && previousResponseId !== lastResponseId) {
				send(socket, errorFrame(409, `previous_response_id 不存在：${previousResponseId}`));
				continue;
			}
			if (hasCompaction(newInput)) {
				request["input"] = newInput;
				delete request["previous_response_id"];
			} else if (previousResponseId || type === "response.append") {
				request["input"] = continueTranscript(lastInput, lastOutput, newInput);
				delete request["previous_response_id"];
			} else {
				lastInput = newInput;
				lastOutput = [];
				lastResponseId = "";
			}
			lastModel = requestedModel;
			let turnReq: ExpressRequest;
			try {
				turnReq = await authenticateTurn(container, req, request);
				if (!turnReq.auth) {
					throw ApiError.unauthorized("API 密钥无效");
				}
				if (requestedModel) {
					runCommonChecks(turnReq.auth, requestedModel);
				}
			} catch (error) {
				const apiError =
					error instanceof ApiError ? error : new ApiError(401, error instanceof Error ? error.message : String(error));
				send(socket, errorFrame(apiError.statusCode, apiError.message));
				continue;
			}
			if (request["generate"] === false) {
				delete request["generate"];
				const prewarmId = `resp_prewarm_${randomUUID()}`;
				const model = requestedModel || lastModel;
				send(socket, {
					type: "response.created",
					response: { id: prewarmId, object: "response", status: "in_progress", model: model, output: [] },
				});
				send(socket, {
					type: "response.completed",
					response: {
						id: prewarmId,
						object: "response",
						status: "completed",
						model: model,
						output: [],
						usage: {
							input_tokens: 0,
							input_tokens_details: { cached_tokens: 0 },
							output_tokens: 0,
							output_tokens_details: { reasoning_tokens: 0 },
							total_tokens: 0,
						},
					},
				});
				lastResponseId = prewarmId;
				lastInput = newInput;
				lastOutput = [];
				continue;
			}
			delete request["generate"];
			const controller = new AbortController();
			active = controller;
			interrupted = false;
			const timeout = setTimeout(() => controller.abort(), TURN_TIMEOUT_MS);
			const turnStartedAt = new Date();
			try {
				const result = await container.runtimeConfigService.runWithSnapshot(container.router, async () => {
					return await streamTurn(socket, router, turnReq, request, controller.signal);
				});
				await recordTurnSpend(container.db?.db, turnReq, result, request, turnStartedAt);
				if (result.responseId) {
					lastResponseId = result.responseId;
				}
				lastOutput = result.output;
				lastInput = inputItems(request["input"]);
			} catch (error) {
				if (!interrupted) {
					const apiError =
						error instanceof ApiError ? error : new ApiError(500, error instanceof Error ? error.message : String(error));
					if (socket.readyState === WebSocket.OPEN) {
						send(socket, errorFrame(apiError.statusCode, apiError.message));
					}
				}
				logger.debug("Responses WebSocket turn 失败", {
					model: lastModel,
					error: error instanceof Error ? error.message : String(error),
				});
			} finally {
				clearTimeout(timeout);
				active = undefined;
			}
		}
	} finally {
		close();
	}
}

/**
 * 注册 Responses WebSocket 升级处理。
 * @param server - HTTP 服务器
 * @param container - 服务容器
 */
export function registerSubscriptionResponsesWebSocket(server: HttpServer, container: ServiceContainer): void {
	const webSocketServer = new WebSocketServer({
		noServer: true,
		perMessageDeflate: false,
		handleProtocols: (protocols) => {
			// 不能把 litellm_<key> 子协议原样回显给客户端，否则密钥会出现在响应头。
			return [...protocols].find((protocol) => protocol.startsWith("responses")) ?? false;
		},
	});
	const paths = SUBSCRIPTION_RESPONSES_WS_PATHS;
	let openConnections = 0;

	server.on("upgrade", (incoming, socket, head) => {
		const url = new URL(incoming.url ?? "/", "http://127.0.0.1");
		if (!paths.has(url.pathname)) {
			return;
		}
		guardUpgradeSocket(socket);
		void (async () => {
			if (openConnections >= MAX_CONNECTIONS) {
				throw ApiError.unavailable("Responses WebSocket 并发连接已达上限");
			}
			const req = expressRequest(incoming, url.pathname, url.searchParams);
			await runMiddleware(container.authMiddleware, req);
			await runMiddleware(container.authorizationGuard.middleware("inference"), req);
			webSocketServer.handleUpgrade(incoming, socket, head, (downstream) => {
				openConnections += 1;
				void runSession(downstream, container, req)
					.catch((error: unknown) => {
						logger.warn("Responses WebSocket 会话异常结束", {
							error: error instanceof Error ? error.message : String(error),
						});
					})
					.finally(() => {
						openConnections -= 1;
					});
			});
		})().catch((error: unknown) => {
			writeUpgradeError(socket, error, "Responses WebSocket 连接失败");
		});
	});

	server.once("close", () => webSocketServer.close());
}
