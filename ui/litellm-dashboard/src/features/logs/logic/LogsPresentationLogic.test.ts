import { describe, expect, it } from "vitest";
import { buildModelResolutionLines, durationMs, modelIdentity, outputTps, tokenCostBreakdown, tokenMetrics } from "./LogsPresentationLogic";
import type { LogEntry } from "../support/LogsModels";
const log = (data: Partial<LogEntry>): LogEntry => ({ request_id: "fixture", startTime: "2026-11-07T00:00:00Z", ...data });
describe("request log presentation contracts", () => {
	it("separates cache reads from input without subtracting cache creation twice", () => {
		const value = tokenMetrics(
			log({
				prompt_tokens: 1000,
				completion_tokens: -2,
				metadata: { additional_usage_values: { prompt_tokens_details: { cached_tokens: 600 }, cache_creation_input_tokens: 100 } },
			}),
		);
		expect(value).toEqual({ cacheRead: 600, creation: 100, input: 400, output: 0 });
	});
	it("uses the complete request duration for TPS and hides small outputs", () => {
		expect(
			outputTps(log({ completion_tokens: 100, endTime: "2026-11-07T00:00:10Z", completionStartTime: "2026-11-07T00:00:09Z" })),
		).toEqual({ value: 10, duration: 10, tokens: 100 });
		expect(outputTps(log({ completion_tokens: 19 }))).toBeNull();
		expect(outputTps(log({ completion_tokens: 20, endTime: "invalid" }))).toBe("-");
	});
	it("never presents discounts or tool spend as cache input cost", () => {
		expect(tokenCostBreakdown(log({ metadata: { cost_breakdown: { total_cost: 10, input_cost: 2, output_cost: 3 } } }))).toMatchObject({
			cacheInputCost: 5,
		});
		expect(
			tokenCostBreakdown(log({ metadata: { cost_breakdown: { total_cost: 10, input_cost: 2, output_cost: 3, tool_usage_cost: 5 } } }))
				.cacheInputCost,
		).toBeUndefined();
		expect(
			tokenCostBreakdown(log({ metadata: { cost_breakdown: { cache_read_input_cost: 1, cache_creation_input_cost: 2 } } }))
				.cacheInputCost,
		).toBe(3);
	});
	it("rejects malformed resolution paths and preserves fallback/alias ordering", () => {
		expect(
			buildModelResolutionLines(
				["alias", "fallback"],
				[
					{ fallback_index: 0, input_model: "alias", resolved_model: "routed", resolution_path: ["alias", "routed"] },
					{ fallback_index: -1, resolution_path: ["bad", "evil"] },
				],
				"executed",
			),
		).toEqual([
			{ label: "Request", path: ["alias"] },
			{ label: "Alias", path: ["alias", "routed"] },
			{ label: "Fallback 1", path: ["routed", "fallback"] },
			{ label: "Executed", path: ["executed"] },
		]);
	});
	it("advances active duration while retaining the server lower bound", () => {
		const start = "2026-11-07T00:00:00Z";
		expect(durationMs(start, 3000, Date.parse(start) + 1000)).toBe(3000);
		expect(durationMs(start, 3000, Date.parse(start) + 5000)).toBe(5000);
		expect(durationMs("invalid", 3000, Date.now())).toBe(3000);
	});
});

it("uses the final upstream request for the model icon after a fallback and preserves a tool's own logo", () => {
	const entry = log({
		model: "gpt-public-alias",
		custom_llm_provider: "commandcode",
		proxy_server_request: { upstream_request: { body: { model: "deepseek/deepseek-v4.1-flash" } } },
	});
	expect(modelIdentity(entry)).toMatchObject({
		displayName: "gpt-public-alias",
		executed: "deepseek/deepseek-v4.1-flash",
		provider: "commandcode",
	});
	expect(modelIdentity({ ...entry, metadata: { mcp_tool_call_metadata: { mcp_server_logo_url: "/tool.png" } } }).toolLogo).toBe(
		"/tool.png",
	);
	expect(modelIdentity(log({ model: "cliproxy/opencode-go/claude-opus", custom_llm_provider: "cliproxy" })).provider).toBe("opencode-go");
});

it("uses the recorded deployment family on a compact log row while details prefer the actual upstream request", () => {
	const row = log({ model: "gpt-public-alias", metadata: { model_map_information: { model_map_value: { model_family: "Claude" } } } });
	expect(modelIdentity(row).family).toBe("Claude");
	expect(modelIdentity({ ...row, proxy_server_request: { upstream_request: { body: { model: "gemini-3-pro" } } } })).toMatchObject({
		executed: "gemini-3-pro",
		family: undefined,
	});
});

it("shows the live deployment identity after routing and tracks a new supplier on fallback", () => {
	const waiting = log({ model: "gpt-public-alias", status: "in_progress" });
	expect(modelIdentity(waiting)).toMatchObject({ family: null, provider: "" });
	const metadata = { model_map_information: { model_map_value: { model_family: "DeepSeek" } } };
	const routed = { ...waiting, custom_llm_provider: "commandcode", metadata };
	expect(modelIdentity(routed)).toMatchObject({ family: "DeepSeek", provider: "commandcode" });
	const retried = {
		...routed,
		custom_llm_provider: "opencode-go",
		proxy_server_request: { upstream_request: { body: { model: "gpt-previous" } } },
	};
	expect(modelIdentity(retried)).toMatchObject({ family: "DeepSeek", provider: "opencode-go" });
	expect(modelIdentity({ ...routed, status: "success" })).toMatchObject({ family: "DeepSeek", provider: "commandcode" });
});
