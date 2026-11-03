/**
 * Speed 页面纯函数工具：区间推导、时间轴标签、图表行构建、模型过滤与曲线配色。
 *
 * 这些函数不依赖 React 或网络，页面与测试共用同一套「时间怎么对齐、数字怎么显示」。
 */

import { addDays, currentDayInTimeZone } from "./types";
import type { SpeedBucket, SpeedModelSeries, SpeedPoint } from "./types";

/** 页面可选的统计区间（天） */
export const SPEED_RANGE_OPTIONS: ReadonlyArray<{ readonly value: number; readonly label: string }> = [
	{ value: 1, label: "最近 24 小时" },
	{ value: 7, label: "最近 7 天" },
	{ value: 30, label: "最近 30 天" },
	{ value: 90, label: "最近 90 天" },
];

/** 曲线配色的上界：200 TPS 视为 100% 饱和（纯红），更高的取值不再更红 */
export const SPEED_FULL_SATURATION_TPS = 200;

export interface SpeedRange {
	readonly startDate: string;
	readonly endDate: string;
}

export interface SpeedChartRow {
	readonly timestamp: number;
	readonly label: string;
	/** 该时段没有可用样本时为 null，图表据此断线 */
	readonly tps: number | null;
	readonly p50: number | null;
	readonly requests: number;
}

/** 纵向渐变上的一个停靠点 */
export interface SpeedStrokeStop {
	readonly offset: number;
	readonly color: string;
}

/**
 * 由「最近 N 天」推出接口需要的起止日期（按浏览器时区的自然日）。
 * @param days - 天数，至少 1
 * @param timezone - IANA 时区名
 * @param now - 当前时刻（便于测试）
 */
export function resolveSpeedRange(days: number, timezone: string, now: Date = new Date()): SpeedRange {
	const safeDays = Math.max(1, Math.floor(days));
	const endDate = currentDayInTimeZone(timezone, now);
	return { startDate: addDays(endDate, -(safeDays - 1)), endDate };
}

/**
 * 输出 TPS 的统一显示格式：保留一位小数，非有限值显示为 -。
 * @param value - TPS 数值
 */
export function formatTps(value: number | null): string {
	if (value === null || !Number.isFinite(value)) {
		return "-";
	}
	return value.toFixed(1);
}

/**
 * 时间桶的本地时间标签。
 * @param timestamp - 桶起点的毫秒时间戳
 * @param bucket - 粒度
 * @param timezone - IANA 时区名
 */
export function formatSpeedBucketLabel(timestamp: number, bucket: SpeedBucket, timezone: string): string {
	const date = new Date(timestamp);
	if (Number.isNaN(date.getTime())) {
		return "";
	}
	const options: Intl.DateTimeFormatOptions =
		bucket === "hour"
			? { timeZone: timezone, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }
			: { timeZone: timezone, month: "2-digit", day: "2-digit" };
	return new Intl.DateTimeFormat("zh-CN", options).format(date);
}

/**
 * 把接口返回的稀疏数据点铺到完整时间轴上。
 *
 * 时间轴来自后端（与分桶用同一套时区规则），没有样本的时段留 null：图表据此断线，
 * 而不是把前后两个点直接连起来假装中间有数据。样本不足的时段后端已经剔除，这里同样表现为空。
 * @param points - 接口数据点
 * @param buckets - 完整桶时间轴（UTC ISO-8601）
 * @param bucket - 粒度
 * @param timezone - IANA 时区名
 */
export function buildSpeedChartRows(
	points: readonly SpeedPoint[],
	buckets: readonly string[],
	bucket: SpeedBucket,
	timezone: string,
): SpeedChartRow[] {
	const byTimestamp = new Map<number, SpeedPoint>();
	for (const point of points) {
		const timestamp = Date.parse(point.bucket);
		if (Number.isFinite(timestamp) && Number.isFinite(point.avg_tps)) {
			byTimestamp.set(timestamp, point);
		}
	}

	const rows: SpeedChartRow[] = [];
	for (const iso of buckets) {
		const timestamp = Date.parse(iso);
		if (!Number.isFinite(timestamp)) {
			continue;
		}
		const point = byTimestamp.get(timestamp);
		rows.push({
			timestamp,
			label: formatSpeedBucketLabel(timestamp, bucket, timezone),
			tps: point ? point.avg_tps : null,
			p50: point ? point.p50_tps : null,
			requests: point ? point.requests : 0,
		});
	}
	return rows;
}

/**
 * 当前显示的所有卡片共用的纵轴上限。
 *
 * 取所有可见模型里最高的一个采样值：卡片之间的高度因此可以直接比较，
 * 而不会因为「各自按本图最大值缩放」把 20 TPS 的模型画得和 120 TPS 一样高。
 * @param models - 当前显示的模型序列
 */
export function resolveSpeedAxisMax(models: readonly SpeedModelSeries[]): number {
	let max = 0;
	for (const model of models) {
		for (const point of model.points) {
			if (Number.isFinite(point.avg_tps) && point.avg_tps > max) {
				max = point.avg_tps;
			}
		}
	}
	return max;
}

/**
 * 按模型名过滤（大小写不敏感）。
 * @param models - 模型序列
 * @param query - 搜索词
 */
export function filterSpeedModels(models: readonly SpeedModelSeries[], query: string): SpeedModelSeries[] {
	const needle = query.trim().toLowerCase();
	const list = Array.from(models);
	if (needle.length === 0) {
		return list;
	}
	return list.filter((entry) => entry.model.toLowerCase().includes(needle));
}

/**
 * 按输出 TPS 取曲线颜色。
 *
 * 绝对标尺：0 TPS 是青绿，200 TPS 是 100% 饱和的纯红，超过 200 仍是纯红。
 * 用绝对值而不是「本图最高点」来决定颜色，跨卡片才能横向比较：同样是红色，
 * 在任何一张卡片里都代表同一个速度量级。
 * @param tps - 输出 TPS
 */
export function speedStrokeColor(tps: number): string {
	const ratio = Number.isFinite(tps) && tps > 0 ? Math.min(1, tps / SPEED_FULL_SATURATION_TPS) : 0;
	const hue = 175 * (1 - ratio);
	const saturation = 70 + 30 * ratio;
	return "hsl(" + hue.toFixed(1) + ", " + saturation.toFixed(1) + "%, 45%)";
}

/**
 * 生成纵向渐变的停靠点，让曲线颜色随取值变化。
 *
 * 返回值按「图上方 → 图下方」排列：offset 0 对应本图最大值，offset 1 对应最小值，
 * 与 recharts 折线在 objectBoundingBox 中的纵向位置一致。
 * @param domainMin - 本图纵轴最小值
 * @param domainMax - 本图纵轴最大值
 */
export function buildSpeedStrokeStops(domainMin: number, domainMax: number): SpeedStrokeStop[] {
	const span = domainMax - domainMin;
	if (!Number.isFinite(span) || span <= 0) {
		const flat = speedStrokeColor(domainMax);
		return [
			{ offset: 0, color: flat },
			{ offset: 1, color: flat },
		];
	}

	const values = new Set<number>();
	const steps = 8;
	for (let index = 0; index <= steps; index += 1) {
		values.add(domainMin + (span * index) / steps);
	}
	// 200 是饱和拐点：落在区间内时固定一个停靠点，避免拐点被采样跨过
	if (SPEED_FULL_SATURATION_TPS > domainMin && SPEED_FULL_SATURATION_TPS < domainMax) {
		values.add(SPEED_FULL_SATURATION_TPS);
	}

	return Array.from(values)
		.sort((left, right) => right - left)
		.map((value) => ({
			offset: Math.min(1, Math.max(0, (domainMax - value) / span)),
			color: speedStrokeColor(value),
		}));
}
