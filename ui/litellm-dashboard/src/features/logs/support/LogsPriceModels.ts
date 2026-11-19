/**
 * 请求时冻结的计费单价：读取与展示。
 *
 * 单价会变：上游调价、部署改价、价目表更新。费用日志在请求发生时把「实际单价 + 来源
 * + 当时的上游目录价」写进 `metadata.cost_breakdown.price_snapshot`，界面只读这份快照，
 * 不用今天的配置或上游目录去解释历史费用。
 *
 * 这里也决定「哪些位置该显示上游图标」：只有来源为 `upstream` 的单价才显示，
 * 配置价、价目表价、默认缓存价都不显示，避免每个费用格都挂一个图标。
 */

import type { LogEntry } from "./LogsModels";

/** 单价来源（与后端 PriceSource 对齐）。 */
export type PriceFieldSource = "config" | "upstream" | "model_cost_map" | "default" | "unset";

/** 快照里的上游目录信息。 */
export interface PriceSnapshotUpstream {
	readonly source: string;
	readonly upstreamModel: string;
	readonly fetchedAt: string;
	readonly unitPrices: Readonly<Record<string, number>>;
}

/** 请求发生时命中的峰谷档位与倍率。 */
export interface LogPricePeak {
	readonly tier: string;
	readonly multiplier: number;
}

/** 一份请求的单价快照。 */
export interface LogPriceSnapshot {
	/** 字段 → per-token 单价。 */
	readonly unitPrices: Readonly<Record<string, number>>;
	/** 字段 → 单价来源。 */
	readonly sources: Readonly<Record<string, PriceFieldSource>>;
	/** 峰谷档位；未配置峰谷时不存在。 */
	readonly peak?: LogPricePeak;
	/** 上游目录价（仅当请求时上游给了该模型价格）。 */
	readonly upstream?: PriceSnapshotUpstream;
}

/** 计费字段的展示顺序与名称。 */
const PRICE_FIELDS: ReadonlyArray<readonly [string, string]> = [
	["input_cost_per_token", "输入"],
	["output_cost_per_token", "输出"],
	["cache_read_input_token_cost", "缓存读取"],
	["cache_creation_input_token_cost", "缓存写入"],
];

/** 来源的中文说明。 */
const SOURCE_LABELS: Readonly<Record<PriceFieldSource, string>> = {
	config: "部署配置",
	upstream: "上游目录",
	model_cost_map: "内置价目表",
	default: "默认缓存价",
	unset: "未配置",
};

/**
 * 来源的中文名。
 * @param source - 来源
 */
export function priceSourceLabel(source: PriceFieldSource): string {
	return SOURCE_LABELS[source] ?? source;
}

function finite(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function record(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringMap(value: unknown): Record<string, string> {
	const result: Record<string, string> = {};
	for (const [key, item] of Object.entries(record(value))) {
		if (typeof item === "string") result[key] = item;
	}
	return result;
}

function numberMap(value: unknown): Record<string, number> {
	const result: Record<string, number> = {};
	for (const [key, item] of Object.entries(record(value))) {
		const parsed = finite(item);
		if (parsed !== undefined) result[key] = parsed;
	}
	return result;
}

const PRICE_SOURCES = new Set<string>(["config", "upstream", "model_cost_map", "default", "unset"]);

/**
 * 读取日志行里的单价快照；没有或格式不符时返回 undefined（历史行一律不显示来源提示）。
 * @param log - 日志行
 */
export function priceSnapshot(log: LogEntry): LogPriceSnapshot | undefined {
	const raw = record(record(log.metadata?.cost_breakdown)["price_snapshot"]);
	const unitPrices = numberMap(raw["unit_prices"]);
	const sources: Record<string, PriceFieldSource> = {};
	for (const [field, source] of Object.entries(stringMap(raw["sources"]))) {
		if (PRICE_SOURCES.has(source)) sources[field] = source as PriceFieldSource;
	}
	if (Object.keys(sources).length === 0) return undefined;
	const peakRecord = record(raw["peak"]);
	const peakTier = peakRecord["tier"];
	const peakMultiplier = finite(peakRecord["multiplier"]);
	const upstreamRecord = record(raw["upstream"]);
	const upstreamSource = upstreamRecord["source"];
	const upstreamModel = upstreamRecord["upstream_model"];
	const upstreamFetchedAt = upstreamRecord["fetched_at"];
	return {
		unitPrices: unitPrices,
		sources: sources,
		...(typeof peakTier === "string" && peakMultiplier !== undefined ? { peak: { tier: peakTier, multiplier: peakMultiplier } } : {}),
		...(typeof upstreamSource === "string" && typeof upstreamModel === "string" && typeof upstreamFetchedAt === "string"
			? {
					upstream: {
						source: upstreamSource,
						upstreamModel: upstreamModel,
						fetchedAt: upstreamFetchedAt,
						unitPrices: numberMap(upstreamRecord["unit_prices"]),
					},
				}
			: {}),
	};
}

/** 事后补记标记：这一行的费用不是请求发生时算出来的，而是后来按上游目录价补上的。 */
export interface PriceBackfill {
	/** 补记时间（ISO）。 */
	readonly at: string;
	readonly reason?: string;
}

/**
 * 读取事后补记标记。
 *
 * 计费口径上线前的一批订阅请求在库里是 spend=0；为了让历史花费可解释，这些行按当时
 * 上游目录价补记，并带上这个标记。界面据此把「请求时冻结」改成「事后补记」，不冒充
 * 原始计费结果。
 * @param log - 日志行
 */
export function priceBackfill(log: LogEntry): PriceBackfill | undefined {
	const raw = record(record(record(log.metadata?.cost_breakdown)["backfill"]));
	const at = raw["at"];
	if (typeof at !== "string") return undefined;
	const reason = raw["reason"];
	return { at, ...(typeof reason === "string" ? { reason } : {}) };
}

/**
 * 本次请求里哪些单价来自上游（按展示顺序）。页面据此决定是否显示上游图标。
 * @param snapshot - 单价快照
 */
export function upstreamPriceFields(snapshot: LogPriceSnapshot | undefined): readonly string[] {
	if (snapshot === undefined) return [];
	return PRICE_FIELDS.map(([field]) => field).filter((field) => snapshot.sources[field] === "upstream");
}

/** 一行单价展示。 */
export interface PriceSnapshotRow {
	readonly field: string;
	readonly label: string;
	/** 每百万 token 的基础单价文本（快照里的 per-token 单价 × 1M）。 */
	readonly perMillion: string;
	/** 本次请求实收的每百万 token 单价；峰时已乘上快照里的倍率。 */
	readonly appliedPerMillion: string;
	readonly source: PriceFieldSource;
	readonly sourceLabel: string;
	readonly fromUpstream: boolean;
}

/** 每百万 token 单价的展示文本。 */
function formatPerMillion(perToken: number): string {
	const perMillion = perToken * 1_000_000;
	const digits = perMillion >= 1 ? 2 : perMillion >= 0.01 ? 3 : 4;
	return `$${perMillion.toFixed(digits)}`;
}

/**
 * 快照 → 展示行；只保留真正参与计费的字段（来源不是 unset）。
 *
 * `perMillion` 保留快照里的基础价，`appliedPerMillion` 是本次实际计费的单价
 * （峰时乘上倍率）。费用气泡既要能核对本次金额，也要能看出峰谷价差，两者都给出。
 * @param snapshot - 单价快照
 */
export function priceSnapshotRows(snapshot: LogPriceSnapshot): PriceSnapshotRow[] {
	const rows: PriceSnapshotRow[] = [];
	const multiplier = snapshot.peak?.multiplier;
	const factor = typeof multiplier === "number" && Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
	for (const [field, label] of PRICE_FIELDS) {
		const source = snapshot.sources[field];
		const perToken = snapshot.unitPrices[field];
		if (source === undefined || source === "unset" || perToken === undefined) continue;
		rows.push({
			field: field,
			label: label,
			perMillion: formatPerMillion(perToken),
			appliedPerMillion: formatPerMillion(perToken * factor),
			source: source,
			sourceLabel: priceSourceLabel(source),
			fromUpstream: source === "upstream",
		});
	}
	return rows;
}

/** 峰谷图标的展示模型。 */
export interface PriceTierView {
	readonly tier: "peak" | "off_peak";
	readonly label: string;
	readonly icon: "Sun" | "Moon";
	/** 峰时的倍率角标；谷时或倍率 1 时省略。 */
	readonly multiplier?: string;
	readonly description: string;
}

/**
 * 峰谷档位 → 图标与文案。
 *
 * 后端只写 `peak` / `off_peak` 两种档位；遇到未知档位宁可不显示，也不要把
 * 一条无法解释的价格标成谷时价。图标用太阳/月亮，和文案一起出现，不单靠颜色。
 * @param peak - 请求时冻结的峰谷档位
 */
export function priceTierView(peak: LogPricePeak | undefined): PriceTierView | undefined {
	if (peak === undefined) return undefined;
	if (peak.tier === "peak") {
		const scaled = peak.multiplier > 1;
		return {
			tier: "peak",
			label: "峰时",
			icon: "Sun",
			...(scaled ? { multiplier: `×${peak.multiplier}` } : {}),
			description: scaled ? `高峰时段，单价按基础价 ×${peak.multiplier} 计费` : "高峰时段，按基础价计费",
		};
	}
	if (peak.tier === "off_peak") {
		return { tier: "off_peak", label: "谷时", icon: "Moon", description: "空闲时段，按谷时基础价计费" };
	}
	return undefined;
}
