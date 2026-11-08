import { describe, expect, it } from "vitest";
import { dailyActivityPath, parseDailyActivity } from "../api/DailyActivityApi";
import { emptyDailyActivity } from "../stores/DailyActivityStore";
import { processActivityData } from "./ActivityMetricsLogic";
import { emptyMetrics, modelRankings } from "./UsageSummaryLogic";
describe("usage wire and aggregation contracts", () => {
	it("sends local calendar dates, offset minutes, comma separated IDs and the dashboard-team exclusion", () => {
		const query = {
			entity: "team" as const,
			from: new Date(2026, 10, 1, 23),
			to: new Date(2026, 10, 7, 1),
			selected: ["team-a", "team-b"],
		};
		const url = new URL(dailyActivityPath(query, 3), "https://example.test");
		expect(url.pathname).toBe("/team/daily/activity");
		expect(Object.fromEntries(url.searchParams)).toEqual({
			start_date: "2026-11-01",
			end_date: "2026-11-07",
			page_size: "1000",
			page: "3",
			timezone: String(new Date().getTimezoneOffset()),
			team_ids: "team-a,team-b",
			exclude_team_ids: "litellm-dashboard-react-reference",
		});
		const global = new URL(dailyActivityPath({ ...query, entity: "global", selected: ["u1"] }), "https://example.test");
		expect(global.pathname).toBe("/user/daily/activity/aggregated");
		expect(global.searchParams.get("user_id")).toBe("u1");
		expect(global.searchParams.has("page")).toBe(false);
	});
	it("preserves provider fields but rejects malformed metrics at the HTTP boundary", () => {
		const valid = {
			results: [{ date: "2026-11-07", metrics: { spend: 1 }, breakdown: {} }],
			metadata: { total_spend: 1, provider_note: "kept" },
		};
		expect(parseDailyActivity(valid).metadata.provider_note).toBe("kept");
		expect(parseDailyActivity(valid).results[0].metrics.cache_read_input_tokens).toBe(0);
		expect(() => parseDailyActivity({ ...valid, results: [{ ...valid.results[0], metrics: { spend: "1" } }] })).toThrow();
	});
	it("aggregates per-key model usage across dates, preserving key aliases and team labels", () => {
		const data = emptyDailyActivity();
		const key = {
			metrics: { ...emptyMetrics(), spend: 2, api_requests: 3, total_tokens: 40, successful_requests: 2, failed_requests: 1 },
			metadata: { key_alias: "Build", team_id: "t1" },
		};
		data.results = ["2026-11-02", "2026-11-01"].map((date) => ({
			date,
			metrics: key.metrics,
			breakdown: {
				models: { "model-a": { metrics: key.metrics, metadata: {}, api_key_breakdown: { hash: key } } },
				api_keys: { hash: key },
				model_groups: {},
				mcp_servers: {},
				providers: {},
				entities: {},
				endpoints: {},
			},
		}));
		const keys = processActivityData(data, "api_keys", [{ team_id: "t1", team_alias: "Engineering" }]);
		expect(keys.hash.label).toBe("Build (team: Engineering)");
		expect(keys.hash.total_spend).toBe(4);
		expect(keys.hash.top_models).toEqual([
			{ model: "model-a", spend: 4, requests: 6, successful_requests: 4, failed_requests: 2, tokens: 80 },
		]);
		expect(keys.hash.daily_data.map((x) => x.date)).toEqual(["2026-11-01", "2026-11-02"]);
		expect(processActivityData(data, "models")["model-a"].top_api_keys[0]).toMatchObject({
			api_key: "hash",
			spend: 4,
			requests: 6,
			tokens: 80,
		});
	});
	it("retains valid names that collide with object prototype members", () => {
		const data = emptyDailyActivity(),
			item = { metrics: { ...emptyMetrics(), spend: 3 }, metadata: {}, api_key_breakdown: {} };
		const models = Object.create(null);
		models.constructor = item;
		models.__proto__ = item;
		data.results = [
			{
				date: "2026-11-07",
				metrics: emptyMetrics(),
				breakdown: { models, model_groups: {}, providers: {}, api_keys: {}, entities: {}, mcp_servers: {}, endpoints: {} },
			},
		];
		expect(
			modelRankings(data)
				.map((x) => x.key)
				.sort(),
		).toEqual(["__proto__", "constructor"]);
		expect(Object.keys(processActivityData(data, "models")).sort()).toEqual(["__proto__", "constructor"]);
	});
});
