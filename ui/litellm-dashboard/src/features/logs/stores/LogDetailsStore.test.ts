import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLogDetailsStore } from "./LogDetailsStore";
import type { LogEntry } from "../support/LogsModels";
import type { LogDetailsSocketCallbacks } from "../api/LogDetailsSocketApi";
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => (resolve = done));
	return { promise, resolve };
}
const row = (id = "one", progress = true): LogEntry => ({
	request_id: id,
	startTime: "2026-11-07T02:00:00Z",
	...(progress ? { status: "in_progress", metadata: { status: "in_progress" } } : { metadata: { status: "success" } }),
});
function harness(initial: Record<string, unknown> | null = { status: "in_progress" }) {
	let callbacks!: LogDetailsSocketCallbacks;
	const detail = vi.fn().mockResolvedValue(initial),
		stop = vi.fn(),
		settled = vi.fn();
	const socket = vi.fn((_id: string, next: LogDetailsSocketCallbacks) => {
		callbacks = next;
		return stop;
	});
	const store = createLogDetailsStore({ api: { detail }, socket, settled });
	return { store, detail, stop, settled, socket, callbacks: () => callbacks };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
describe("log detail streaming and lazy reads", () => {
	it("preserves request references across patches, suppresses polling while connected, and falls back every two seconds", async () => {
		const h = harness(),
			messages = [{ role: "user", content: "Stable prompt" }];
		h.store.bind(row(), "2026-11-07");
		await Promise.resolve();
		h.callbacks().open();
		h.callbacks().frame({
			type: "snapshot",
			request_id: "one",
			data: { status: "in_progress", messages, response: { text: "first" } },
		});
		h.callbacks().frame({ type: "patch", request_id: "one", data: { response: { text: "second" }, total_tokens: 12 } });
		expect(h.store.enriched.value?.messages).toBe(messages);
		expect(h.store.enriched.value?.response).toEqual({ text: "second" });
		await vi.advanceTimersByTimeAsync(4000);
		expect(h.detail).toHaveBeenCalledTimes(1);
		h.callbacks().close();
		await vi.advanceTimersByTimeAsync(1999);
		expect(h.detail).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(h.detail).toHaveBeenCalledTimes(2);
		h.store.dispose();
	});
	it("treats a non-null settled detail as authoritative even when the list still says in progress", async () => {
		const h = harness({ messages: [], response: { choices: [] } });
		h.store.bind(row(), "day");
		await vi.advanceTimersByTimeAsync(0);
		expect(h.store.inProgress.value).toBe(false);
		expect(h.stop).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(10000);
		expect(h.detail).toHaveBeenCalledTimes(1);
		h.store.close();
		h.store.bind(row(), "day");
		await vi.advanceTimersByTimeAsync(0);
		expect(h.store.inProgress.value).toBe(false);
		expect(h.detail).toHaveBeenCalledTimes(1);
		h.store.dispose();
	});
	it("keeps polling the in-progress payload after the list settles, then stops on the stored result", async () => {
		const h = harness();
		h.store.bind(row(), "day");
		await vi.advanceTimersByTimeAsync(0);
		h.callbacks().open();
		h.store.bind(row("one", false), "day");
		await vi.advanceTimersByTimeAsync(0);
		expect(h.detail).toHaveBeenCalledTimes(2);
		expect(h.store.inProgress.value).toBe(true);
		h.detail.mockResolvedValue({ response: { text: "stored" } });
		await vi.advanceTimersByTimeAsync(2000);
		expect(h.detail).toHaveBeenCalledTimes(3);
		expect(h.store.inProgress.value).toBe(false);
		await vi.advanceTimersByTimeAsync(4000);
		expect(h.detail).toHaveBeenCalledTimes(3);
		h.store.dispose();
	});
	it("does not let an older HTTP read overwrite a final frame and refetches the settled payload once", async () => {
		const pending = deferred<Record<string, unknown> | null>(),
			h = harness();
		h.detail.mockReturnValueOnce(pending.promise).mockResolvedValue({ response: { text: "stored final" } });
		h.store.bind(row(), "day");
		h.callbacks().open();
		h.callbacks().frame({ type: "snapshot", data: { status: "in_progress", response: { text: "partial" } } });
		h.callbacks().frame({ type: "final", data: { response: { text: "frame final" } } });
		expect(h.store.enriched.value?.response).toEqual({ text: "frame final" });
		pending.resolve({ status: "in_progress", response: { text: "old read" } });
		await vi.advanceTimersByTimeAsync(0);
		expect(h.store.enriched.value?.response).toEqual({ text: "stored final" });
		expect(h.settled).toHaveBeenCalledTimes(1);
		expect(h.detail).toHaveBeenCalledTimes(2);
		h.store.dispose();
	});
	it.each(["gone", "timeout", "error"])("handles a %s frame without keeping a dead subscription", async (type) => {
		const h = harness();
		h.store.bind(row(), "day");
		await vi.advanceTimersByTimeAsync(0);
		h.callbacks().open();
		h.callbacks().frame({ type });
		expect(h.store.state.streaming).toBe(false);
		expect(h.stop).toHaveBeenCalledTimes(1);
		if (type === "gone") {
			await vi.advanceTimersByTimeAsync(0);
			expect(h.settled).toHaveBeenCalledTimes(1);
			expect(h.detail).toHaveBeenCalledTimes(2);
		} else {
			await vi.advanceTimersByTimeAsync(2000);
			expect(h.detail).toHaveBeenCalledTimes(2);
		}
		h.store.dispose();
	});
	it("ignores a stale selection's HTTP result and aborts its read", async () => {
		const pending = deferred<Record<string, unknown> | null>(),
			h = harness();
		h.detail.mockReturnValueOnce(pending.promise).mockResolvedValue({ response: { text: "second request" } });
		h.store.bind(row("one", false), "day");
		const signal = h.detail.mock.calls[0][2] as AbortSignal;
		h.store.bind(row("two", false), "day");
		pending.resolve({ response: { text: "first request" } });
		await vi.advanceTimersByTimeAsync(0);
		expect(signal.aborted).toBe(true);
		expect(h.store.enriched.value?.request_id).toBe("two");
		expect(h.store.enriched.value?.response).toEqual({ text: "second request" });
		h.store.dispose();
	});
	it("retains the last valid payload when a malformed patch arrives", async () => {
		const h = harness();
		h.store.bind(row(), "day");
		await vi.advanceTimersByTimeAsync(0);
		h.callbacks().open();
		h.callbacks().frame({ type: "snapshot", data: { status: "in_progress", response: { text: "valid" } } });
		h.callbacks().frame({ type: "patch", data: { status: 123, model: false } });
		expect(h.store.enriched.value?.response).toEqual({ text: "valid" });
		expect(h.store.inProgress.value).toBe(true);
		h.store.dispose();
	});
});
