import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { buildWebSocketCredentialProtocols } from "@/utils/webUiSession";
import {
	proxyBaseUrl,
	type SessionTimelineEvent,
	type SessionTimelineResponse,
	type SessionTimelineUpdate,
} from "@/components/networking";
import type { SessionGroupRef } from "@/components/view_logs/columns";

/** 后端 Session 时间线流的路径，与 src/spend/sessionTimelineWebSocket.ts 保持一致。 */
const SESSION_TIMELINE_STREAM_PATH = "/spend/logs/session/timeline/stream";

/** 浏览器必须回显的握手子协议；密钥（如有）由 `buildWebSocketCredentialProtocols` 追加。 */
const STREAM_SUBPROTOCOL = "litellm-log-stream";

/** 连接中断后的重连退避：1 秒起步、指数增长、上限 30 秒。 */
const RECONNECT_BASE_DELAY_MS = 1_000;
const RECONNECT_MAX_DELAY_MS = 30_000;

/** 服务端因最长存活时间关闭连接后，立即重连以重新取快照。 */
const RECONNECT_IMMEDIATE_DELAY_MS = 250;

/** 服务端推来的一帧；每帧都带订阅目标，便于丢弃过期订阅的事件。 */
interface SessionTimelineFrame {
	readonly type?: string;
	readonly group?: { readonly type?: string; readonly id?: string };
	readonly data?: unknown;
	readonly message?: string;
}

export interface SessionTimelineStreamState {
	/** 是否已连上时间线流；连接活跃时面板内容随推送更新。 */
	readonly streaming: boolean;
}

/**
 * 时间线查询缓存键。
 *
 * 与抽屉里的 useQuery 使用同一个键，推送帧直接写进缓存，面板各分区无需感知数据来自
 * 一次性读取还是长连接。
 * @param sessionGroup - 会话分组
 * @param teamId - 可选 team 过滤
 */
export const sessionTimelineQueryKey = (sessionGroup: SessionGroupRef, teamId: string | undefined) =>
	["sessionTimeline", sessionGroup.type, sessionGroup.id, teamId] as const;

/**
 * 把一次增量帧合并进缓存里的时间线。
 *
 * 已落库事件按 id 覆盖并保持服务端给的顺序，进行中事件组整体替换。请求结算时同一事件 id
 * 从 `active_requests` 移到 `data`，渲染位置不变，因此不会出现事件闪断。
 * @param previous - 缓存里的时间线；首次收到增量时为 undefined
 * @param update - 服务端推送的增量
 */
export function applySessionTimelineUpdate(
	previous: SessionTimelineResponse | undefined,
	update: SessionTimelineUpdate,
): SessionTimelineResponse {
	const eventsById = new Map<string, SessionTimelineEvent>();
	for (const event of previous?.data ?? []) {
		eventsById.set(event.id, event);
	}
	for (const event of update.upsert) {
		eventsById.set(event.id, event);
	}
	for (const id of update.removed ?? []) {
		eventsById.delete(id);
	}
	const previousOrder = (previous?.data ?? []).map((event) => event.id).filter((id) => eventsById.has(id));
	const appendedOrder = update.upsert.map((event) => event.id).filter((id) => !previousOrder.includes(id));
	const order = update.order ?? [...previousOrder, ...appendedOrder];
	const data = order.flatMap((id) => {
		const event = eventsById.get(id);
		return event ? [event] : [];
	});
	// 窗口信息来自快照，增量帧不携带；丢掉它会让“加载更早”按钮在第一次推送后消失。
	return {
		data: data,
		summary: update.summary,
		active_requests: update.active_requests,
		...(previous?.window ? { window: previous.window } : {}),
	};
}

/**
 * 订阅一个会话的时间线长连接。
 *
 * 连上后先收到完整快照，之后只收到变化的事件；进行中的请求作为 `active_requests` 叠加层随
 * checkpoint 更新。服务端因最长存活时间关闭连接时立即重连，异常断开按指数退避重连，重连后
 * 服务端会重新发送快照，所以本地缓存总能回到一致状态。
 *
 * 连接不可用（反向代理未透传 upgrade、浏览器不支持等）时 `streaming` 保持 false，面板继续
 * 显示一次性读取的结果。
 * @param sessionGroup - 目标会话分组
 * @param teamId - 可选 team 过滤
 * @param accessToken - 当前登录令牌；缺失时不建立连接
 * @param enabled - 是否开启订阅（面板打开）
 */
export const useSessionTimelineStream = (
	sessionGroup: SessionGroupRef,
	teamId: string | undefined,
	accessToken: string | null,
	enabled: boolean,
): SessionTimelineStreamState => {
	const queryClient = useQueryClient();
	const [streaming, setStreaming] = useState(false);
	const reconnectAttempt = useRef(0);
	const groupType = sessionGroup.type;
	const groupId = sessionGroup.id;

	useEffect(() => {
		if (!enabled || !accessToken || typeof WebSocket === "undefined") {
			return;
		}
		const queryKey = sessionTimelineQueryKey({ type: groupType, id: groupId }, teamId);
		let disposed = false;
		let socket: WebSocket | null = null;
		let retryTimer: ReturnType<typeof setTimeout> | null = null;
		let serverTimedOut = false;

		const clearRetry = (): void => {
			if (retryTimer !== null) {
				clearTimeout(retryTimer);
				retryTimer = null;
			}
		};

		const matchesSubscription = (frame: SessionTimelineFrame): boolean =>
			frame.group?.type === groupType && frame.group?.id === groupId;

		const connect = (): void => {
			retryTimer = null;
			if (disposed) {
				return;
			}
			let next: WebSocket;
			try {
				const url = new URL(`${proxyBaseUrl ?? ""}${SESSION_TIMELINE_STREAM_PATH}`, window.location.origin);
				url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
				url.searchParams.set("session_group_type", groupType);
				url.searchParams.set("session_group_id", groupId);
				if (teamId) {
					url.searchParams.set("team_id", teamId);
				}
				next = new WebSocket(url.toString(), [...buildWebSocketCredentialProtocols(accessToken), STREAM_SUBPROTOCOL]);
			} catch {
				return;
			}
			socket = next;

			next.onopen = () => {
				if (disposed) {
					return;
				}
				reconnectAttempt.current = 0;
				serverTimedOut = false;
				setStreaming(true);
			};

			next.onmessage = (event: MessageEvent<string>) => {
				if (disposed) {
					return;
				}
				let frame: SessionTimelineFrame;
				try {
					frame = JSON.parse(event.data) as SessionTimelineFrame;
				} catch {
					return;
				}
				if (!matchesSubscription(frame)) {
					return;
				}
				if (frame.type === "snapshot") {
					queryClient.setQueryData(queryKey, frame.data as SessionTimelineResponse);
					return;
				}
				if (frame.type === "update") {
					const update = frame.data as SessionTimelineUpdate;
					queryClient.setQueryData(queryKey, (previous: SessionTimelineResponse | undefined) =>
						applySessionTimelineUpdate(previous, update),
					);
					return;
				}
				if (frame.type === "timeout") {
					serverTimedOut = true;
				}
			};

			next.onclose = () => {
				if (disposed || socket !== next) {
					return;
				}
				setStreaming(false);
				const immediate = serverTimedOut;
				serverTimedOut = false;
				if (immediate) {
					reconnectAttempt.current = 0;
					retryTimer = setTimeout(connect, RECONNECT_IMMEDIATE_DELAY_MS);
					return;
				}
				const attempt = reconnectAttempt.current;
				reconnectAttempt.current = attempt + 1;
				retryTimer = setTimeout(connect, Math.min(RECONNECT_MAX_DELAY_MS, RECONNECT_BASE_DELAY_MS * 2 ** attempt));
			};

			next.onerror = () => {
				// 断开由 onclose 统一处理重连，这里不重复调度。
			};
		};

		connect();

		return () => {
			disposed = true;
			clearRetry();
			setStreaming(false);
			if (socket !== null) {
				const current = socket;
				socket = null;
				current.onopen = null;
				current.onmessage = null;
				current.onclose = null;
				current.onerror = null;
				if (current.readyState === WebSocket.CONNECTING || current.readyState === WebSocket.OPEN) {
					current.close(1000, "client closed");
				}
			}
		};
	}, [enabled, accessToken, groupType, groupId, teamId, queryClient]);

	return { streaming };
};
