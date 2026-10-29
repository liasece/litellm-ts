import { describe, expect, it } from "vitest";
import {
	DEFAULT_LOGS_OPTIONAL_COLUMNS,
	parseLogsColumnPreferences,
	readLogsColumnPreferences,
	writeLogsColumnPreferences,
} from "./logs_column_prefs";

describe("logs column preferences", () => {
	it("未保存或数据损坏时回退为默认（全部隐藏）", () => {
		expect(parseLogsColumnPreferences(null)).toEqual([...DEFAULT_LOGS_OPTIONAL_COLUMNS]);
		expect(parseLogsColumnPreferences("{not json")).toEqual([]);
		expect(parseLogsColumnPreferences(JSON.stringify({ end_user: true }))).toEqual([]);
	});

	it("忽略未知列名并去重", () => {
		expect(
			parseLogsColumnPreferences(JSON.stringify(["end_user", "removed_column", "end_user", "request_tags"])),
		).toEqual(["end_user", "request_tags"]);
	});

	it("写入后可以读回相同设置", () => {
		writeLogsColumnPreferences(["request_id"]);
		expect(readLogsColumnPreferences()).toEqual(["request_id"]);
	});
});
