import { describe, it, expect } from "vitest";
import { cacheMetrics } from "./CacheMetricsLogic";
import { gatherCacheValues } from "./CacheSettingsLogic";
import { cacheHealthDetails, failedCacheHealth } from "./CacheHealthLogic";
import type { CacheField } from "../api/CacheApi";
describe("cache dashboard contracts", () => {
	it("filters keys/models before aggregating requests, cache hits and token totals", () => {
		const rows = [
			{
				api_key: "a",
				model: "gpt",
				call_type: "chat",
				total_rows: 20,
				cache_hit_true_rows: 5,
				cached_completion_tokens: 100,
				generated_completion_tokens: 300,
			},
			{ api_key: "b", model: "gpt", call_type: "", total_rows: 10, cache_hit_true_rows: 2, cached_completion_tokens: 50 },
		];
		expect(cacheMetrics(rows, ["a"], ["gpt"])).toEqual({
			hits: 5,
			tokens: 100,
			ratio: "25.00",
			chart: [
				{
					name: "chat",
					"LLM API requests": 15,
					"Cache hit": 5,
					"Cached Completion Tokens": 100,
					"Generated Completion Tokens": 300,
				},
			],
		});
		expect(cacheMetrics(rows, ["missing"], []).ratio).toBe("0");
	});
	it("keeps explicit zero and false while omitting unmounted, inapplicable or invalid JSON fields", () => {
		const fields: CacheField[] = [
			{ field_name: "port", field_type: "Integer" },
			{ field_name: "ssl", field_type: "Boolean" },
			{ field_name: "ttl", field_type: "Float" },
			{ field_name: "nodes", field_type: "List", redis_type: "cluster" },
			{ field_name: "broken", field_type: "List" },
			{ field_name: "embedding", field_type: "Models_Select", redis_type: "semantic" },
			{ field_name: "redis_type", field_type: "String" },
		];
		const inputs = {
			port: "0",
			ssl: false,
			nodes: '[{"host":"test"}]',
			broken: "{bad",
			embedding: "  embed-model  ",
			redis_type: "semantic",
		};
		expect(gatherCacheValues(fields, "semantic", inputs)).toEqual({ type: "redis", port: 0, ssl: false, embedding: "embed-model" });
		expect(gatherCacheValues(fields, "semantic", inputs, true).type).toBe("redis-semantic");
	});
	it("preserves nested cache errors and formats the same raw values as the legacy response view", () => {
		const failed = failedCacheHealth(
			new Error(
				JSON.stringify({
					error: {
						message: JSON.stringify({
							message: "Connection refused",
							traceback: "fixture traceback",
							litellm_cache_params: { type: "redis" },
							health_check_cache_params: { host: "cache.test", port: 6379 },
						}),
					},
				}),
			),
		);
		const detail = cacheHealthDetails(failed);
		expect(detail.rows).toContainEqual({ label: "Error Message", value: "Connection refused" });
		expect(detail.rows).toContainEqual({ label: "Redis Host", value: "cache.test" });
		expect(JSON.parse(detail.raw).health_check_cache_params.port).toBe(6379);
	});
});
