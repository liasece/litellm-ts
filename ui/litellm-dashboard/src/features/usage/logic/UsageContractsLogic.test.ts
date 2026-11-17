import { describe, expect, it } from "vitest";
import { dailyActivityPath, parseDailyActivity, parseDailyActivityDetail, parseDailyActivitySummary } from "../api/DailyActivityApi";
import { emptyDailyActivity } from "../stores/DailyActivityStore";
import { processActivityData } from "./ActivityMetricsLogic";
import { emptyMetrics, modelRankings } from "./UsageSummaryLogic";
import { detailActivity, summaryOverall, summaryTopEntities } from "./UsageOverviewLogic";
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
			timezone_name: Intl.DateTimeFormat().resolvedOptions().timeZone,
		});
		const global = new URL(dailyActivityPath({ ...query, entity: "global", selected: ["u1"] }), "https://example.test");
		expect(global.pathname).toBe("/user/daily/activity/aggregated");
		expect(global.searchParams.get("user_id")).toBe("u1");
		expect(global.searchParams.has("page")).toBe(false);
	});
	it("uses view paths for summary/detail while keeping the default full contract stable", () => {
		const query = {
			entity: "global" as const,
			from: new Date(2026, 10, 1),
			to: new Date(2026, 10, 7),
			selected: [],
		};
		const summary = new URL(dailyActivityPath(query, undefined, "summary"), "https://example.test");
		expect(summary.pathname).toBe("/user/daily/activity/aggregated");
		expect(summary.searchParams.get("view")).toBe("summary");
		expect(summary.searchParams.has("page")).toBe(false);
		const detail = new URL(dailyActivityPath(query, 2, "models", 20), "https://example.test");
		expect(detail.pathname).toBe("/user/daily/activity/aggregated");
		expect(Object.fromEntries(detail.searchParams)).toMatchObject({
			view: "models",
			page: "2",
			page_size: "20",
		});
	});
	it("parses summary and detail without requiring nested breakdown arrays", () => {
		const metrics = { ...emptyMetrics(), spend: 1, api_requests: 2, total_tokens: 3 };
		const summary = parseDailyActivitySummary({
			view: "summary",
			results: [{ date: "2026-11-01", metrics }],
			dimensions: { models: [{ key: "model-a", metrics }] },
			metadata: { total_spend: 1 },
		});
		expect(summary.dimensions.models[0].key).toBe("model-a");
		expect(summary.dimensions.api_keys).toEqual([]);
		const detail = parseDailyActivityDetail({
			view: "models",
			results: [{ date: "2026-11-01", metrics }],
			items: [{ key: "model-a", metrics, daily: [{ date: "2026-11-01", metrics }] }],
			metadata: { total_count: 1 },
		});
		expect(detail.items[0].daily).toHaveLength(1);
		expect(detail.metadata.total_count).toBe(1);
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
			{
				model: "model-a",
				spend: 4,
				requests: 6,
				successful_requests: 4,
				failed_requests: 2,
				tokens: 80,
				metrics: {
					...emptyMetrics(),
					spend: 4,
					api_requests: 6,
					successful_requests: 4,
					failed_requests: 2,
					total_tokens: 80,
				},
			},
		]);
		expect(keys.hash.daily_data.map((x) => x.date)).toEqual(["2026-11-01", "2026-11-02"]);
		expect(processActivityData(data, "models")["model-a"].top_api_keys[0]).toMatchObject({
			api_key: "hash",
			spend: 4,
			requests: 6,
			tokens: 80,
		});
	});
	it("builds summary overall and top entities from full dimensions, not the loaded detail page", () => {
		const metrics = { ...emptyMetrics(), spend: 2, api_requests: 3, total_tokens: 40 };
		const summary = parseDailyActivitySummary({
			view: "summary",
			results: [{ date: "2026-11-02", metrics }],
			dimensions: {
				models: [
					{ key: "model-b", metrics: { ...metrics, total_tokens: 90 } },
					{ key: "model-a", metrics },
				],
				api_keys: [{ key: "hash", metrics, metadata: { key_alias: "Build", team_id: "t1" } }],
			},
			metadata: {
				total_spend: 2,
				total_api_requests: 3,
				total_tokens: 40,
			},
		});
		expect(summaryOverall(summary)).toMatchObject({ total_spend: 2, total_tokens: 40 });
		expect(summaryTopEntities(summary, "models", [])[0]).toMatchObject({ key: "model-b", tokens: 90 });
		expect(summaryTopEntities(summary, "api_keys", [{ team_id: "t1", team_alias: "Engineering" }])[0].label).toBe(
			"Build (team: Engineering)",
		);
		const detail = parseDailyActivityDetail({
			view: "models",
			results: [{ date: "2026-11-02", metrics }],
			items: [
				{
					key: "model-a",
					metrics,
					daily: [{ date: "2026-11-02", metrics }],
					top_api_keys: [{ key: "hash", metrics, metadata: { key_alias: "Build", team_id: "t1" } }],
				},
			],
			metadata: { total_count: 1 },
		});
		expect(detailActivity(detail, [{ team_id: "t1", team_alias: "Engineering" }], false)["model-a"].top_api_keys[0]).toMatchObject({
			api_key: "hash",
			key_alias: "Build",
			spend: 2,
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
