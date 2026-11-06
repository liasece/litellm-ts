import { useEffect, useRef, useState } from "react";
import { buildWebSocketCredentialProtocols } from "@/utils/webUiSession";
import { proxyBaseUrl } from "../networking";

/** 日志列表变化通知端点，与 src/spend/logUpdatesWebSocket.ts 保持一致。 */
const LIVE_TAIL_PATH = "/spend/logs/ui/live";

/** 客户端必须回显的日志流握手子协议；密钥（如有）由 `buildWebSocketCredentialProtocols` 追加。 */
const LIVE_TAIL_SUBPROTOCOL = "litellm-log-stream";

/** 两次完整列表请求之间的最小间隔（毫秒）。 */
export const LIVE_TAIL_MIN_REQUEST_INTERVAL_MS = 500;

const RECONNECT_BASE_DELAY_MS = 1_000;
const RECONNECT_MAX_DELAY_MS = 30_000;

/** 服务端推来的变化帧；只使用类型，不使用任何日志数据。 */
interface LiveTailFrame {
	readonly type?: string;
}

export interface LiveTailOptions {
	/** 是否开启 Live Tail；关闭、翻页或切到其他页签时停止连接与调度。 */
	readonly enabled: boolean;
	/** 没有变化消息时的最长空闲间隔。 */
	readonly intervalMs: number;
	readonly accessToken: string | null;
	/** 收到变化或到达空闲间隔时，用完整日志接口重取数据。 */
	readonly onRefresh: () => void | Promise<unknown>;
}

export interface LiveTailState {
	/** 长连接是否已建立；断开时仍会按空闲间隔兜底刷新。 */
	readonly connected: boolean;
}

/**
 * Live Tail 的长连接订阅与刷新调度。
 *
 * 长连接只告诉客户端「列表有变化」，刷新数据仍走 `onRefresh` 指向的完整日志接口。
 * 调度规则：
 * - 收到变化消息后尽快刷新，但两次请求开始时间至少相隔 500ms；
 * - 即使没有消息，空闲超过 `intervalMs` 也会刷新一次，作为漏通知与断线时的兜底；
 * - 标签页隐藏时不发请求，回到前台后按上述间隔补一次；
 * - 连接断开后指数退避重连，重连成功时补一次刷新，避免漏掉断线期间的变化。
 *
 * @param options - 连接与调度参数
 * @returns 长连接状态
 */
export function useLiveTail({ enabled, intervalMs, accessToken, onRefresh }: LiveTailOptions): LiveTailState {
	const [connected, setConnected] = useState(false);
	const refreshRef = useRef(onRefresh);
	const signalRef = useRef<() => void>(() => undefined);

	useEffect(() => {
		refreshRef.current = onRefresh;
	}, [onRefresh]);

	// 调度与连接分开：切换刷新间隔只改变兜底到期时间，不重建 WebSocket。
	useEffect(() => {
		if (!enabled || intervalMs <= 0) {
			return;
		}
		let stopped = false;
		let timer: number | null = null;
		let timerAt = Number.POSITIVE_INFINITY;
		let lastRequestAt = Date.now();
		let inFlight = false;
		let pending = false;

		const isHidden = (): boolean => typeof document !== "undefined" && document.visibilityState === "hidden";

		/**
		 * 在指定时刻安排下一次刷新；已有更早的定时器时不延后它。
		 * @param at - 目标时刻（毫秒时间戳）
		 */
		function arm(at: number): void {
			if (stopped || inFlight) {
				return;
			}
			const due = Math.max(at, Date.now());
			if (timer !== null && timerAt <= due) {
				return;
			}
			if (timer !== null) {
				window.clearTimeout(timer);
			}
			timerAt = due;
			timer = window.setTimeout(run, due - Date.now());
		}

		/** 执行一次完整日志请求，并按是否还有未处理的变化决定下一次到期时间。 */
		function run(): void {
			timer = null;
			timerAt = Number.POSITIVE_INFINITY;
			if (stopped || inFlight) {
				return;
			}
			if (isHidden()) {
				// 回到前台时由 visibilitychange 重新安排，隐藏期间不产生请求。
				return;
			}
			inFlight = true;
			pending = false;
			lastRequestAt = Date.now();
			void Promise.resolve()
				.then(() => refreshRef.current())
				.catch(() => undefined)
				.finally(() => {
					inFlight = false;
					if (stopped) {
						return;
					}
					arm(pending ? lastRequestAt + LIVE_TAIL_MIN_REQUEST_INTERVAL_MS : lastRequestAt + intervalMs);
				});
		}

		signalRef.current = (): void => {
			if (stopped) {
				return;
			}
			pending = true;
			arm(lastRequestAt + LIVE_TAIL_MIN_REQUEST_INTERVAL_MS);
		};

		const handleVisibilityChange = (): void => {
			if (stopped || isHidden()) {
				return;
			}
			arm(pending ? lastRequestAt + LIVE_TAIL_MIN_REQUEST_INTERVAL_MS : lastRequestAt + intervalMs);
		};

		document.addEventListener("visibilitychange", handleVisibilityChange);
		arm(lastRequestAt + intervalMs);

		return () => {
			stopped = true;
			signalRef.current = () => undefined;
			if (timer !== null) {
				window.clearTimeout(timer);
				timer = null;
			}
			document.removeEventListener("visibilitychange", handleVisibilityChange);
		};
	}, [enabled, intervalMs]);

	useEffect(() => {
		if (!enabled || !accessToken || typeof WebSocket === "undefined") {
			return;
		}
		let disposed = false;
		let socket: WebSocket | null = null;
		let reconnectTimer: number | null = null;
		let attempt = 0;
		let everConnected = false;

		const scheduleReconnect = (): void => {
			if (disposed || reconnectTimer !== null) {
				return;
			}
			const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** attempt, RECONNECT_MAX_DELAY_MS);
			attempt += 1;
			reconnectTimer = window.setTimeout(() => {
				reconnectTimer = null;
				connect();
			}, delay);
		};

		const connect = (): void => {
			if (disposed) {
				return;
			}
			let next: WebSocket;
			try {
				const url = new URL(`${proxyBaseUrl ?? ""}${LIVE_TAIL_PATH}`, window.location.origin);
				url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
				next = new WebSocket(url.toString(), [...buildWebSocketCredentialProtocols(accessToken), LIVE_TAIL_SUBPROTOCOL]);
			} catch {
				scheduleReconnect();
				return;
			}
			socket = next;
			next.onopen = () => {
				if (disposed) {
					return;
				}
				setConnected(true);
				attempt = 0;
				if (everConnected) {
					// 断线期间的变化不会再推送，重连时用一次完整请求补齐。
					signalRef.current();
				}
				everConnected = true;
			};
			next.onmessage = (event: MessageEvent<string>) => {
				if (disposed) {
					return;
				}
				let frame: LiveTailFrame;
				try {
					frame = JSON.parse(event.data) as LiveTailFrame;
				} catch {
					return;
				}
				if (frame.type === "logs_changed") {
					signalRef.current();
				}
			};
			next.onclose = () => {
				if (disposed) {
					return;
				}
				setConnected(false);
				scheduleReconnect();
			};
		};

		connect();

		return () => {
			disposed = true;
			if (reconnectTimer !== null) {
				window.clearTimeout(reconnectTimer);
				reconnectTimer = null;
			}
			if (socket !== null) {
				socket.onopen = null;
				socket.onmessage = null;
				socket.onclose = null;
				if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) {
					socket.close(1000, "client closed");
				}
			}
			setConnected(false);
		};
	}, [enabled, accessToken]);

	return { connected: enabled && connected };
}
