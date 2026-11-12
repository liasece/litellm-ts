/**
 * 日志详情实时流（WebSocket）。
 *
 * 详情页过去靠 2 秒轮询 `/spend/logs/ui/:request_id` 拿进行中的进展；这里提供同源的
 * 订阅通道：客户端连上后先收到当前快照，之后只收到变化的顶层字段，请求结束时收到
 * 最终帧并主动断开，前端据此停掉轮询。
 *
 * 首帧读一次库（复用 UiLogDetail 的负载构造，保证推送帧与一次性拉取同形），之后的内容
 * 变更全部来自执行流在进程内存里的实时快照（LiveResponseRegistry）：不再为「有人看」
 * 每 400ms 重写一次 jsonb，也不再按修订号回读整行。数据库只剩每 500ms 一次的结束检查。
 */

import type { Server as HttpServer } from "node:http";
import WebSocket, { WebSocketServer } from "ws";
import { ApiError } from "../core/api/ApiError";
import { expressRequest, guardUpgradeSocket, runMiddleware, writeUpgradeError } from "../core/http/UpgradeRequest";
import type { ServiceContainer } from "../container";
import type { DrizzleDb } from "../core/db/Database";
import { createModuleLogger } from "../core/utils/logger";
import { applyLiveCheckpointToDetail, buildActiveRequestDetail, buildUiSpendLogDetail, readActiveRequestRevision } from "./UiLogDetail";
import { subscribeLiveResponse } from "./LiveResponseRegistry";
import { LOG_STREAM_SUBPROTOCOL } from "./logStreamProtocol";

const logger = createModuleLogger("Spend:LogStream");

/** 订阅日志详情流的路径。 */
export const SPEND_LOG_STREAM_PATH = "/spend/logs/ui/stream";

/**
 * 结束检查周期：实时内容由内存推送，这个轮询只用来发现「请求已结算、在途行消失」，
 * 500ms 足够让终帧紧跟结算，又不会给数据库带来持续压力。
 */
const REVISION_POLL_INTERVAL_MS = 500;

/** 单个订阅的最长存活时间，避免浏览器异常退出后连接长期占用。 */
const MAX_STREAM_DURATION_MS = 15 * 60 * 1_000;

/** 握手探活间隔；两个周期内没有 pong 视为断线。 */
const HEARTBEAT_INTERVAL_MS = 25_000;

/** 同时存在的订阅上限，防止管理面被误用刷爆数据库。 */
const MAX_CONCURRENT_STREAMS = 50;

/** 请求 ID 允许的形态（与 UUID / 哈希两类 request_id 兼容）。 */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;

/** 订阅可注入的依赖，便于测试替换数据面。 */
export interface SpendLogStreamDeps {
	/** 读取在途行修订号 */
	readonly readRevision?: typeof readActiveRequestRevision;
	/** 构造进行中负载 */
	readonly loadActiveDetail?: typeof buildActiveRequestDetail;
	/** 构造最终（已落库）负载 */
	readonly loadSettledDetail?: typeof buildUiSpendLogDetail;
	/** 结束检查周期 */
	readonly pollIntervalMs?: number;
	/** 订阅进程内实时快照（测试可替换） */
	readonly subscribeLive?: (requestId: string, listener: (snapshot: unknown | null) => void) => () => void;
	/** 单个订阅最长存活时间 */
	readonly maxDurationMs?: number;
}

/** 推送到客户端的一帧；每帧都带订阅目标，客户端据此丢弃不属于当前日志的事件。 */
type StreamFrame =
	| { readonly type: "snapshot"; readonly request_id: string; readonly data: Record<string, unknown> }
	| { readonly type: "patch"; readonly request_id: string; readonly data: Record<string, unknown> }
	| { readonly type: "final"; readonly request_id: string; readonly data: Record<string, unknown> | null }
	| { readonly type: "gone"; readonly request_id: string }
	| { readonly type: "timeout"; readonly request_id: string }
	| { readonly type: "error"; readonly request_id: string; readonly message: string };

/**
 * 顶层字段指纹：负载里唯一的大块是注册时写入的请求体（可能含图片 base64），
 * 对整份 JSON 反复序列化代价太高；它中途只会被补上上游交换信息，按结构签名判断即可。
 * @param key - 顶层字段名
 * @param value - 字段值
 */
function payloadSignature(key: string, value: unknown): string {
	if (key === "proxy_server_request" && typeof value === "object" && value !== null) {
		const record = value as Record<string, unknown>;
		const upstreamRequest = record["upstream_request"] as Record<string, unknown> | undefined;
		const upstreamResponse = record["upstream_response"] as Record<string, unknown> | undefined;
		return [
			Object.keys(record).sort().join(","),
			typeof upstreamRequest?.["url"] === "string" ? upstreamRequest["url"] : "",
			upstreamResponse === undefined ? "" : String(upstreamResponse["status_code"] ?? ""),
			upstreamResponse === undefined ? "" : String(upstreamResponse["arrival_time"] ?? ""),
		].join("|");
	}
	return JSON.stringify(value) ?? "undefined";
}

/**
 * 计算两帧之间的顶层字段差异。
 * @param previous - 上一帧负载
 * @param next - 当前负载
 */
export function diffLogDetailPayload(
	previous: Record<string, unknown>,
	next: Record<string, unknown>,
): Record<string, unknown> {
	const patch: Record<string, unknown> = {};
	const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
	for (const key of keys) {
		if (payloadSignature(key, previous[key]) !== payloadSignature(key, next[key])) {
			patch[key] = next[key] ?? null;
		}
	}
	return patch;
}

/**
 * 把订阅帧发给客户端；连接已关闭时忽略。
 * @param socket - 已建立的 WebSocket
 * @param frame - 待发送的帧
 */
function sendFrame(socket: WebSocket, frame: StreamFrame): void {
	if (socket.readyState !== WebSocket.OPEN) {
		return;
	}
	socket.send(JSON.stringify(frame));
}

/**
 * 订阅单个请求的日志进展：首帧读一次库，之后由进程内存推送增量，数据库只用于判断结束。
 * @param socket - 已建立的 WebSocket
 * @param requestId - 目标请求 ID
 * @param db - 数据库实例
 * @param deps - 可注入的数据面
 */
async function streamSpendLogDetail(
	socket: WebSocket,
	requestId: string,
	db: DrizzleDb,
	deps: SpendLogStreamDeps,
): Promise<void> {
	const readRevision = deps.readRevision ?? readActiveRequestRevision;
	const loadActiveDetail = deps.loadActiveDetail ?? buildActiveRequestDetail;
	const loadSettledDetail = deps.loadSettledDetail ?? buildUiSpendLogDetail;
	const subscribeLive = deps.subscribeLive ?? subscribeLiveResponse;
	const pollIntervalMs = deps.pollIntervalMs ?? REVISION_POLL_INTERVAL_MS;
	const deadline = Date.now() + (deps.maxDurationMs ?? MAX_STREAM_DURATION_MS);

	let stopped = false;
	let busy = false;
	let lastPayload: Record<string, unknown> | null = null;
	let unsubscribe: () => void = () => undefined;
	let timer: NodeJS.Timeout | null = null;
	let heartbeat: NodeJS.Timeout | null = null;
	let awaitingPong = false;

	const stop = (code: number, reason: string): void => {
		if (stopped) {
			return;
		}
		stopped = true;
		unsubscribe();
		unsubscribe = () => undefined;
		if (timer !== null) {
			clearInterval(timer);
			timer = null;
		}
		if (heartbeat !== null) {
			clearInterval(heartbeat);
			heartbeat = null;
		}
		if (socket.readyState === WebSocket.OPEN) {
			socket.close(code, reason);
		}
	};

	const settle = async (): Promise<void> => {
		// 已经在途行消失：最终负载只取一次，取到后交给客户端，让前端停掉订阅改走详情接口。
		const settled = await loadSettledDetail(db, requestId);
		if (settled === null) {
			sendFrame(socket, { type: "gone", request_id: requestId });
			stop(1000, "gone");
			return;
		}
		sendFrame(socket, { type: "final", request_id: requestId, data: settled });
		stop(1000, "settled");
	};

	/**
	 * 内存推送：只把静态快照与最新 checkpoint 合成一帧，不读写数据库。
	 * @param checkpoint - 流式调度器发布的最新快照
	 */
	const push = (checkpoint: Record<string, unknown> | null): void => {
		if (stopped || lastPayload === null || checkpoint === null) {
			return;
		}
		try {
			const next = applyLiveCheckpointToDetail(lastPayload, checkpoint);
			const patch = diffLogDetailPayload(lastPayload, next);
			if (Object.keys(patch).length > 0) {
				sendFrame(socket, { type: "patch", request_id: requestId, data: patch });
			}
			lastPayload = next;
		} catch (error) {
			logger.warn(`日志流推送失败: ${(error as Error).message}`);
		}
	};

	/** 兜底轮询：只判断请求是否已经结束，正常情况下实时内容由内存推送。 */
	const poll = async (): Promise<void> => {
		if (stopped || busy) {
			return;
		}
		busy = true;
		try {
			if (Date.now() >= deadline) {
				sendFrame(socket, { type: "timeout", request_id: requestId });
				stop(1000, "timeout");
				return;
			}
			const revision = await readRevision(db, requestId);
			if (!revision.present) {
				await settle();
			}
		} catch (error) {
			logger.warn(`日志流读取失败: ${(error as Error).message}`);
			sendFrame(socket, { type: "error", request_id: requestId, message: "读取日志进展失败" });
			stop(1011, "error");
		} finally {
			busy = false;
		}
	};

	socket.on("close", () => {
		stopped = true;
		unsubscribe();
		unsubscribe = () => undefined;
		if (timer !== null) {
			clearInterval(timer);
			timer = null;
		}
		if (heartbeat !== null) {
			clearInterval(heartbeat);
			heartbeat = null;
		}
	});
	socket.on("error", () => stop(1011, "socket error"));
	socket.on("pong", () => {
		awaitingPong = false;
	});

	heartbeat = setInterval(() => {
		if (awaitingPong) {
			stop(1000, "timeout");
			return;
		}
		awaitingPong = true;
		if (socket.readyState === WebSocket.OPEN) {
			socket.ping();
		}
	}, HEARTBEAT_INTERVAL_MS);
	heartbeat.unref?.();

	let detail: Record<string, unknown> | null;
	try {
		detail = await loadActiveDetail(db, requestId);
	} catch (error) {
		logger.warn(`日志流首帧读取失败: ${(error as Error).message}`);
		sendFrame(socket, { type: "error", request_id: requestId, message: "读取日志进展失败" });
		stop(1011, "error");
		return;
	}
	if (detail === null) {
		await settle();
		return;
	}
	sendFrame(socket, { type: "snapshot", request_id: requestId, data: detail });
	lastPayload = detail;
	// 之后的内容变更只从内存推送；数据库只用来判断这条请求是否已经结束。
	unsubscribe = subscribeLive(requestId, (snapshot) => push(snapshot as Record<string, unknown> | null));
	await poll();
	timer = setInterval(() => void poll(), pollIntervalMs);
	timer.unref?.();
}

/**
 * 注册日志详情流的 WebSocket 升级处理。
 *
 * 鉴权与授权复用 HTTP 侧的中间件；浏览器无法自定义握手头，因此密钥通过
 * `litellm_<key>` 子协议提交（与代理端 WebSocket 透传同一约定）。
 * @param server - HTTP 服务器
 * @param container - 服务容器
 * @param deps - 可注入的数据面（测试用）
 */
export function registerSpendLogStreamWebSocket(
	server: HttpServer,
	container: ServiceContainer,
	deps: SpendLogStreamDeps = {},
): void {
	const webSocketServer = new WebSocketServer({
		noServer: true,
		perMessageDeflate: false,
		handleProtocols: (protocols) => (protocols.has(LOG_STREAM_SUBPROTOCOL) ? LOG_STREAM_SUBPROTOCOL : false),
	});
	let openStreams = 0;

	server.on("upgrade", (incoming, socket, head) => {
		const url = new URL(incoming.url ?? "/", "http://127.0.0.1");
		if (url.pathname !== SPEND_LOG_STREAM_PATH) {
			return;
		}
		guardUpgradeSocket(socket);
		void (async () => {
			const requestId = (url.searchParams.get("request_id") ?? "").trim();
			if (!REQUEST_ID_PATTERN.test(requestId)) {
				throw ApiError.badRequest("request_id 参数无效");
			}
			if (openStreams >= MAX_CONCURRENT_STREAMS) {
				throw ApiError.unavailable("日志流并发连接已达上限");
			}
			const req = expressRequest(incoming, url.pathname, url.searchParams);
			await runMiddleware(container.authMiddleware, req);
			await runMiddleware(container.authorizationGuard.middleware("spend"), req);
			webSocketServer.handleUpgrade(incoming, socket, head, (downstream) => {
				openStreams += 1;
				void streamSpendLogDetail(downstream, requestId, container.db.db, deps)
					.catch((error: unknown) => {
						logger.warn(`日志流异常结束: ${(error as Error).message}`);
					})
					.finally(() => {
						openStreams -= 1;
					});
			});
		})().catch((error: unknown) => {
			writeUpgradeError(socket, error, "日志流连接失败");
		});
	});

	server.once("close", () => webSocketServer.close());
}
