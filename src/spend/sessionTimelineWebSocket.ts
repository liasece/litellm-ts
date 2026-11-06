/**
 * Session 时间线实时流（WebSocket）。
 *
 * Session 模拟面板过去一次性读取 `/spend/logs/session/timeline`，进行中的请求只能看到连上
 * 那一刻的内容。这里提供同源的订阅通道：连上后先收到完整快照，之后只收到变化的事件；
 * 进行中的请求作为 `active_requests` 叠加层随 checkpoint 更新。空闲时每个周期只有两个计数
 * 查询，读取与去重全部复用 `sessionTimelineLive`，推送帧与一次性拉取同形。
 *
 * 连接有最长存活时间（默认 15 分钟）与并发上限；到期发送 timeout 帧后正常关闭，前端据此
 * 重连并重新取快照，避免长连接一直占着服务端状态。
 */

import type { Server as HttpServer } from "node:http";
import WebSocket, { WebSocketServer } from "ws";
import { ApiError } from "../core/api/ApiError";
import { expressRequest, guardUpgradeSocket, runMiddleware, writeUpgradeError } from "../core/http/UpgradeRequest";
import type { ServiceContainer } from "../container";
import type { DrizzleDb } from "../core/db/Database";
import { createModuleLogger } from "../core/utils/logger";
import { LOG_STREAM_SUBPROTOCOL } from "./logStreamProtocol";
import { parseSessionGroupQuery, sessionGroupKey, type SessionGroupRef } from "./sessionGroup";
import {
	DEFAULT_SESSION_TIMELINE_WINDOW,
	createSessionImageLookup,
	createSessionTimelineStreamState,
	type SessionTimelinePayload,
	type SessionTimelineScope,
	type SessionTimelineStreamState,
	type SessionTimelineUpdate,
} from "./sessionTimelineLive";
import {
	resolveActiveRequestVisibilityClause,
	resolveSpendVisibilityClause,
} from "./spendVisibility";

const logger = createModuleLogger("Spend:SessionTimelineStream");

/** 订阅 Session 时间线流的路径。 */
export const SPEND_SESSION_TIMELINE_STREAM_PATH = "/spend/logs/session/timeline/stream";

/** 刷新周期：时间线一次读取比单条日志贵，1 秒足以覆盖 400ms 的 checkpoint 落库节奏。 */
const REFRESH_INTERVAL_MS = 1_000;

/** 单个订阅的最长存活时间，避免浏览器异常退出后连接长期占用。 */
const MAX_STREAM_DURATION_MS = 15 * 60 * 1_000;

/** 握手探活间隔；两个周期内没有 pong 视为断线。 */
const HEARTBEAT_INTERVAL_MS = 25_000;

/** 同时存在的订阅上限，防止管理面被误用刷爆数据库。 */
const MAX_CONCURRENT_STREAMS = 50;

/** 订阅可注入的依赖，便于测试替换数据面与节奏。 */
export interface SessionTimelineStreamWebSocketDeps {
	/** 构造时间线状态；缺省走数据库实现 */
	readonly createState?: (db: DrizzleDb, scope: SessionTimelineScope) => SessionTimelineStreamState;
	/** 刷新周期 */
	readonly refreshIntervalMs?: number;
	/** 单个订阅最长存活时间 */
	readonly maxDurationMs?: number;
}

/** 推送到客户端的一帧；每帧都带订阅目标，客户端据此丢弃不属于当前会话的事件。 */
type StreamFrame =
	| { readonly type: "snapshot"; readonly group: SessionGroupRef; readonly data: SessionTimelinePayload }
	| { readonly type: "update"; readonly group: SessionGroupRef; readonly data: SessionTimelineUpdate }
	| { readonly type: "timeout"; readonly group: SessionGroupRef }
	| { readonly type: "error"; readonly group: SessionGroupRef; readonly message: string };

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
 * 订阅一个会话的时间线，直到超时或客户端断开。
 * @param socket - 已建立的 WebSocket
 * @param group - 会话分组目标
 * @param scope - 已鉴权的读取范围
 * @param db - 数据库实例
 * @param deps - 可注入的数据面与节奏
 */
async function streamSessionTimeline(
	socket: WebSocket,
	group: SessionGroupRef,
	scope: SessionTimelineScope,
	db: DrizzleDb,
	deps: SessionTimelineStreamWebSocketDeps,
): Promise<void> {
	// 快照与 HTTP 一样只取最近窗口，长会话的首帧才不会退化成整段读取。
	const state =
		deps.createState?.(db, scope) ??
		createSessionTimelineStreamState(
			db,
			scope,
			{ findImages: createSessionImageLookup(db, scope.visibilityClause) },
			{ limit: DEFAULT_SESSION_TIMELINE_WINDOW },
		);
	const refreshIntervalMs = deps.refreshIntervalMs ?? REFRESH_INTERVAL_MS;
	const deadline = Date.now() + (deps.maxDurationMs ?? MAX_STREAM_DURATION_MS);

	let stopped = false;
	let busy = false;
	let timer: NodeJS.Timeout | null = null;
	let heartbeat: NodeJS.Timeout | null = null;
	let awaitingPong = false;

	const stop = (code: number, reason: string): void => {
		if (stopped) {
			return;
		}
		stopped = true;
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

	const fail = (message: string, detail: string): void => {
		logger.warn(detail);
		sendFrame(socket, { type: "error", group: group, message: message });
		stop(1011, "error");
	};

	const tick = async (): Promise<void> => {
		if (stopped || busy) {
			return;
		}
		busy = true;
		try {
			if (Date.now() >= deadline) {
				sendFrame(socket, { type: "timeout", group: group });
				stop(1000, "timeout");
				return;
			}
			const update = await state.refresh();
			if (update !== null) {
				sendFrame(socket, { type: "update", group: group, data: update });
			}
		} catch (error) {
			fail("读取会话时间线失败", `会话时间线流刷新失败: ${(error as Error).message}`);
		} finally {
			busy = false;
		}
	};

	socket.on("close", () => {
		stopped = true;
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

	try {
		const snapshot = await state.snapshot();
		sendFrame(socket, { type: "snapshot", group: group, data: snapshot });
	} catch (error) {
		fail("读取会话时间线失败", `会话时间线快照读取失败: ${(error as Error).message}`);
		return;
	}

	timer = setInterval(() => void tick(), refreshIntervalMs);
	timer.unref?.();
}

/**
 * 注册 Session 时间线流的 WebSocket 升级处理。
 *
 * 鉴权与授权复用 HTTP 侧的中间件；浏览器无法自定义握手头，因此密钥通过 `litellm_<key>`
 * 子协议提交（与代理端 WebSocket 透传、日志流同一约定）。
 * @param server - HTTP 服务器
 * @param container - 服务容器
 * @param deps - 可注入的数据面与节奏（测试用）
 */
export function registerSpendSessionTimelineStreamWebSocket(
	server: HttpServer,
	container: ServiceContainer,
	deps: SessionTimelineStreamWebSocketDeps = {},
): void {
	const webSocketServer = new WebSocketServer({
		noServer: true,
		perMessageDeflate: false,
		handleProtocols: (protocols) => (protocols.has(LOG_STREAM_SUBPROTOCOL) ? LOG_STREAM_SUBPROTOCOL : false),
	});
	let openStreams = 0;

	server.on("upgrade", (incoming, socket, head) => {
		const url = new URL(incoming.url ?? "/", "http://127.0.0.1");
		if (url.pathname !== SPEND_SESSION_TIMELINE_STREAM_PATH) {
			return;
		}
		guardUpgradeSocket(socket);
		void (async () => {
			const group = parseSessionGroupQuery(Object.fromEntries(url.searchParams));
			const includeAuxiliary = url.searchParams.get("include_auxiliary") === "true";
			const requestedTeamId = url.searchParams.get("team_id") ?? "";
			if (openStreams >= MAX_CONCURRENT_STREAMS) {
				throw ApiError.unavailable("会话时间线流并发连接已达上限");
			}
			const req = expressRequest(incoming, url.pathname, url.searchParams);
			await runMiddleware(container.authMiddleware, req);
			await runMiddleware(container.authorizationGuard.middleware("spend"), req);
			const visibilityClause = await resolveSpendVisibilityClause(
				container.db.db,
				req.auth,
				requestedTeamId.length > 0 ? requestedTeamId : undefined,
			);
			const scope: SessionTimelineScope = {
				groupKey: sessionGroupKey(group),
				includeAuxiliary: includeAuxiliary,
				visibilityClause: visibilityClause,
				activeVisibilityClause: resolveActiveRequestVisibilityClause(
					req.auth,
					requestedTeamId.length > 0 ? requestedTeamId : undefined,
				),
			};
			webSocketServer.handleUpgrade(incoming, socket, head, (downstream) => {
				openStreams += 1;
				void streamSessionTimeline(downstream, group, scope, container.db.db, deps)
					.catch((error: unknown) => {
						logger.warn(`会话时间线流异常结束: ${(error as Error).message}`);
					})
					.finally(() => {
						openStreams -= 1;
					});
			});
		})().catch((error: unknown) => {
			writeUpgradeError(socket, error, "会话时间线连接失败");
		});
	});

	server.once("close", () => webSocketServer.close());
}
