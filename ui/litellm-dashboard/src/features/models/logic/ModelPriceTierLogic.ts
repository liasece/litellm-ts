/**
 * 模型峰谷定价的解析与展示模型。
 *
 * deployment 的基础价按空闲时段配置，峰时按 `peak_pricing.multiplier` 上浮（判档逻辑在
 * 后端 `src/cost/CostCalculator.ts`）。模型列表要同时给出两档，操作者才看得出这个价格
 * 什么时候生效。配置非法（窗口为空、倍率不大于 1、时间格式不对）时按单档处理：宁可不
 * 显示峰谷，也不显示一个永远不会生效的峰时价。
 */
import type { ModelPeakPricing, ModelPeakWindow } from "../support/ModelModels";

/** HH:mm（00:00–23:59）。 */
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

/** ISO 星期缩写，索引 0 对应周一。 */
const DAY_NAMES: readonly string[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function record(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/** 单个窗口；字段缺失或时间格式不对时整条窗口作废。 */
function parseWindow(value: unknown): ModelPeakWindow | undefined {
	const raw = record(value);
	if (raw === undefined) {
		return undefined;
	}
	const days = Array.isArray(raw.days)
		? raw.days.filter((day): day is number => typeof day === "number" && Number.isInteger(day) && day >= 1 && day <= 7)
		: [];
	const start = typeof raw.start === "string" && CLOCK.test(raw.start) ? raw.start : undefined;
	const end = typeof raw.end === "string" && CLOCK.test(raw.end) ? raw.end : undefined;
	if (days.length === 0 || start === undefined || end === undefined) {
		return undefined;
	}
	return { days: [...new Set(days)].sort((left, right) => left - right), start, end };
}

/**
 * 解析 deployment 的 `model_info.peak_pricing`。
 * @param raw - 接口返回的原始配置
 * @returns 校验后的配置；没有、不可用或倍率不大于 1 时返回 undefined
 */
export function parsePeakPricing(raw: unknown): ModelPeakPricing | undefined {
	const value = record(raw);
	if (value === undefined) {
		return undefined;
	}
	const multiplier = value.multiplier;
	if (typeof multiplier !== "number" || !Number.isFinite(multiplier) || multiplier <= 1) {
		return undefined;
	}
	const windows = Array.isArray(value.windows)
		? value.windows.map(parseWindow).filter((window): window is ModelPeakWindow => window !== undefined)
		: [];
	if (windows.length === 0) {
		return undefined;
	}
	const timezone = typeof value.timezone === "string" && value.timezone.length > 0 ? value.timezone : "Asia/Shanghai";
	return { windows: windows, timezone: timezone, multiplier: multiplier };
}

/** 连续星期压成区间：1–5 → Mon–Fri；断开的按逗号列出。 */
function formatDays(days: readonly number[]): string {
	const sorted = [...days].sort((left, right) => left - right);
	const runs: number[][] = [];
	for (const day of sorted) {
		const last = runs.at(-1);
		if (last !== undefined && day === last.at(-1)! + 1) {
			last.push(day);
		} else {
			runs.push([day]);
		}
	}
	return runs
		.map((run) =>
			run.length >= 3 ? `${DAY_NAMES[run[0]! - 1]}–${DAY_NAMES[run.at(-1)! - 1]}` : run.map((day) => DAY_NAMES[day - 1]).join(", "),
		)
		.join(", ");
}

/**
 * 峰时窗口摘要，模型列表的悬停文案。
 * @param pricing - 已校验的峰谷配置
 */
export function peakPricingSummary(pricing: ModelPeakPricing): string {
	const windows = pricing.windows.map((window) => `${formatDays(window.days)} ${window.start}–${window.end}`).join(", ");
	return `Peak ×${pricing.multiplier} during ${windows} (${pricing.timezone ?? "Asia/Shanghai"}); other times use the off-peak price.`;
}

/** 一档单价的展示因子。 */
export interface ModelCostTier {
	/** 档位标识；无峰谷配置时只有 base 一档。 */
	readonly key: "base" | "peak";
	/** 相对基础价的倍数。 */
	readonly multiplier: number;
	/** 档位文字；无峰谷配置时不显示。 */
	readonly label?: string;
	/** 档位图标（lucide 名）；无峰谷配置时不显示。 */
	readonly icon?: string;
}

/**
 * 单价展示档位：有峰谷配置时给出空闲价与峰时价两档，否则只有基础价一档。
 * @param peak - 已校验的峰谷配置
 */
export function modelCostTiers(peak: ModelPeakPricing | undefined): readonly ModelCostTier[] {
	if (peak === undefined) {
		return [{ key: "base", multiplier: 1 }];
	}
	return [
		{ key: "base", multiplier: 1, label: "Off-peak", icon: "Moon" },
		{ key: "peak", multiplier: peak.multiplier, label: `Peak ×${peak.multiplier}`, icon: "Sun" },
	];
}
