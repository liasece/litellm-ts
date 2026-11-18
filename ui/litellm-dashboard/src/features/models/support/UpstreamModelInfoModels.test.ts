/**
 * 上游提示的出现条件：图标是「这个值来自上游」的标记，不是资料入口。
 */
import { describe, expect, it } from "vitest";
import { UPSTREAM_PRICE_FIELDS, shouldShowUpstreamHint, upstreamFieldRows, type UpstreamModelInfoPayload } from "./UpstreamModelInfoModels";

const payload = (filled: readonly string[]): UpstreamModelInfoPayload => ({
	source: "opencode-go",
	upstream_model: "glm-5.3",
	status: "ok",
	stale: false,
	fetched_at: "2026-11-18T09:53:18.199Z",
	expires_at: "2026-11-18T13:53:18.199Z",
	model_info: { max_input_tokens: 1_000_000, input_cost_per_token: 1.4e-6, output_cost_per_token: 4.4e-6 },
	raw: null,
	filled_fields: filled,
});

describe("upstream hint gating", () => {
	it("只在展示值确实由上游补位时出现", () => {
		const record = payload(["input_cost_per_token"]);
		expect(shouldShowUpstreamHint(record, "input_cost_per_token", undefined)).toBe(true);
		expect(shouldShowUpstreamHint(record, "output_cost_per_token", undefined)).toBe(false);
		// 模型名等没有对应字段的位置不显示。
		expect(shouldShowUpstreamHint(record, undefined, undefined)).toBe(false);
		// 没有上游信息（未加载或没有该模型）时不显示。
		expect(shouldShowUpstreamHint(undefined, "input_cost_per_token", undefined)).toBe(false);
	});

	it("调用方声明 used 时以此为准，便于不按当前配置推断历史行", () => {
		expect(shouldShowUpstreamHint(undefined, "input_cost_per_token", true)).toBe(true);
		expect(shouldShowUpstreamHint(payload(["input_cost_per_token"]), "input_cost_per_token", false)).toBe(false);
	});

	it("费用位置只列出单价行，不把上下文长度混进费用说明", () => {
		const rows = upstreamFieldRows(payload(["input_cost_per_token"]), UPSTREAM_PRICE_FIELDS);
		expect(rows.map((row) => row.field)).toEqual(["input_cost_per_token", "output_cost_per_token"]);
		const all = upstreamFieldRows(payload(["input_cost_per_token"]));
		expect(all.map((row) => row.field)).toContain("max_input_tokens");
	});
});
