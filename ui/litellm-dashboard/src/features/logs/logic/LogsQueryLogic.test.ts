import { describe, expect, it } from "vitest";
import { createEmptyLogFilters } from "./LogsFilterLogic";
import { logsQuery } from "./LogsQueryLogic";
import type { LogsUrlState } from "./LogsUrlLogic";

const createState = (overrides: Partial<LogsUrlState> = {}): LogsUrlState => ({
	filters: createEmptyLogFilters(),
	currentPage: 1,
	pageSize: 100,
	startTime: "2026-11-08T08:34",
	endTime: "2026-11-09T08:34",
	isCustomDate: false,
	selectedTimeInterval: { value: 24, unit: "hours" },
	sortBy: "startTime",
	sortOrder: "desc",
	...overrides,
});

/** 本地时间字符串对应的 API 参数（UTC，秒精度）；避免断言依赖运行机器时区。 */
const apiTime = (localDateTime: string): string => new Date(localDateTime).toISOString().slice(0, 19).replace("T", " ");

const adminScope = { userId: "admin", role: "Admin" };

describe("logsQuery 时间范围", () => {
	/**
	 * 回归：预设区间（Last 24 Hours 等）的终点恒为「现在」，协议里的日期只有整秒，
	 * 客户端补上整秒 end_date 会把当前这一秒的毫秒部分排除，刚注册的在途行查不到，
	 * Live Tail 要等下一个上游事件才刷出 In Progress 行。预设区间因此不传 end_date。
	 */
	it("预设区间不传 end_date，由服务端按 now 取上界", () => {
		const state = createState();
		const params = logsQuery(state, adminScope);

		expect(params.has("end_date")).toBe(false);
		expect(params.get("start_date")).toBe(apiTime(state.startTime));
	});

	it("自定义区间仍发送精确的 end_date", () => {
		const state = createState({ isCustomDate: true, endTime: "2026-11-09T07:15" });
		const params = logsQuery(state, adminScope);

		expect(params.get("end_date")).toBe(apiTime(state.endTime));
	});

	it("内置用户仍收敛到自己的 user_id", () => {
		const params = logsQuery(createState(), { userId: "u-1", role: "Internal User" });

		expect(params.get("user_id")).toBe("u-1");
	});
});
