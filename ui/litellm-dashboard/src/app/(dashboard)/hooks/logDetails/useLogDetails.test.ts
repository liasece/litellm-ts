import { describe, expect, it } from "vitest";
import { shouldPollLogDetails } from "./useLogDetails";

describe("shouldPollLogDetails", () => {
	it("推送连接活跃时不轮询", () => {
		expect(shouldPollLogDetails({ status: "in_progress" }, true, true)).toBe(false);
	});

	it("缓存里还是进行中负载时继续兜底轮询，即使列表行已经显示结束", () => {
		// 回归：列表先看到结束会断掉订阅，最终帧可能收不到；此前这里会因为列表行已结束
		// 直接返回 false，详情永久停在最后一份进行中内容，只能手动刷新。
		expect(shouldPollLogDetails({ status: "in_progress" }, false, false)).toBe(true);
	});

	it("拿到落库负载（没有 status 字段）后停止轮询", () => {
		expect(shouldPollLogDetails({ messages: [], response: {} }, false, false)).toBe(false);
	});

	it("进行中但还没有任何详情时继续轮询", () => {
		expect(shouldPollLogDetails(null, false, true)).toBe(true);
		expect(shouldPollLogDetails(undefined, false, true)).toBe(true);
	});

	it("已结束且没有详情时不轮询", () => {
		expect(shouldPollLogDetails(null, false, false)).toBe(false);
	});
});
