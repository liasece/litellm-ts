import { describe, it, expect } from "vitest";
import { routerPayload } from "./RouterPayloadLogic";
describe("router settings request contract", () => {
	it("keeps hidden fallbacks, parses explicit null/booleans, preserves malformed JSON and excludes non-latency args", () => {
		const value = routerPayload(
			{
				num_retries: 3,
				timeout: 60,
				retry_policy: { RateLimitErrorRetries: 2 },
				model_group_alias: { old: "new" },
				routing_strategy: "simple-shuffle",
				routing_strategy_args: { ttl: 3600 },
				fallbacks: [{ primary: ["backup"] }],
				other: false,
			},
			{ num_retries: "", timeout: "null", retry_policy: "{bad", model_group_alias: "", other: "TRUE" },
			"least-busy",
			true,
		);
		expect(value).toEqual({
			router_settings: {
				num_retries: 0,
				timeout: null,
				retry_policy: { RateLimitErrorRetries: 2 },
				model_group_alias: null,
				routing_strategy: "least-busy",
				fallbacks: [{ primary: ["backup"] }],
				other: true,
				enable_tag_filtering: true,
			},
		});
	});
	it("collects only populated latency fields and preserves zero", () => {
		expect(
			routerPayload(
				{ routing_strategy: "simple-shuffle", routing_strategy_args: {} },
				{ ttl: "3600", lowest_latency_buffer: "0" },
				"latency-based-routing",
				false,
			),
		).toEqual({
			router_settings: {
				routing_strategy: "latency-based-routing",
				routing_strategy_args: { ttl: 3600, lowest_latency_buffer: 0 },
				enable_tag_filtering: false,
			},
		});
	});

	it("keeps unchanged latency defaults when only another visible field is edited", () => {
		const original = { routing_strategy: "simple-shuffle", routing_strategy_args: { ttl: 3600, lowest_latency_buffer: 0 } };
		expect(routerPayload(original, { ttl: "7200" }, "latency-based-routing", false).router_settings.routing_strategy_args).toEqual({
			lowest_latency_buffer: 0,
			ttl: 7200,
		});
		expect(
			routerPayload(original, { lowest_latency_buffer: "" }, "latency-based-routing", false).router_settings.routing_strategy_args,
		).toEqual({ ttl: 3600 });
	});
});
