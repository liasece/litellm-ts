import { getApiBaseUrl } from "../../platform/api/HttpApiClient";
export interface LogDetailsSocketCallbacks {
	open: () => void;
	frame: (frame: Record<string, unknown>) => void;
	close: () => void;
}
export function openLogDetailsSocket(requestId: string, callbacks: LogDetailsSocketCallbacks): () => void {
	const url = new URL(getApiBaseUrl() + "/spend/logs/ui/stream", window.location.origin);
	url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
	url.searchParams.set("request_id", requestId);
	const socket = new WebSocket(url.toString(), ["litellm-log-stream"]);
	let disposed = false;
	socket.onopen = () => {
		if (!disposed) callbacks.open();
	};
	socket.onmessage = (event: MessageEvent<string>) => {
		if (disposed) return;
		try {
			const value: unknown = JSON.parse(event.data);
			if (value !== null && typeof value === "object" && !Array.isArray(value)) callbacks.frame(value as Record<string, unknown>);
		} catch {
			/* Keep the current complete payload when a malformed frame arrives. */
		}
	};
	socket.onclose = () => {
		if (!disposed) callbacks.close();
	};
	socket.onerror = () => {
		if (!disposed) callbacks.close();
	};
	return () => {
		disposed = true;
		socket.onopen = null;
		socket.onmessage = null;
		socket.onclose = null;
		socket.onerror = null;
		if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) socket.close(1000, "client closed");
	};
}
export type LogDetailsSocketFactory = typeof openLogDetailsSocket;
