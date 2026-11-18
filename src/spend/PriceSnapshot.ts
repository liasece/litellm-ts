/**
 * 计费单价快照：把「这次请求实际按什么单价收钱、单价从哪来」冻结进 spend 日志。
 *
 * 单价会变（上游调价、配置修改、价目表更新），费用是历史事实。若只存金额，事后无法
 * 解释某一行是按哪个单价算的，也无法判断当时是否用了上游价。因此 `costPerToken` 把
 * 实际采用的单价与来源交出来，由这里整理成可落库的 JSON，随 `metadata.cost_breakdown`
 * 一起写入 `LiteLLM_SpendLogs`。
 */

import type { AppliedPrices, CustomCostPerToken, PriceSource } from "../cost/CostCalculator";

/** 落库的单价快照结构。 */
export interface PriceSnapshotPayload {
	/** 每个计费字段实际采用的 per-token 单价（不含峰谷系数）。 */
	readonly unit_prices: Readonly<Record<string, number>>;
	/** 每个字段的单价来源。 */
	readonly sources: Readonly<Record<string, PriceSource>>;
	/** 峰谷档位与系数；未配置峰谷时省略。 */
	readonly peak?: {
		readonly tier: "peak" | "off_peak";
		readonly multiplier: number;
	};
	/**
	 * 实际参与计费的上游目录价快照（来源、上游模型、抓取时间、当时的上游单价）。
	 * 只有本次确有字段采用上游价时才记录；否则每个订阅模型都会带一份空目录，
	 * 既没有解释力，又让详情页误以为费用来自上游。
	 */
	readonly upstream?: CustomCostPerToken["upstream_catalog"];
}

/**
 * 组装单价快照。
 * @param prices - costPerToken 返回的实际单价；不计费路径为 undefined
 * @param custom - 本次价格对象（含上游目录快照与峰谷配置）
 * @param peakMultiplier - 本次适用的峰谷系数
 */
export function buildPriceSnapshot(
	prices: AppliedPrices | undefined,
	custom: CustomCostPerToken | undefined,
	peakMultiplier: number,
): PriceSnapshotPayload | undefined {
	if (prices === undefined) {
		return undefined;
	}
	const unitPrices: Record<string, number> = {};
	const sources: Record<string, PriceSource> = {};
	for (const [field, applied] of Object.entries(prices)) {
		if (applied === undefined || applied.source === "unset") {
			continue;
		}
		unitPrices[field] = applied.per_token;
		sources[field] = applied.source;
	}
	if (Object.keys(sources).length === 0) {
		return undefined;
	}
	const usedUpstream = Object.values(sources).includes("upstream");
	const catalog = custom?.upstream_catalog;
	return {
		unit_prices: unitPrices,
		sources: sources,
		...(custom?.peak_pricing === undefined
			? {}
			: { peak: { tier: peakMultiplier > 1 ? ("peak" as const) : ("off_peak" as const), multiplier: peakMultiplier } }),
		...(usedUpstream && catalog !== undefined ? { upstream: catalog } : {}),
	};
}
