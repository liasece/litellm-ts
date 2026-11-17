import { describe, expect, it } from "vitest";
import {
	buildModelResolutionLines,
	durationMs,
	modelIdentity,
	tokenCostBreakdown,
	tokenDataPending,
	tokenMetrics,
	tpsMetrics,
	ttftMs,
} from "./LogsPresentationLogic";
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
	it("prefers compact cache columns over metadata and falls back when they are absent", () => {
		const metadata = {
			additional_usage_values: {
				prompt_tokens_details: { cached_tokens: 600 },
				cache_creation_input_tokens: 100,
			},
		};
		expect(
			tokenMetrics(
				log({
					prompt_tokens: 1000,
					completion_tokens: 10,
					metadata,
					cache_read_input_tokens: 700,
					cache_creation_input_tokens: 200,
				}),
			),
		).toEqual({ cacheRead: 700, creation: 200, input: 300, output: 10 });
		expect(tokenMetrics(log({ prompt_tokens: 1000, completion_tokens: 10, metadata }))).toEqual({
			cacheRead: 600,
			creation: 100,
			input: 400,
			output: 10,
		});
		// 非法列值（负数）按缺失处理，仍读 metadata。
		expect(tokenMetrics(log({ prompt_tokens: 1000, metadata, cache_read_input_tokens: -1 })).cacheRead).toBe(600);
	});
	it("shows no token data while a request is still in progress", () => {
		const pending = log({ status: "in_progress", prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
		expect(tokenDataPending(pending)).toBe(true);
		expect(tokenDataPending({ ...pending, metadata: { status: "in_progress" } })).toBe(true);
		expect(tokenDataPending({ ...pending, prompt_tokens: 320 })).toBe(false);
		expect(tokenDataPending(log({ prompt_tokens: 0, completion_tokens: 0 }))).toBe(false);
	});
	it("measures input TPS over TTFT and output TPS over the generation window", () => {
		const value = tpsMetrics(
			log({
				prompt_tokens: 1000,
				cache_read_input_tokens: 600,
				completion_tokens: 100,
				completionStartTime: "2026-11-07T00:00:02Z",
				endTime: "2026-11-07T00:00:10Z",
			}),
		);
		expect(value).toEqual({
			input: { value: 200, tokens: 400, seconds: 2 },
			output: { value: 12.5, tokens: 100, seconds: 8 },
		});
		expect(
			tpsMetrics(log({ completion_tokens: 19, completionStartTime: "2026-11-07T00:00:02Z", endTime: "2026-11-07T00:00:10Z" }))
				?.output,
		).toBeNull();
	});
	it("hides TPS when TTFT consumes the whole request or has no separate generation window", () => {
		const base = { startTime: "2026-11-07T00:00:00Z", endTime: "2026-11-07T00:00:10Z", completion_tokens: 100 };
		expect(tpsMetrics(log({ ...base, completionStartTime: "2026-11-07T00:00:10Z" }))).toBeNull();
		expect(tpsMetrics(log({ ...base, completionStartTime: "2026-11-07T00:00:09.95Z" }))).toBeNull();
		expect(tpsMetrics(log({ ...base, completionStartTime: "2026-11-07T00:00:11Z" }))).toBeNull();
		expect(tpsMetrics(log({ ...base, completionStartTime: null }))).toBeNull();
		expect(tpsMetrics(log({ ...base, completionStartTime: "invalid" }))).toBeNull();
	});
	it("hides TPS when the generation window is too short to measure, even if it passes the share check", () => {
		// 12 秒的 Responses 请求里，上游一次 flush 出 1800 个 token，首字到结束只有
		// 150 毫秒：占 1.25% 通过了比例检查，但算出来是 12000 TPS 的投递尖峰。
		const burst = {
			startTime: "2026-11-07T00:00:00Z",
			completionStartTime: "2026-11-07T00:00:11.85Z",
			endTime: "2026-11-07T00:00:12Z",
			completion_tokens: 1800,
		};
		expect(tpsMetrics(log(burst))).toBeNull();
		// 299 毫秒仍在门槛内
		expect(tpsMetrics(log({ ...burst, completionStartTime: "2026-11-07T00:00:11.701Z" }))).toBeNull();
		// 300 毫秒是下限本身：达到门槛就按可测算处理
		const measured = tpsMetrics(log({ ...burst, completionStartTime: "2026-11-07T00:00:11.7Z" }));
		expect(measured?.output).toEqual({ value: 6000, tokens: 1800, seconds: 0.3 });
	});
	it("reports TTFT only for requests that stream content to the client", () => {
		// 非流式请求只有一个交付时刻：后端把它记成完成起始时间，与 Duration 重合。
		const nonStream = log({
			stream: false,
			startTime: "2026-11-07T00:00:00Z",
			completionStartTime: "2026-11-07T00:00:09.999Z",
			endTime: "2026-11-07T00:00:10Z",
		});
		expect(ttftMs(nonStream)).toBeNull();
		// 流式请求的首帧早于结束，这个值是要看的首字延迟。
		expect(ttftMs(log({ stream: true, completionStartTime: "2026-11-07T00:00:02Z", endTime: "2026-11-07T00:00:10Z" }))).toBe(2000);
		// 历史行没有流式标记时不能假定非流式，仍按时间戳给出观测值。
		expect(ttftMs(log({ completionStartTime: "2026-11-07T00:00:02Z", endTime: "2026-11-07T00:00:10Z" }))).toBe(2000);
		expect(ttftMs(log({ stream: true }))).toBeNull();
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
	it("rejects malformed resolution paths and shows each hop without repeating the source model", () => {
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
			// 来源模型 "routed" 已由上一行显示，Fallback 行只说明换到了 "fallback"。
			{ label: "Fallback 1", path: ["fallback"] },
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
