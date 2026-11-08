import { describe, expect, it } from "vitest";
import { activeUserChart, usageDistribution } from "./UserAgentUsageLogic";
describe("user agent charts", () => {
	it("keeps seven daily buckets, fills missing dates and caps the legend at ten ranked agents", () => {
		const points = Array.from({ length: 12 }, (_, i) => ({ tag: "User-Agent: agent-" + i, date: "2026-11-07", active_users: i + 1 }));
		const chart = activeUserChart(points, "dau", new Date("2026-11-07T02:00:00Z"));
		expect(chart.data).toHaveLength(7);
		expect(chart.data[0].date).toBe("2026-11-01");
		expect(chart.categories).toHaveLength(10);
		expect(chart.categories[0]).toBe("agent-11");
		expect(chart.data[0]["agent-11"]).toBe(0);
		expect(chart.data[6]["agent-11"]).toBe(12);
	});
	it("uses the server week labels while preserving empty weeks", () => {
		const chart = activeUserChart([{ tag: "Editor", date: "Week 3 (Oct 24)", active_users: 7 }], "wau");
		expect(chart.data).toHaveLength(7);
		expect(chart.data[2]).toEqual({ week: "Week 3", Editor: 7 });
		expect(chart.data[1].Editor).toBe(0);
	});
	it("counts users in nonoverlapping frequency ranges and includes Unknown agents", () => {
		const base = {
			user_id: "user",
			user_email: null,
			user_agent: null,
			failed_requests: 0,
			total_requests: 0,
			total_tokens: 0,
			spend: 0,
		};
		const chart = usageDistribution([1, 9, 10, 1000, 100000].map((successful_requests) => ({ ...base, successful_requests })));
		expect(chart.categories).toEqual(["Unknown"]);
		expect(chart.data.map((row) => row.Unknown)).toEqual([2, 1, 0, 1, 0, 1]);
	});
});
