import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WEB_UI_COOKIE_SESSION_SENTINEL } from "@/utils/webUiSession";
import type {
	SessionActiveTimelineRequest,
	SessionTimelineEvent,
	SessionTimelineResponse,
	SessionTimelineUpdate,
} from "@/components/networking";
import type { SessionGroupRef } from "@/components/view_logs/columns";
import { applySessionTimelineUpdate, sessionTimelineQueryKey, useSessionTimelineStream } from "./useSessionTimelineStream";

const SESSION_GROUP: SessionGroupRef = { type: "session_id", id: "session-1" };
const QUERY_KEY = ["sessionTimeline", "session_id", "session-1", undefined];

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

function event(id: string, content: string, status?: string): SessionTimelineEvent {
	return {
		id: id,
		request_id: "req-1",
		role: "user",
		label: "用户",
		timestamp: "2026-01-01T00:00:00.000Z",
		model: "gpt-test",
		content: content,
		...(status === undefined ? {} : { status: status }),
	};
}

const SUMMARY: SessionTimelineResponse["summary"] = {
	keys: [],
	request_count: 1,
	event_count: 1,
	total_spend: 0,
	total_tokens: 0,
	duration_seconds: 0,
	start_time: null,
	end_time: null,
	filtered_request_count: 0,
	in_progress_request_count: 0,
};

const ACTIVE: SessionActiveTimelineRequest = {
	request_id: "req-active",
	events: [event("req-active:request:0", "partial", "in_progress")],
};

const createQueryClient = () =>
	new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });

const createWrapper = (queryClient: QueryClient) => {
	const QueryWrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
	return QueryWrapper;
};

const renderStream = (queryClient: QueryClient, enabled = true, accessToken: string | null = "test-token") =>
	renderHook(() => useSessionTimelineStream(SESSION_GROUP, undefined, accessToken, enabled), {
		wrapper: createWrapper(queryClient),
	});

describe("applySessionTimelineUpdate", () => {
	it("keeps the server order and replaces the in-progress overlay", () => {
		const previous: SessionTimelineResponse = {
			data: [event("a", "first"), event("b", "second")],
			summary: SUMMARY,
			active_requests: [ACTIVE],
		};
		const update: SessionTimelineUpdate = {
			upsert: [event("b", "second revised")],
			order: ["b", "a"],
			summary: { ...SUMMARY, in_progress_request_count: 0 },
			active_requests: [],
		};

		const merged = applySessionTimelineUpdate(previous, update);

		expect(merged.data.map((item) => [item.id, item.content])).toEqual([
			["b", "second revised"],
			["a", "first"],
		]);
		expect(merged.active_requests).toEqual([]);
		expect(merged.summary.in_progress_request_count).toBe(0);
	});

	it("appends new events when the update omits the order", () => {
		const previous: SessionTimelineResponse = { data: [event("a", "first")], summary: SUMMARY };
		const update: SessionTimelineUpdate = {
			upsert: [event("b", "second")],
			summary: SUMMARY,
			active_requests: [ACTIVE],
		};

		const merged = applySessionTimelineUpdate(previous, update);

		expect(merged.data.map((item) => item.id)).toEqual(["a", "b"]);
		expect(merged.active_requests).toEqual([ACTIVE]);
	});

	it("drops events the server reports as removed", () => {
		const previous: SessionTimelineResponse = {
			data: [event("a", "first"), event("b", "second")],
			summary: SUMMARY,
		};

		const merged = applySessionTimelineUpdate(previous, {
			upsert: [],
			removed: ["b"],
			summary: SUMMARY,
			active_requests: [],
		});

		expect(merged.data.map((item) => item.id)).toEqual(["a"]);
	});

	it("keeps the snapshot window so older pages stay reachable after a push", () => {
		const window = { returned_requests: 50, total_requests: 120, has_more: true, before: "cursor-1", limit: 50 };
		const previous: SessionTimelineResponse = { data: [event("a", "first")], summary: SUMMARY, window: window };

		const merged = applySessionTimelineUpdate(previous, {
			upsert: [event("b", "second")],
			summary: SUMMARY,
			active_requests: [],
		});

		expect(merged.window).toEqual(window);
	});
});

describe("useSessionTimelineStream", () => {
	beforeEach(() => {
		FakeWebSocket.instances = [];
		vi.stubGlobal("WebSocket", FakeWebSocket);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it("subscribes to the timeline stream with the session group and key subprotocol", () => {
		renderStream(createQueryClient());

		expect(FakeWebSocket.instances).toHaveLength(1);
		const socket = FakeWebSocket.instances[0]!;
		expect(socket.url).toBe(
			"ws://localhost:3000/spend/logs/session/timeline/stream?session_group_type=session_id&session_group_id=session-1",
		);
		expect(socket.protocols).toEqual(["litellm_test-token", "litellm-log-stream"]);
	});

	it("cookie 会话下只回显流子协议，靠同源 Cookie 鉴权", () => {
		renderStream(createQueryClient(), true, WEB_UI_COOKIE_SESSION_SENTINEL);

		expect(FakeWebSocket.instances[0]!.protocols).toEqual(["litellm-log-stream"]);
	});

	it("writes the snapshot and merges later updates into the timeline cache", async () => {
		const queryClient = createQueryClient();
		const { result } = renderStream(queryClient);
		const socket = FakeWebSocket.instances[0]!;

		await act(async () => {
			socket.emitOpen();
			socket.emitFrame({
				type: "snapshot",
				group: { type: "session_id", id: "session-1" },
				data: { data: [event("a", "first")], summary: SUMMARY, active_requests: [ACTIVE] },
			});
		});
		await waitFor(() => expect(result.current.streaming).toBe(true));
		expect(queryClient.getQueryData(QUERY_KEY)).toEqual({
			data: [event("a", "first")],
			summary: SUMMARY,
			active_requests: [ACTIVE],
		});

		await act(async () => {
			socket.emitFrame({
				type: "update",
				group: { type: "session_id", id: "session-1" },
				data: {
					upsert: [event("a", "first"), event("b", "second")],
					order: ["a", "b"],
					summary: SUMMARY,
					active_requests: [],
				},
			});
		});

		const cached = queryClient.getQueryData<SessionTimelineResponse>(QUERY_KEY);
		expect(cached?.data.map((item) => item.id)).toEqual(["a", "b"]);
		expect(cached?.active_requests).toEqual([]);
	});

	it("ignores frames addressed to another session group", async () => {
		const queryClient = createQueryClient();
		renderStream(queryClient);
		const socket = FakeWebSocket.instances[0]!;

		await act(async () => {
			socket.emitOpen();
			socket.emitFrame({
				type: "snapshot",
				group: { type: "session_id", id: "session-2" },
				data: { data: [event("a", "leak")], summary: SUMMARY, active_requests: [] },
			});
		});

		expect(queryClient.getQueryData(sessionTimelineQueryKey(SESSION_GROUP, undefined))).toBeUndefined();
	});

	it("closes the socket when the panel closes", async () => {
		const { rerender } = renderHook(
			({ enabled }: { enabled: boolean }) => useSessionTimelineStream(SESSION_GROUP, undefined, "test-token", enabled),
			{ initialProps: { enabled: true }, wrapper: createWrapper(createQueryClient()) },
		);
		const socket = FakeWebSocket.instances[0]!;
		await act(async () => {
			socket.emitOpen();
		});

		rerender({ enabled: false });

		await waitFor(() => expect(socket.closed).toEqual({ code: 1000, reason: "client closed" }));
	});

	it("reconnects after the connection drops so the panel keeps updating", async () => {
		const { result } = renderStream(createQueryClient());
		const socket = FakeWebSocket.instances[0]!;
		await act(async () => {
			socket.emitOpen();
		});
		await waitFor(() => expect(result.current.streaming).toBe(true));

		vi.useFakeTimers();
		await act(async () => {
			socket.emitClose();
		});
		expect(result.current.streaming).toBe(false);
		expect(FakeWebSocket.instances).toHaveLength(1);

		await act(async () => {
			vi.advanceTimersByTime(1_000);
		});

		expect(FakeWebSocket.instances).toHaveLength(2);
		expect(FakeWebSocket.instances[1]!.url).toContain("session_group_id=session-1");
	});

	it("reconnects right away when the server ends the subscription at its lifetime limit", async () => {
		renderStream(createQueryClient());
		const socket = FakeWebSocket.instances[0]!;
		await act(async () => {
			socket.emitOpen();
		});

		vi.useFakeTimers();
		await act(async () => {
			socket.emitFrame({ type: "timeout", group: { type: "session_id", id: "session-1" } });
			socket.emitClose();
		});
		await act(async () => {
			vi.advanceTimersByTime(250);
		});

		expect(FakeWebSocket.instances).toHaveLength(2);
	});

	it("does not open a socket when the stream is disabled or unauthorized", () => {
		renderStream(createQueryClient(), false);
		expect(FakeWebSocket.instances).toHaveLength(0);

		renderStream(createQueryClient(), true, null);
		expect(FakeWebSocket.instances).toHaveLength(0);
	});
});
