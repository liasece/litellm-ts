import { getApiBaseUrl } from "../../platform/api/HttpApiClient";

export interface LogsSocketCallbacks {
	open: () => void;
	frame: (payload: Record<string, unknown>) => void;
	close: () => void;
}
export function openLogsSocket(path: string, callbacks: LogsSocketCallbacks): () => void {
	const url = new URL(getApiBaseUrl() + path, window.location.origin);
	url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
	const socket = new WebSocket(url.toString(), ["litellm-log-stream"]);
	let disposed = false;
	socket.onopen = () => {
		if (!disposed) callbacks.open();
	};
	socket.onclose = () => {
		if (!disposed) callbacks.close();
	};
	socket.onmessage = (event: MessageEvent<string>) => {
		if (disposed) return;
		try {
			const payload: unknown = JSON.parse(event.data);
			if (payload !== null && typeof payload === "object" && !Array.isArray(payload))
				callbacks.frame(payload as Record<string, unknown>);
		} catch {
			/* Ignore malformed notification frames and retain the complete-query fallback. */
		}
	};
	return () => {
		disposed = true;
		socket.onopen = null;
		socket.onclose = null;
		socket.onmessage = null;
		if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) socket.close(1000, "client closed");
	};
}
