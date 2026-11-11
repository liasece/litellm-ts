import { describe, expect, it } from "vitest";
import { END_USER_CHOICE_LIMIT, endUserChoices, endUserChoicesQuery } from "./LogsFilterChoicesLogic";

describe("End User 表头过滤候选", () => {
	/**
	 * 回归：端用户表到数万行后，`/customer/list` 全量下发约 22 MB，
	 * 每次输入都要重下一遍，表头过滤明显卡住。候选请求必须带上服务端搜索与页大小。
	 */
	it("查询带上页大小，输入时才带 search", () => {
		const empty = new URL("http://localhost" + endUserChoicesQuery("   "));
		expect(empty.pathname).toBe("/customer/list");
		expect(empty.searchParams.get("size")).toBe(String(END_USER_CHOICE_LIMIT));
		expect(empty.searchParams.has("search")).toBe(false);

		const searched = new URL("http://localhost" + endUserChoicesQuery("  ali ce "));
		expect(searched.searchParams.get("search")).toBe("ali ce");
	});

	it("把响应映射成候选项，跳过没有 user_id 的行", () => {
		expect(endUserChoices([{ user_id: "u-1" }, { user_id: "" }, { user_id: 3 }, null, "x"])).toEqual([{ label: "u-1", value: "u-1" }]);
		expect(endUserChoices({ detail: "not a list" })).toEqual([]);
	});
});
