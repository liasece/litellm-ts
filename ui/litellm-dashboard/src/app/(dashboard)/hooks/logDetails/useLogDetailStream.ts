import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import useAuthorized from "@/app/(dashboard)/hooks/useAuthorized";
import { buildWebSocketCredentialProtocols } from "@/utils/webUiSession";
import { proxyBaseUrl } from "@/components/networking";

/** 后端日志详情流的路径，与 src/spend/logStreamWebSocket.ts 保持一致。 */
const SPEND_LOG_STREAM_PATH = "/spend/logs/ui/stream";

/** 浏览器必须回显的握手子协议；密钥（如有）由 `buildWebSocketCredentialProtocols` 追加。 */
const STREAM_SUBPROTOCOL = "litellm-log-stream";

/** 服务端推来的一帧；每帧都带订阅目标，便于丢弃过期订阅的事件。 */
interface LogStreamFrame {
	readonly type?: string;
	readonly request_id?: string;
	readonly data?: Record<string, unknown> | null;
	readonly message?: string;
}

export interface LogDetailStreamState {
	/** 是否已连上日志流；连接活跃时详情查询不再轮询。 */
	readonly streaming: boolean;
}

/**
 * 订阅单个请求的日志详情流。
 *
 * 进行中的请求由服务端在每次 checkpoint 变化时推送增量帧，写入与 `/spend/logs/ui/:request_id`
 * 相同的查询缓存，因此详情页各分区无需感知数据来自推送还是轮询。请求结束后服务端发出
 * `final` 帧并断开，这里改用最终的已落库负载并刷新列表，避免残留进行中的字段。
 *
 * 订阅只在确实关心这份日志时存在：抽屉关闭（`enabled` 变 false）、切换到另一条日志、
 * 请求已结束、或收到不属于当前 `request_id` 的帧时立即断开，服务端随之停止推送。
 * 连接不可用（反向代理未透传 upgrade、浏览器不支持等）时 `streaming` 保持 false，
 * 调用方继续使用原有的轮询路径。
 *
 * @param requestId - 目标请求 ID
 * @param startTime - 列表行的时间戳，用于命中详情查询缓存
 * @param enabled - 是否开启订阅（抽屉打开且请求仍在进行中）
 */
export const useLogDetailStream = (
	requestId: string | undefined,
	startTime: string | undefined,
	enabled: boolean,
): LogDetailStreamState => {
	const { accessToken } = useAuthorized();
	const queryClient = useQueryClient();
	const [streaming, setStreaming] = useState(false);

	useEffect(() => {
		if (!enabled || !requestId || !startTime || !accessToken || typeof WebSocket === "undefined") {
			return;
		}
		const queryKey = ["logDetails", requestId, startTime, accessToken];
		let socket: WebSocket;
		try {
			const url = new URL(`${proxyBaseUrl ?? ""}${SPEND_LOG_STREAM_PATH}`, window.location.origin);
			url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
			url.searchParams.set("request_id", requestId);
			socket = new WebSocket(url.toString(), [...buildWebSocketCredentialProtocols(accessToken), STREAM_SUBPROTOCOL]);
		} catch {
			return;
		}

		// 一次订阅只服务一个 request_id；任何"不再关心"的信号都应立刻断连，不留下幽灵连接。
		let unsubscribed = false;
		const unsubscribe = (reason: string): void => {
			if (unsubscribed) {
				return;
			}
			unsubscribed = true;
			socket.onopen = null;
			socket.onmessage = null;
			socket.onerror = null;
			socket.onclose = null;
			if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) {
				socket.close(1000, reason);
			}
			setStreaming(false);
		};

		socket.onopen = () => {
			if (!unsubscribed) {
				setStreaming(true);
			}
		};

		socket.onmessage = (event: MessageEvent<string>) => {
			if (unsubscribed) {
				return;
			}
			let frame: LogStreamFrame;
			try {
				frame = JSON.parse(event.data) as LogStreamFrame;
			} catch {
				return;
			}
			// 帧自报的目标与本次订阅不一致（切换过日志、服务端串流）时，这条连接已经无用。
			if (frame.request_id !== undefined && frame.request_id !== requestId) {
				unsubscribe("unexpected request");
				return;
			}
			if (frame.type === "snapshot" && frame.data) {
				queryClient.setQueryData(queryKey, frame.data);
				return;
			}
			if (frame.type === "patch" && frame.data) {
				queryClient.setQueryData(queryKey, (previous: Record<string, unknown> | null | undefined) => ({
					...(previous ?? {}),
					...frame.data,
				}));
				return;
			}
			if (frame.type === "final") {
				// 最终负载来自 SpendLogs，形状与进行中不同：整体替换，随后刷新一次拿到完整详情。
				queryClient.setQueryData(queryKey, frame.data ?? null);
				void queryClient.invalidateQueries({ queryKey });
				void queryClient.invalidateQueries({ queryKey: ["logs"] });
				unsubscribe("settled");
				return;
			}
			if (frame.type === "gone") {
				void queryClient.invalidateQueries({ queryKey });
				void queryClient.invalidateQueries({ queryKey: ["logs"] });
				unsubscribe("gone");
				return;
			}
			if (frame.type === "timeout" || frame.type === "error") {
				// 服务端不再推送：交回轮询，避免界面停更。
				unsubscribe(frame.type);
			}
		};

		socket.onclose = () => {
			if (!unsubscribed) {
				unsubscribed = true;
				setStreaming(false);
			}
		};
		socket.onerror = () => {
			if (!unsubscribed) {
				unsubscribed = true;
				setStreaming(false);
			}
		};

		return () => unsubscribe("client closed");
	}, [enabled, requestId, startTime, accessToken, queryClient]);

	return { streaming };
};
