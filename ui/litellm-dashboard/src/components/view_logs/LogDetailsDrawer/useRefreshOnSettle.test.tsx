import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useRefreshOnSettle } from "./useRefreshOnSettle";

describe("useRefreshOnSettle", () => {
	it("首次打开一条已结束的日志时不补拉", () => {
		const refetch = vi.fn();

		renderHook(({ isInProgress }) => useRefreshOnSettle(isInProgress, refetch), {
			initialProps: { isInProgress: false },
		});

		expect(refetch).not.toHaveBeenCalled();
	});

	it("从进行中变为结束时补拉一次详情", () => {
		const refetch = vi.fn();
		const { rerender } = renderHook(({ isInProgress }) => useRefreshOnSettle(isInProgress, refetch), {
			initialProps: { isInProgress: true },
		});
		expect(refetch).not.toHaveBeenCalled();

		rerender({ isInProgress: false });

		expect(refetch).toHaveBeenCalledTimes(1);
	});

	it("进行中期间的普通重渲染不触发补拉", () => {
		const refetch = vi.fn();
		const { rerender } = renderHook(({ isInProgress }) => useRefreshOnSettle(isInProgress, refetch), {
			initialProps: { isInProgress: true },
		});

		rerender({ isInProgress: true });
		rerender({ isInProgress: true });

		expect(refetch).not.toHaveBeenCalled();
	});

	it("同一条日志再次进行中后又结束时重新补拉", () => {
		const refetch = vi.fn();
		const { rerender } = renderHook(({ isInProgress }) => useRefreshOnSettle(isInProgress, refetch), {
			initialProps: { isInProgress: true },
		});

		rerender({ isInProgress: false });
		rerender({ isInProgress: true });
		rerender({ isInProgress: false });

		expect(refetch).toHaveBeenCalledTimes(2);
	});
});
