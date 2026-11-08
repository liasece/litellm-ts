import { afterEach, describe, expect, it, vi } from "vitest";
import { createLiveTailScheduler } from "./LiveTailSchedulerLogic";

afterEach(() => vi.useRealTimers());
describe("live log refresh scheduling", () => {
	it("coalesces change notifications while enforcing the 500ms request start interval", async () => {
		vi.useFakeTimers();
		const refresh = vi.fn(async () => undefined);
		const scheduler = createLiveTailScheduler(refresh, 10_000);
		scheduler.start();
		for (let index = 0; index < 10; index++) scheduler.signal();
		await vi.advanceTimersByTimeAsync(499);
		expect(refresh).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(refresh).toHaveBeenCalledTimes(1);
		scheduler.signal();
		scheduler.signal();
		await vi.advanceTimersByTimeAsync(500);
		expect(refresh).toHaveBeenCalledTimes(2);
		scheduler.stop();
	});
	it("keeps a change received during a slow request and refreshes again after it settles", async () => {
		vi.useFakeTimers();
		let complete: (() => void) | undefined;
		const refresh = vi
			.fn()
			.mockImplementationOnce(
				() =>
					new Promise<void>((resolve) => {
						complete = resolve;
					}),
			)
			.mockResolvedValue(undefined);
		const scheduler = createLiveTailScheduler(refresh, 10_000);
		scheduler.start();
		scheduler.signal();
		await vi.advanceTimersByTimeAsync(500);
		scheduler.signal();
		await vi.advanceTimersByTimeAsync(1000);
		expect(refresh).toHaveBeenCalledTimes(1);
		complete?.();
		await vi.advanceTimersByTimeAsync(0);
		expect(refresh).toHaveBeenCalledTimes(2);
		scheduler.stop();
	});
	it("does not request hidden tabs and catches up when they become visible", async () => {
		vi.useFakeTimers();
		let hidden = true;
		const refresh = vi.fn(async () => undefined);
		const scheduler = createLiveTailScheduler(refresh, 2000, {
			now: () => Date.now(),
			hidden: () => hidden,
			setTimer: setTimeout,
			clearTimer: clearTimeout,
		});
		scheduler.start();
		await vi.advanceTimersByTimeAsync(2000);
		expect(refresh).not.toHaveBeenCalled();
		hidden = false;
		scheduler.wake();
		await vi.advanceTimersByTimeAsync(0);
		expect(refresh).toHaveBeenCalledTimes(1);
		scheduler.stop();
		await vi.advanceTimersByTimeAsync(30_000);
		expect(refresh).toHaveBeenCalledTimes(1);
	});
});
