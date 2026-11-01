import { normalizeSpendLogRow, toIsoTimestamp } from "./spendManagementFormatters";

describe("toIsoTimestamp", () => {
	test("把 pg 无时区文本按 UTC 解释为 ISO 字符串", () => {
		// UNION 合并路径下 completionStartTime / endTime 由裸 SQL 列透出，
		// node-postgres 返回 "YYYY-MM-DD HH:MM:SS.mmm"，不带时区。
		expect(toIsoTimestamp("2026-10-29 15:21:58.873")).toBe("2026-10-29T15:21:58.873Z");
	});

	test("保留 pg 文本里的偏移量", () => {
		expect(toIsoTimestamp("2026-10-29 15:22:04.876+00")).toBe("2026-10-29T15:22:04.876Z");
		expect(toIsoTimestamp("2026-10-29 23:22:04.876+08")).toBe("2026-10-29T15:22:04.876Z");
	});

	test("Date 与已带时区的 ISO 字符串幂等", () => {
		const date = new Date("2026-10-29T15:21:58.873Z");
		expect(toIsoTimestamp(date)).toBe("2026-10-29T15:21:58.873Z");
		expect(toIsoTimestamp("2026-10-29T15:21:58.873Z")).toBe("2026-10-29T15:21:58.873Z");
	});

	test("null / 空值 / 无法识别的输入原样返回", () => {
		expect(toIsoTimestamp(null)).toBeNull();
		expect(toIsoTimestamp(undefined)).toBeUndefined();
		expect(toIsoTimestamp("not-a-date")).toBe("not-a-date");
		expect(toIsoTimestamp(0)).toBe(0);
	});
});

describe("normalizeSpendLogRow", () => {
	test("混合时间格式统一成可被浏览器正确解析的 ISO UTC", () => {
		// 复现生产 UNION 响应：startTime 是 Date，completionStartTime 是无时区文本。
		const row = normalizeSpendLogRow({
			request_id: "req-1",
			startTime: new Date("2026-10-29T15:21:56.342Z"),
			endTime: "2026-10-29 15:22:04.876+00",
			completionStartTime: "2026-10-29 15:21:58.873",
		});

		expect(row.startTime).toBe("2026-10-29T15:21:56.342Z");
		expect(row.completionStartTime).toBe("2026-10-29T15:21:58.873Z");
		expect(row.endTime).toBe("2026-10-29T15:22:04.876Z");

		// 浏览器据此计算 TTFT 必须为正，且与数据库中的 2531ms 一致。
		const ttftMs = new Date(row.completionStartTime as string).getTime() - new Date(row.startTime as string).getTime();
		expect(ttftMs).toBe(2531);
	});
});
