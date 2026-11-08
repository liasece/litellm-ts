import { afterEach, it, expect, vi } from "vitest";
import { createClaudeCodeNudgeStore } from "./ClaudeCodeNudgeStore";
afterEach(() => vi.useRealTimers());
it("displays only enabled authenticated sessions and expires the prompt after fifteen seconds", async () => {
	vi.useFakeTimers();
	vi.setSystemTime(0);
	const load = vi.fn(async () => true),
		store = createClaudeCodeNudgeStore(vi.fn(), load);
	await store.initialize(false);
	expect(load).not.toHaveBeenCalled();
	await store.initialize(true);
	expect(store.state.visible).toBe(true);
	await vi.advanceTimersByTimeAsync(7500);
	expect(store.state.progress).toBe(50);
	await vi.advanceTimersByTimeAsync(7500);
	expect(store.state.visible).toBe(false);
	store.dispose();
});
it("closing feedback restarts its timer, while completing feedback only closes the modal", async () => {
	vi.useFakeTimers();
	const store = createClaudeCodeNudgeStore(vi.fn(), async () => true);
	await store.initialize(true);
	store.open();
	expect(store.state.modalOpen).toBe(true);
	expect(store.state.visible).toBe(false);
	await vi.advanceTimersByTimeAsync(20000);
	expect(store.state.modalOpen).toBe(true);
	store.close();
	expect(store.state.visible).toBe(true);
	expect(store.state.progress).toBe(100);
	store.open();
	store.complete();
	expect(store.state.visible).toBe(false);
	expect(store.state.modalOpen).toBe(false);
	store.dispose();
});
it("persists the prompt preference and keeps its confirmation for five seconds", async () => {
	vi.useFakeTimers();
	const disable = vi.fn(),
		store = createClaudeCodeNudgeStore(disable, async () => true);
	await store.initialize(true);
	store.dontAskAgain();
	expect(disable).toHaveBeenCalledOnce();
	expect(store.state.confirmation).toBe(true);
	await vi.advanceTimersByTimeAsync(4999);
	expect(store.state.visible).toBe(true);
	await vi.advanceTimersByTimeAsync(1);
	expect(store.state.visible).toBe(false);
	expect(store.state.confirmation).toBe(false);
	store.dispose();
});
it("silently ignores unavailable config and never revives a disposed session from a late response", async () => {
	const fail = createClaudeCodeNudgeStore(vi.fn(), async () => {
		throw new Error("Unavailable");
	});
	await expect(fail.initialize(true)).resolves.toBeUndefined();
	expect(fail.state.visible).toBe(false);
	fail.dispose();
	let resolve: (enabled: boolean) => void = () => {};
	const waiting = createClaudeCodeNudgeStore(vi.fn(), () => new Promise<boolean>((r) => (resolve = r))),
		request = waiting.initialize(true);
	waiting.dispose();
	resolve(true);
	await request;
	expect(waiting.state.visible).toBe(false);
});
