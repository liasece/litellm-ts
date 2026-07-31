import { describe, expect, it } from "vitest";
import { createEmptyLogFilters } from "./log_filter_state";
import { readLogsUrlState, writeLogsUrlState, type LogsUrlState } from "./logs_url_state";

const defaults = {
	startTime: "2026-07-30T12:00",
	endTime: "2026-07-31T12:00",
};

const createState = (): LogsUrlState => ({
	filters: createEmptyLogFilters(),
	searchTerm: "",
	currentPage: 1,
	pageSize: 100,
	startTime: defaults.startTime,
	endTime: defaults.endTime,
	isCustomDate: false,
	selectedTimeInterval: { value: 24, unit: "hours" },
	sortBy: "startTime",
	sortOrder: "desc",
});

describe("Logs URL state", () => {
	it("serializes filters and restores the same filtered view after refresh", () => {
		const state = createState();
		state.filters["Team ID"] = "team/a";
		state.filters["Key Alias"] = "production key";
		state.filters.Status = "failure";
		state.searchTerm = "req-123";
		state.currentPage = 3;
		state.pageSize = 500;
		state.sortBy = "spend";
		state.sortOrder = "asc";

		const params = writeLogsUrlState(new URLSearchParams("page=logs&unrelated=keep"), state);
		const restored = readLogsUrlState(params.toString(), defaults);

		expect(params.get("page")).toBe("logs");
		expect(params.get("unrelated")).toBe("keep");
		expect(restored.filters["Team ID"]).toBe("team/a");
		expect(restored.filters["Key Alias"]).toBe("production key");
		expect(restored.filters.Status).toBe("failure");
		expect(restored.searchTerm).toBe("req-123");
		expect(restored.currentPage).toBe(3);
		expect(restored.pageSize).toBe(500);
		expect(restored.sortBy).toBe("spend");
		expect(restored.sortOrder).toBe("asc");
	});

	it("restores a custom time range and discards malformed URL state", () => {
		const state = createState();
		state.isCustomDate = true;
		state.startTime = "2026-07-01T09:30";
		state.endTime = "2026-07-02T18:45";

		const params = writeLogsUrlState(new URLSearchParams("page=logs"), state);
		const restored = readLogsUrlState(params.toString(), defaults);

		expect(restored.isCustomDate).toBe(true);
		expect(restored.startTime).toBe("2026-07-01T09:30");
		expect(restored.endTime).toBe("2026-07-02T18:45");

		const malformed = readLogsUrlState(
			"page=logs&logs_page=-2&logs_page_size=999&logs_sort_by=unknown&logs_custom_date=1&logs_start=nope",
			defaults,
		);
		expect(malformed.currentPage).toBe(1);
		expect(malformed.pageSize).toBe(100);
		expect(malformed.sortBy).toBe("startTime");
		expect(malformed.isCustomDate).toBe(false);
	});

	it("removes reset filter parameters without disturbing the Logs route", () => {
		const params = new URLSearchParams("page=logs&team_id=team-1&key_alias=alias-1&logs_page=4&logs_search=request");
		const next = writeLogsUrlState(params, createState());

		expect(next.toString()).toBe("page=logs");
	});
});
