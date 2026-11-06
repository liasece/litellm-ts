import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WEB_UI_COOKIE_SESSION_SENTINEL } from "@/utils/webUiSession";
import { LIVE_TAIL_MIN_REQUEST_INTERVAL_MS, useLiveTail } from "./useLiveTail";

class FakeWebSocket {
	static readonly CONNECTING = 0;
	static readonly OPEN = 1;
	static readonly CLOSING = 2;
	static readonly CLOSED = 3;
	static instances: FakeWebSocket[] = [];

	readonly url: string;
	readonly protocols: string[];
	readyState = FakeWebSocket.CONNECTING;
	onopen: ((event: unknown) => void) | null = null;
	onmessage: ((event: { data: string }) => void) | null = null;
	onclose: ((event: unknown) => void) | null = null;
	onerror: ((event: unknown) => void) | null = null;

	constructor(url: string, protocols: string[]) {
		this.url = url;
		this.protocols = protocols;
		FakeWebSocket.instances.push(this);
	}

	close(): void {
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

const renderLiveTail = (
	refresh: () => void,
	options: { enabled?: boolean; intervalMs?: number; accessToken?: string } = {},
) =>
	renderHook(() =>
		useLiveTail({
			enabled: options.enabled ?? true,
			intervalMs: options.intervalMs ?? 2_000,
			accessToken: options.accessToken ?? "test-token",
			onRefresh: refresh,
		}),
	);

describe("useLiveTail", () => {
	let visibility: DocumentVisibilityState;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-11-05T00:00:00Z"));
		FakeWebSocket.instances = [];
		vi.stubGlobal("WebSocket", FakeWebSocket);
		visibility = "visible";
		Object.defineProperty(document, "visibilityState", {
			configurable: true,
			get: () => visibility,
		});
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it("subscribes with the log stream protocol and reports connection state", () => {
		const refresh = vi.fn();
		const { result } = renderLiveTail(refresh);

		expect(FakeWebSocket.instances).toHaveLength(1);
		const socket = FakeWebSocket.instances[0]!;
		expect(socket.url).toBe("ws://localhost:3000/spend/logs/ui/live");
		expect(socket.protocols).toEqual(["litellm_test-token", "litellm-log-stream"]);
		expect(result.current.connected).toBe(false);

		act(() => socket.emitOpen());
		expect(result.current.connected).toBe(true);
	});

	it("cookie 会话下只回显流子协议，靠同源 Cookie 鉴权", () => {
		renderLiveTail(vi.fn(), { accessToken: WEB_UI_COOKIE_SESSION_SENTINEL });

		expect(FakeWebSocket.instances).toHaveLength(1);
		expect(FakeWebSocket.instances[0]!.protocols).toEqual(["litellm-log-stream"]);
	});

	it("refreshes on a change notice but keeps at least 500ms between requests", async () => {
		const refresh = vi.fn();
		renderLiveTail(refresh);
		const socket = FakeWebSocket.instances[0]!;

		act(() => socket.emitOpen());
		act(() => socket.emitFrame({ type: "logs_changed" }));

		await act(async () => {
			await vi.advanceTimersByTimeAsync(LIVE_TAIL_MIN_REQUEST_INTERVAL_MS - 1);
		});
		expect(refresh).not.toHaveBeenCalled();

		await act(async () => {
			await vi.advanceTimersByTimeAsync(1);
		});
		expect(refresh).toHaveBeenCalledTimes(1);

		// 首次请求开始 100ms 后又有变化：必须等到满 500ms 才能再发请求。
		await act(async () => {
			await vi.advanceTimersByTimeAsync(100);
		});
		act(() => socket.emitFrame({ type: "logs_changed" }));
		await act(async () => {
			await vi.advanceTimersByTimeAsync(399);
		});
		expect(refresh).toHaveBeenCalledTimes(1);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(1);
		});
		expect(refresh).toHaveBeenCalledTimes(2);
	});

	it("keeps the configured idle interval as the longest gap without notices", async () => {
		const refresh = vi.fn();
		renderLiveTail(refresh, { intervalMs: 2_000 });

		await act(async () => {
			await vi.advanceTimersByTimeAsync(1_999);
		});
		expect(refresh).not.toHaveBeenCalled();

		await act(async () => {
			await vi.advanceTimersByTimeAsync(1);
		});
		expect(refresh).toHaveBeenCalledTimes(1);
	});

	it("does not refresh while the tab is hidden and catches up when it becomes visible", async () => {
		const refresh = vi.fn();
		renderLiveTail(refresh);
		const socket = FakeWebSocket.instances[0]!;
		act(() => socket.emitOpen());

		visibility = "hidden";
		act(() => socket.emitFrame({ type: "logs_changed" }));
		await act(async () => {
			await vi.advanceTimersByTimeAsync(LIVE_TAIL_MIN_REQUEST_INTERVAL_MS);
		});
		expect(refresh).not.toHaveBeenCalled();

		visibility = "visible";
		await act(async () => {
			document.dispatchEvent(new Event("visibilitychange"));
			await vi.advanceTimersByTimeAsync(0);
		});
		expect(refresh).toHaveBeenCalledTimes(1);
	});

	it("reconnects with backoff and refreshes once the connection is back", async () => {
		const refresh = vi.fn();
		renderLiveTail(refresh);
		const first = FakeWebSocket.instances[0]!;
		act(() => first.emitOpen());

		act(() => first.emitClose());
		await act(async () => {
			await vi.advanceTimersByTimeAsync(1_000);
		});
		expect(FakeWebSocket.instances).toHaveLength(2);

		const second = FakeWebSocket.instances[1]!;
		act(() => second.emitOpen());
		await act(async () => {
			await vi.advanceTimersByTimeAsync(0);
		});
		expect(refresh).toHaveBeenCalledTimes(1);
	});

	it("connects and schedules nothing while Live Tail is disabled", async () => {
		const refresh = vi.fn();
		renderLiveTail(refresh, { enabled: false, intervalMs: 0 });

		await act(async () => {
			await vi.advanceTimersByTimeAsync(10_000);
		});
		expect(FakeWebSocket.instances).toHaveLength(0);
		expect(refresh).not.toHaveBeenCalled();
	});
});
