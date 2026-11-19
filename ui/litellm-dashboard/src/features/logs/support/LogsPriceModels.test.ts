/**
 * 单价快照读取：只认请求时冻结的数据，历史行不受当前配置/上游目录影响。
 */
import { describe, expect, it } from "vitest";
import type { LogEntry } from "./LogsModels";
import { priceBackfill, priceSnapshot, priceSnapshotRows, priceTierView, upstreamPriceFields } from "./LogsPriceModels";

const log = (data: Partial<LogEntry>): LogEntry => ({ request_id: "fixture", startTime: "2026-11-07T00:00:00Z", ...data });
const frozen = log({
	metadata: {
		cost_breakdown: {
			price_snapshot: {
				unit_prices: {
					input_cost_per_token: 1.4e-6,
					output_cost_per_token: 4.4e-6,
					cache_read_input_token_cost: 2.6e-7,
				},
				sources: {
					input_cost_per_token: "upstream",
					output_cost_per_token: "config",
					cache_read_input_token_cost: "model_cost_map",
				},
				peak: { tier: "peak", multiplier: 1.2 },
				upstream: {
					source: "opencode-go",
					upstream_model: "glm-5.3",
					fetched_at: "2026-11-18T10:40:00.000Z",
					unit_prices: { input_cost_per_token: 1.4e-6, output_cost_per_token: 4.4e-6 },
				},
			},
		},
	},
});

describe("backfilled price rows", () => {
	it("marks rows whose cost was filled in later instead of at request time", () => {
		const backfilled = log({
			metadata: {
				cost_breakdown: {
					price_snapshot: {
						unit_prices: { input_cost_per_token: 1.4e-6 },
						sources: { input_cost_per_token: "upstream" },
					},
					backfill: { at: "2026-11-18T15:29:49.153Z", reason: "upstream catalog price was not in effect" },
				},
			},
		});
		expect(priceBackfill(backfilled)).toEqual({ at: "2026-11-18T15:29:49.153Z", reason: "upstream catalog price was not in effect" });
		// 快照本身仍是上游价，费用来源图标的门槛不变。
		expect(upstreamPriceFields(priceSnapshot(backfilled))).toEqual(["input_cost_per_token"]);
		expect(priceBackfill(frozen)).toBeUndefined();
	});
});

describe("frozen price snapshot", () => {
	it("reads the prices frozen at request time with their sources", () => {
		const snapshot = priceSnapshot(frozen);
		expect(snapshot?.unitPrices.input_cost_per_token).toBe(1.4e-6);
		expect(snapshot?.sources.output_cost_per_token).toBe("config");
		expect(snapshot?.peak).toEqual({ tier: "peak", multiplier: 1.2 });
		expect(snapshot?.upstream?.upstreamModel).toBe("glm-5.3");
	});

	it("only reports upstream-sourced fields as upstream priced", () => {
		expect(upstreamPriceFields(priceSnapshot(frozen))).toEqual(["input_cost_per_token"]);
		const configOnly = log({
			metadata: {
				cost_breakdown: {
					price_snapshot: { unit_prices: { input_cost_per_token: 1e-6 }, sources: { input_cost_per_token: "config" } },
				},
			},
		});
		expect(upstreamPriceFields(priceSnapshot(configOnly))).toEqual([]);
	});

	it("renders only fields that participated in billing, with per-million prices", () => {
		const rows = priceSnapshotRows(priceSnapshot(frozen)!);
		expect(rows.map((row) => row.label)).toEqual(["输入", "输出", "缓存读取"]);
		expect(rows[0]).toMatchObject({ perMillion: "$1.40", sourceLabel: "上游目录", fromUpstream: true });
		expect(rows[1]).toMatchObject({ perMillion: "$4.40", sourceLabel: "部署配置", fromUpstream: false });
		expect(rows[2].perMillion).toBe("$0.260");
	});

	it("shows the price actually charged, not only the base price, when peak pricing applied", () => {
		const rows = priceSnapshotRows(priceSnapshot(frozen)!);
		expect(rows[0]).toMatchObject({ perMillion: "$1.40", appliedPerMillion: "$1.68" });
		expect(rows[2].appliedPerMillion).toBe("$0.312");
	});

	it("labels the frozen tier with an icon and the multiplier used for this request", () => {
		expect(priceTierView({ tier: "peak", multiplier: 2 })).toMatchObject({
			label: "峰时",
			icon: "Sun",
			multiplier: "×2",
		});
		expect(priceTierView({ tier: "off_peak", multiplier: 1 })).toMatchObject({
			label: "谷时",
			icon: "Moon",
		});
		expect(priceTierView(undefined)).toBeUndefined();
		// 未知档位不冒充谷时：没有可解释的档位就不显示标记。
		expect(priceTierView({ tier: "future_tier", multiplier: 2 })).toBeUndefined();
	});

	it("returns nothing for rows logged before the snapshot existed", () => {
		expect(priceSnapshot(log({}))).toBeUndefined();
		expect(priceSnapshot(log({ metadata: { cost_breakdown: { upstream_priced_fields: ["input_cost_per_token"] } } }))).toBeUndefined();
		expect(
			priceSnapshot(log({ metadata: { cost_breakdown: { price_snapshot: { sources: { input_cost_per_token: "bogus" } } } } })),
		).toBeUndefined();
	});
});
