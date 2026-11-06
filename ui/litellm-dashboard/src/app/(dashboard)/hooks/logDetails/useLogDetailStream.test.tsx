import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WEB_UI_COOKIE_SESSION_SENTINEL } from "@/utils/webUiSession";
import { useLogDetailStream } from "./useLogDetailStream";

const authState = vi.hoisted(() => ({ accessToken: "test-token" as string }));

vi.mock("@/app/(dashboard)/hooks/useAuthorized", () => ({
	default: () => ({ accessToken: authState.accessToken }),
}));

const START_TIME = "2026-11-05T00:00:00Z";
const QUERY_KEY = ["logDetails", "req-1", START_TIME, "test-token"];

class FakeWebSocket {
	static readonly CONNECTING = 0;
	static readonly OPEN = 1;
	static readonly CLOSING = 2;
	static readonly CLOSED = 3;
	static instances: FakeWebSocket[] = [];

	readonly url: string;
	readonly protocols: string[];
	readyState = FakeWebSocket.CONNECTING;
	closed: { code?: number; reason?: string } | null = null;
	onopen: ((event: unknown) => void) | null = null;
	onmessage: ((event: { data: string }) => void) | null = null;
	onclose: ((event: unknown) => void) | null = null;
	onerror: ((event: unknown) => void) | null = null;

	constructor(url: string, protocols: string[]) {
		this.url = url;
		this.protocols = protocols;
		FakeWebSocket.instances.push(this);
	}

	close(code?: number, reason?: string): void {
		if (this.readyState === FakeWebSocket.CLOSED) {
			return;
		}
		this.closed = { code, reason };
		this.readyState = FakeWebSocket.CLOSED;
	}

	emitOpen(): void {
		this.readyState = FakeWebSocket.OPEN;
		this.onopen?.({});
	}

	emitFrame(frame: unknown): void {
		this.onmessage?.({ data: JSON.stringify(frame) });
	}

	emitClose(): void {
		this.readyState = FakeWebSocket.CLOSED;
		this.onclose?.({});
	}
}

const createQueryClient = () =>
	new QueryClient({
		defaultOptions: { queries: { retry: false, gcTime: Infinity } },
	});

const createWrapper = (queryClient: QueryClient) => {
	const QueryWrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
	return QueryWrapper;
};

const renderStream = (
	queryClient: QueryClient,
	requestId: string | undefined = "req-1",
	enabled = true,
) =>
	renderHook(() => useLogDetailStream(requestId, START_TIME, enabled), {
		wrapper: createWrapper(queryClient),
	});

describe("useLogDetailStream", () => {
	beforeEach(() => {
		FakeWebSocket.instances = [];
		vi.stubGlobal("WebSocket", FakeWebSocket);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("subscribes to the stream endpoint with the key subprotocol", async () => {
		const queryClient = createQueryClient();
		const { result } = renderStream(queryClient);

		expect(FakeWebSocket.instances).toHaveLength(1);
		const socket = FakeWebSocket.instances[0]!;
		expect(socket.url).toBe("ws://localhost:3000/spend/logs/ui/stream?request_id=req-1");
		expect(socket.protocols).toEqual(["litellm_test-token", "litellm-log-stream"]);

		await act(async () => {
			socket.emitOpen();
		});
		await waitFor(() => expect(result.current.streaming).toBe(true));

		await act(async () => {
			socket.emitClose();
		});
		await waitFor(() => expect(result.current.streaming).toBe(false));
	});

	it("cookie 会话下只回显流子协议，靠同源 Cookie 鉴权", async () => {
		authState.accessToken = WEB_UI_COOKIE_SESSION_SENTINEL;
		try {
			const queryClient = createQueryClient();
			renderStream(queryClient);

			expect(FakeWebSocket.instances).toHaveLength(1);
			expect(FakeWebSocket.instances[0]!.protocols).toEqual(["litellm-log-stream"]);
		} finally {
			authState.accessToken = "test-token";
		}
	});

	it("writes snapshots and only the changed fields of later patches into the detail cache", async () => {
		const queryClient = createQueryClient();
		renderStream(queryClient);
		const socket = FakeWebSocket.instances[0]!;

		await act(async () => {
			socket.emitOpen();
			socket.emitFrame({
				type: "snapshot",
				request_id: "req-1",
				data: { status: "in_progress", response: { text: "he" }, total_tokens: 0 },
			});
		});
		expect(queryClient.getQueryData(QUERY_KEY)).toEqual({
			status: "in_progress",
			response: { text: "he" },
			total_tokens: 0,
		});

		await act(async () => {
			socket.emitFrame({
				type: "patch",
				request_id: "req-1",
				data: { response: { text: "hello" }, total_tokens: 3 },
			});
		});
		expect(queryClient.getQueryData(QUERY_KEY)).toEqual({
			status: "in_progress",
			response: { text: "hello" },
			total_tokens: 3,
		});
	});

	it("replaces the cache with the settled payload, refreshes the list and stops streaming on final", async () => {
		const queryClient = createQueryClient();
		const invalidate = vi.spyOn(queryClient, "invalidateQueries");
		const { result } = renderStream(queryClient);
		const socket = FakeWebSocket.instances[0]!;
		await act(async () => {
			socket.emitOpen();
			socket.emitFrame({ type: "snapshot", request_id: "req-1", data: { status: "in_progress", total_tokens: 0 } });
		});

		await act(async () => {
			socket.emitFrame({
				type: "final",
				request_id: "req-1",
				data: { messages: [{ role: "user" }], response: { text: "done" } },
			});
		});

		expect(queryClient.getQueryData(QUERY_KEY)).toEqual({
			messages: [{ role: "user" }],
			response: { text: "done" },
		});
		expect(invalidate).toHaveBeenCalledWith({ queryKey: QUERY_KEY });
		expect(invalidate).toHaveBeenCalledWith({ queryKey: ["logs"] });
		expect(socket.closed).toEqual({ code: 1000, reason: "settled" });
		await waitFor(() => expect(result.current.streaming).toBe(false));
	});

	it("unsubscribes when the drawer closes", async () => {
		const queryClient = createQueryClient();
		const { rerender } = renderHook(
			({ enabled }: { enabled: boolean }) => useLogDetailStream("req-1", START_TIME, enabled),
			{ initialProps: { enabled: true }, wrapper: createWrapper(queryClient) },
		);
		const socket = FakeWebSocket.instances[0]!;
		await act(async () => {
			socket.emitOpen();
		});

		rerender({ enabled: false });

		await waitFor(() => expect(socket.closed).toEqual({ code: 1000, reason: "client closed" }));
	});

	it("drops events that do not belong to the subscribed request", async () => {
		const queryClient = createQueryClient();
		renderStream(queryClient);
		const socket = FakeWebSocket.instances[0]!;
		await act(async () => {
			socket.emitOpen();
		});

		await act(async () => {
			socket.emitFrame({ type: "patch", request_id: "req-other", data: { response: { text: "leak" } } });
		});

		expect(queryClient.getQueryData(QUERY_KEY)).toBeUndefined();
		expect(socket.closed).toEqual({ code: 1000, reason: "unexpected request" });
	});

	it("switches the subscription when the target log changes", async () => {
		const queryClient = createQueryClient();
		const { rerender } = renderHook(({ requestId }: { requestId: string }) => useLogDetailStream(requestId, START_TIME, true), {
			initialProps: { requestId: "req-1" },
			wrapper: createWrapper(queryClient),
		});
		const first = FakeWebSocket.instances[0]!;
		await act(async () => {
			first.emitOpen();
		});

		rerender({ requestId: "req-2" });

		expect(first.closed).toEqual({ code: 1000, reason: "client closed" });
		expect(FakeWebSocket.instances).toHaveLength(2);
		expect(FakeWebSocket.instances[1]!.url).toBe("ws://localhost:3000/spend/logs/ui/stream?request_id=req-2");

		// 旧连接的迟到帧不得污染新日志的缓存。
		await act(async () => {
			first.emitFrame({ type: "patch", request_id: "req-1", data: { response: { text: "stale" } } });
		});
		expect(queryClient.getQueryData(["logDetails", "req-2", START_TIME, "test-token"])).toBeUndefined();
	});

	it("does not open a socket when the stream is disabled", () => {
		const queryClient = createQueryClient();
		renderStream(queryClient, "req-1", false);

		expect(FakeWebSocket.instances).toHaveLength(0);
	});
});
