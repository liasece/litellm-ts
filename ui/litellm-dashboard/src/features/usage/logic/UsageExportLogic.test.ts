import { describe, expect, it } from "vitest";
import { emptyDailyActivity } from "../stores/DailyActivityStore";
import { emptyMetrics } from "./UsageSummaryLogic";
import { exportCsv, generateExportData, generateMetadata, resolveEntities } from "./UsageExportLogic";
function fixture() {
	const data = emptyDailyActivity(),
		keyA = {
			metrics: { ...emptyMetrics(), spend: 3, api_requests: 3, total_tokens: 30 },
			metadata: { key_alias: "Build, A", team_id: "t1" },
		},
		keyB = {
			metrics: { ...emptyMetrics(), spend: 5, api_requests: 5, total_tokens: 50 },
			metadata: { key_alias: "Key B", team_id: null },
		};
	const modelA = {
		metrics: { ...emptyMetrics(), spend: 1, api_requests: 1, total_tokens: 10 },
		metadata: {},
		api_key_breakdown: { a: { ...keyA, metrics: { ...keyA.metrics, spend: 1, api_requests: 1, total_tokens: 10 } } },
	};
	const modelB = {
		metrics: { ...emptyMetrics(), spend: 2, api_requests: 2, total_tokens: 20 },
		metadata: {},
		api_key_breakdown: { a: { ...keyA, metrics: { ...keyA.metrics, spend: 2, api_requests: 2, total_tokens: 20 } } },
	};
	data.results = [
		{
			date: "2026-11-07",
			metrics: { ...emptyMetrics(), spend: 8 },
			breakdown: {
				models: { "model-a": modelA, "model-b": modelB },
				model_groups: {},
				mcp_servers: {},
				providers: {},
				api_keys: { a: keyA, b: keyB },
				entities: {},
				endpoints: {},
			},
		},
	];
	data.metadata.total_spend = 8;
	return data;
}
describe("downloaded usage data", () => {
	it("reconstructs missing entities from each key's team and retains unassigned keys", () => {
		const entities = resolveEntities(fixture().results[0].breakdown);
		expect(Object.keys(entities)).toEqual(["t1", "Unassigned"]);
		expect(entities.t1.metrics.spend).toBe(3);
		expect(entities.Unassigned.metrics.spend).toBe(5);
	});
	it("exports each model's attributed key metrics once instead of duplicating the key's total for every model", () => {
		const rows = generateExportData(fixture(), "daily_with_models", "Team", { t1: "Engineering" });
		expect(rows).toEqual([
			{
				Date: "2026-11-07",
				Team: "Engineering",
				"Team ID": "t1",
				Model: "model-a",
				"Spend ($)": "1.0000",
				Requests: 1,
				Successful: 0,
				Failed: 0,
				"Total Tokens": 10,
			},
			{
				Date: "2026-11-07",
				Team: "Engineering",
				"Team ID": "t1",
				Model: "model-b",
				"Spend ($)": "2.0000",
				Requests: 2,
				Successful: 0,
				Failed: 0,
				"Total Tokens": 20,
			},
		]);
		expect(rows.reduce((sum, row) => sum + Number(row["Spend ($)"]), 0)).toBe(3);
	});
	it("merges repeated date/team/key rows and produces stable CSV columns and CRLF escaping", () => {
		const data = fixture();
		data.results.push(structuredClone(data.results[0]));
		const rows = generateExportData(data, "daily_with_keys", "Team", { t1: ' Engineering "A" ' });
		expect(rows).toHaveLength(2);
		expect(rows[0]["Spend ($)"]).toBe("6.0000");
		const csv = exportCsv(rows);
		expect(csv).toContain('" Engineering ""A"" "');
		expect(csv).toContain('"Build, A"');
		expect(csv).toContain("\r\n");
		expect(exportCsv([])).toBe("");
	});
	it("keeps dates, filters and totals in JSON metadata", () => {
		const from = new Date("2026-11-01T00:00:00Z"),
			to = new Date("2026-11-07T12:00:00Z");
		expect(generateMetadata("team", { from, to }, ["t1"], "daily", fixture())).toMatchObject({
			entity_type: "team",
			date_range: { from: from.toISOString(), to: to.toISOString() },
			filters_applied: ["t1"],
			export_scope: "daily",
			summary: { total_spend: 8 },
		});
	});
});
