import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionTimelineStore } from "./SessionTimelineStore";
import type { TimelineSocketCallbacks } from "../api/SessionTimelineApi";
import type { SessionTimelineEvent, SessionTimelineResponse } from "../support/SessionTimelineModels";
const group = { type: "session_id" as const, id: "session-one" };
const event = (id: string, content = id): SessionTimelineEvent => ({
	id,
	request_id: "request-" + id,
	role: "assistant",
	label: "Assistant",
	timestamp: "2026-11-07T02:00:00Z",
	model: "fixture",
	content,
});
const summary = {
	keys: [],
	request_count: 1,
	event_count: 1,
	total_spend: 0.01,
	total_tokens: 20,
	duration_seconds: 2,
	start_time: null,
	end_time: null,
};
const snapshot = (data = [event("one")]): SessionTimelineResponse => ({
	data,
	summary,
	active_requests: [],
	window: { returned_requests: 1, total_requests: 3, has_more: true, before: "older-cursor", limit: 1 },
});
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => (resolve = done));
	return { promise, resolve };
}
function harness() {
	const callbacks: TimelineSocketCallbacks[] = [],
		stops = Array.from({ length: 20 }, () => vi.fn());
	const fetch = vi.fn().mockResolvedValue(snapshot());
	const socket = vi.fn((_group: unknown, _team: unknown, next: TimelineSocketCallbacks) => {
		callbacks.push(next);
		return stops[callbacks.length - 1];
	});
	const store = createSessionTimelineStore({ api: { fetch }, socket });
	return { store, fetch, socket, callbacks, stops };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
describe("Session simulation timeline", () => {
	it("retains earlier pages and the window when live events settle, without duplicate event ids", async () => {
		const h = harness();
		h.store.bind(group, undefined);
		await vi.advanceTimersByTimeAsync(0);
		h.fetch.mockResolvedValueOnce({
			...snapshot([event("earlier")]),
			window: { returned_requests: 1, total_requests: 3, has_more: false, before: null, limit: 1 },
		});
		await h.store.loadEarlier();
		expect(h.store.canLoadEarlier.value).toBe(false);
		h.callbacks[0].open();
		h.callbacks[0].frame({
			type: "update",
			group,
			data: {
				upsert: [event("one", "settled")],
				removed: [],
				summary,
				active_requests: [{ request_id: "active", events: [event("two")] }],
			},
		});
		expect(h.store.combined.value.map((item) => item.id)).toEqual(["earlier", "one", "two"]);
		expect(h.store.state.response?.window?.before).toBe("older-cursor");
		h.callbacks[0].frame({
			type: "update",
			group,
			data: { upsert: [event("two", "stored")], order: ["one", "two"], summary, active_requests: [] },
		});
		expect(h.store.combined.value.map((item) => item.id)).toEqual(["earlier", "one", "two"]);
		expect(h.store.combined.value[2].content).toBe("stored");
		h.store.dispose();
	});
	it("rejects a late initial read and a frame belonging to another session", async () => {
		const pending = deferred<SessionTimelineResponse>(),
			h = harness();
		h.fetch.mockReturnValueOnce(pending.promise);
		h.store.bind(group, undefined);
		h.callbacks[0].frame({ type: "snapshot", group, data: snapshot([event("live")]) });
		h.callbacks[0].frame({ type: "snapshot", group: { ...group, id: "other" }, data: snapshot([event("wrong")]) });
		pending.resolve(snapshot([event("stale")]));
		await vi.advanceTimersByTimeAsync(0);
		expect(h.store.combined.value.map((item) => item.id)).toEqual(["live"]);
		h.store.dispose();
	});
	it("reconnects after server timeout in 250ms and backs off unexpected disconnects", async () => {
		const h = harness();
		h.store.bind(group, undefined);
		h.callbacks[0].open();
		h.callbacks[0].frame({ type: "timeout", group });
		h.callbacks[0].close();
		await vi.advanceTimersByTimeAsync(249);
		expect(h.socket).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(h.socket).toHaveBeenCalledTimes(2);
		h.callbacks[1].close();
		await vi.advanceTimersByTimeAsync(999);
		expect(h.socket).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(1);
		expect(h.socket).toHaveBeenCalledTimes(3);
		h.callbacks[2].close();
		await vi.advanceTimersByTimeAsync(1999);
		expect(h.socket).toHaveBeenCalledTimes(3);
		await vi.advanceTimersByTimeAsync(1);
		expect(h.socket).toHaveBeenCalledTimes(4);
		h.store.dispose();
		await vi.advanceTimersByTimeAsync(30000);
		expect(h.socket).toHaveBeenCalledTimes(4);
	});
	it("ignores an older-page response after switching sessions and sanitizes HTML errors", async () => {
		const h = harness();
		h.store.bind(group, "team");
		await vi.advanceTimersByTimeAsync(0);
		const earlier = deferred<SessionTimelineResponse>();
		h.fetch.mockReturnValueOnce(earlier.promise);
		const pending = h.store.loadEarlier();
		h.fetch.mockRejectedValueOnce(new Error("<!doctype html><html>unavailable</html>"));
		h.store.bind({ ...group, id: "second" }, "team");
		earlier.resolve(snapshot([event("wrong earlier")]));
		await pending;
		await vi.advanceTimersByTimeAsync(0);
		expect(h.store.state.earlier).toEqual([]);
		expect(h.store.state.error).toBe("Session 历史加载失败");
		h.store.dispose();
	});
});
