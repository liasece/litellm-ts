/**
 * 日志列表实时变化通知（WebSocket）。
 *
 * 这条长连接只负责告诉浏览器「日志列表有变化了」，不承载任何日志数据：客户端收到
 * `logs_changed` 后仍调用 `/spend/logs/ui` 取完整列表。这样列表的查询、权限裁剪与
 * 形状都只有一个来源，推送通道只决定什么时候值得再查一次。
 *
 * 变化来源见 `spendLogChangeFeed`；一次性批量写入（例如一次落账同时删在途行）会在
 * 100ms 窗口内合并成一帧，避免多个浏览器为同一次变化重复收敛。
 */

import type { Server as HttpServer } from "node:http";
import WebSocket, { WebSocketServer } from "ws";
import { ApiError } from "../core/api/ApiError";
import { expressRequest, guardUpgradeSocket, runMiddleware, writeUpgradeError } from "../core/http/UpgradeRequest";
import type { ServiceContainer } from "../container";
import { createModuleLogger } from "../core/utils/logger";
import { LOG_STREAM_SUBPROTOCOL } from "./logStreamProtocol";
import { subscribeSpendLogChanges } from "./spendLogChangeFeed";

const logger = createModuleLogger("Spend:LogUpdates");

/** 日志列表变化通知的订阅路径。 */
export const SPEND_LOG_UPDATES_PATH = "/spend/logs/ui/live";

/** 变化帧的合并窗口：一次落账可能连续触发多条通知，只保留一帧。 */
const CHANGE_COALESCE_MS = 100;

/** 连接探活间隔；两个周期内没有 pong 视为断线。 */
const HEARTBEAT_INTERVAL_MS = 25_000;

/** 同时存在的订阅上限，防止管理面被误用刷爆文件描述符。 */
const MAX_CONCURRENT_UPDATES = 100;

/** 帧里只有类型，不带任何日志内容。 */
const CHANGED_FRAME = JSON.stringify({ type: "logs_changed" });

/**
 * 注册日志列表变化通知的 WebSocket 升级处理。
 *
 * 鉴权与授权复用 HTTP 侧中间件，安全边界与 `/spend/logs/ui` 一致；成功升级后的连接
 * 只等待变化通知，空闲时不产生数据库读取。
 * @param server - HTTP 服务器
 * @param container - 服务容器
 */
export function registerSpendLogUpdatesWebSocket(server: HttpServer, container: ServiceContainer): void {
	const webSocketServer = new WebSocketServer({
		noServer: true,
		perMessageDeflate: false,
		handleProtocols: (protocols) => (protocols.has(LOG_STREAM_SUBPROTOCOL) ? LOG_STREAM_SUBPROTOCOL : false),
	});
	const clients = new Set<WebSocket>();
	let coalesceTimer: NodeJS.Timeout | null = null;

	const broadcast = (): void => {
		coalesceTimer = null;
		for (const client of clients) {
			if (client.readyState !== WebSocket.OPEN) {
				continue;
			}
			try {
				client.send(CHANGED_FRAME);
			} catch {
				// 客户端可能在检查与发送之间关闭；清理交给 close 事件。
			}
		}
	};

	const unsubscribe = subscribeSpendLogChanges(() => {
		if (clients.size === 0 || coalesceTimer !== null) {
			return;
		}
		coalesceTimer = setTimeout(broadcast, CHANGE_COALESCE_MS);
		coalesceTimer.unref?.();
	});

	server.on("upgrade", (incoming, socket, head) => {
		const url = new URL(incoming.url ?? "/", "http://127.0.0.1");
		if (url.pathname !== SPEND_LOG_UPDATES_PATH) {
			return;
		}
		guardUpgradeSocket(socket);
		void (async () => {
			const req = expressRequest(incoming, url.pathname, url.searchParams);
			await runMiddleware(container.authMiddleware, req);
			await runMiddleware(container.authorizationGuard.middleware("spend"), req);
			if (clients.size >= MAX_CONCURRENT_UPDATES) {
				throw ApiError.unavailable("日志列表订阅连接已达上限");
			}
			webSocketServer.handleUpgrade(incoming, socket, head, (downstream) => {
				clients.add(downstream);
				let awaitingPong = false;
				const heartbeat = setInterval(() => {
					if (awaitingPong) {
						downstream.terminate();
						return;
					}
					awaitingPong = true;
					if (downstream.readyState === WebSocket.OPEN) {
						downstream.ping();
					}
				}, HEARTBEAT_INTERVAL_MS);
				heartbeat.unref?.();
				downstream.on("pong", () => {
					awaitingPong = false;
				});
				downstream.on("close", () => {
					clearInterval(heartbeat);
					clients.delete(downstream);
				});
				downstream.on("error", () => {
					downstream.terminate();
				});
			});
		})().catch((error: unknown) => {
			logger.warn(`日志列表订阅连接失败: ${(error as Error).message}`);
			writeUpgradeError(socket, error, "日志列表订阅连接失败");
		});
	});

	server.once("close", () => {
		unsubscribe();
		if (coalesceTimer !== null) {
			clearTimeout(coalesceTimer);
			coalesceTimer = null;
		}
		for (const client of clients) {
			client.terminate();
		}
		clients.clear();
		webSocketServer.close();
	});
}
