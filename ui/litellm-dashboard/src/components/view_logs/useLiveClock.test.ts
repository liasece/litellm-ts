import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LIVE_CLOCK_INTERVAL_MS, useLiveClockMs, useLiveDurationMs } from "./useLiveClock";

const START = "2026-01-01T00:00:00.000Z";

describe("useLiveDurationMs", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(START));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("请求结束后直接用服务端耗时，不启动时钟", () => {
		const { result } = renderHook(() => useLiveDurationMs(START, false, 4321));

		expect(result.current).toBe(4321);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("进行中的请求按秒推进，不需要服务端推送", () => {
		const { result } = renderHook(() => useLiveDurationMs(START, true, 1000));

		expect(result.current).toBe(1000);
		act(() => {
			vi.advanceTimersByTime(LIVE_CLOCK_INTERVAL_MS);
		});
		expect(result.current).toBe(1000);
		act(() => {
			vi.advanceTimersByTime(LIVE_CLOCK_INTERVAL_MS * 2);
		});
		expect(result.current).toBe(3000);
	});

	it("客户端时钟落后于服务端读数时不回退", () => {
		// startTime 在未来 5 分钟，客户端算出来是负数，应该保留服务端给出的耗时。
		const { result } = renderHook(() => useLiveDurationMs("2026-01-01T00:05:00.000Z", true, 2000));

		expect(result.current).toBe(2000);
	});

	it("开始时间不可解析时退回服务端耗时", () => {
		const { result } = renderHook(() => useLiveDurationMs("not-a-date", true, 700));

		expect(result.current).toBe(700);
	});
});

describe("useLiveClockMs", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(START));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("多个订阅者共用一个定时器，全部卸载后停止", () => {
		const first = renderHook(() => useLiveClockMs(true));
		const second = renderHook(() => useLiveClockMs(true));
		expect(vi.getTimerCount()).toBe(1);

		act(() => {
			vi.advanceTimersByTime(LIVE_CLOCK_INTERVAL_MS);
		});
		expect(first.result.current).toBe(second.result.current);

		first.unmount();
		expect(vi.getTimerCount()).toBe(1);
		second.unmount();
		expect(vi.getTimerCount()).toBe(0);
	});

	it("未激活时不订阅时钟", () => {
		renderHook(() => useLiveClockMs(false));

		expect(vi.getTimerCount()).toBe(0);
	});
});
