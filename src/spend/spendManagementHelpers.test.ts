import { resolveUiSpendLogEndDate } from "./spendManagementHelpers";

describe("/spend/logs/ui 列表上界解析", () => {
	/**
	 * 回归：预设区间（Last N）由客户端补整秒上界时，`startTime <= end_date` 会排除当前
	 * 这一秒内注册的在途行，表现为 Live Tail 要等上游首字节才刷出 In Progress 行。
	 * 缺省 end_date 时上界必须取服务端 now 本身，毫秒部分不能被截断。
	 */
	test("缺省 end_date 时用服务端 now，覆盖本秒内注册的在途行", () => {
		const now = new Date("2026-11-09T08:34:04.786Z");
		const inFlightStartTime = new Date("2026-11-09T08:34:04.786Z").getTime();

		expect(resolveUiSpendLogEndDate(undefined, now).getTime()).toBe(now.getTime());
		expect(resolveUiSpendLogEndDate("", now).getTime()).toBe(now.getTime());
		expect(inFlightStartTime).toBeLessThanOrEqual(resolveUiSpendLogEndDate(undefined, now).getTime());
	});

	test("显式 end_date 仍按整秒 UTC 解析，自定义区间上界不变", () => {
		expect(resolveUiSpendLogEndDate("2026-11-09 08:34:04").toISOString()).toBe("2026-11-09T08:34:04.000Z");
	});

	test("非法 end_date 仍抛日期格式错误", () => {
		expect(() => resolveUiSpendLogEndDate("2026-11-09")).toThrow(/Expected: 'YYYY-MM-DD HH:MM:SS'/);
	});
});
