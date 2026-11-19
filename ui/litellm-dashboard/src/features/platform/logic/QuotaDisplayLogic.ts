/** 配额的展示状态；颜色与耗尽文案都由同一套归一化结果决定。 */
export type QuotaTone = "danger" | "warning" | "ok";

/** 进度条和标签统一使用取整后的剩余百分比，避免显示 0% 但状态仍是“未耗尽”。 */
export function roundedRemainingPercent(value: number | null): number | null {
	if (value === null || !Number.isFinite(value)) return null;
	return Math.max(0, Math.min(100, Math.round(value)));
}

/** 显示为 0% 时按耗尽处理；0.21% 这类浮点余量也会触发红色。 */
export function isRemainingExhausted(value: number | null): boolean {
	return roundedRemainingPercent(value) === 0;
}

/**
 * 剩余额度的颜色档位。
 *
 * 阈值仍按真实百分比计算，只有“耗尽”使用展示取整值，保证 0.21% 与 0%
 * 在界面上的红色状态一致。
 */
export function remainingTone(value: number | null): QuotaTone {
	if (value === null || !Number.isFinite(value)) return "ok";
	if (isRemainingExhausted(value) || value < 20) return "danger";
	if (value < 50) return "warning";
	return "ok";
}

/** 与 UsageQuotaWindows、CliProxyQuotaCard 共用的颜色值。 */
export const QUOTA_TONE_COLORS: Readonly<Record<QuotaTone, string>> = {
	danger: "#ff4d4f",
	warning: "#faad14",
	ok: "#52c41a",
};

const MINUTE_MS = 60_000;

/**
 * 把配额窗口的重置时刻转成分钟级倒计时。
 *
 * 精确到秒没有意义：窗口通常以小时/天计，页面也只需要在跨分钟时更新。
 * 倒数不足一分钟时向上取整为“不到一分钟”，避免刚过期前显示 0 分钟；
 * 超过一天只保留天和小时，避免 43 分钟这种零碎单位稀释主要信息。
 */
export function formatResetCountdown(resetsAt: string | null | undefined, now = Date.now()): string | null {
	if (!resetsAt) return null;
	const resetAt = Date.parse(resetsAt);
	if (!Number.isFinite(resetAt)) return null;
	const remaining = resetAt - now;
	if (remaining <= 0) return "now";
	if (remaining < MINUTE_MS) return "in less than a minute";
	const minutes = Math.ceil(remaining / MINUTE_MS);
	if (minutes < 60) return `in ${minutes} minute${minutes === 1 ? "" : "s"}`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) {
		const rest = minutes % 60;
		return `in ${hours} hour${hours === 1 ? "" : "s"}${rest ? ` ${rest} minute${rest === 1 ? "" : "s"}` : ""}`;
	}
	const days = Math.floor(hours / 24);
	const restHours = hours % 24;
	return `in ${days} day${days === 1 ? "" : "s"}${restHours ? ` ${restHours} hour${restHours === 1 ? "" : "s"}` : ""}`;
}

/**
 * 同一倒计时的紧凑写法（in 5d 23h / in 10h 36m / in 42m / in <1m）。
 *
 * 表格里倒计时和进度条、窗口名共处一行，全称会把条挤到很短；单位缩写只用于这种
 * 空间受限的位置，完整说法与精确时间仍由 `formatResetCountdown` 和悬停提示提供。
 */
export function formatShortResetCountdown(resetsAt: string | null | undefined, now = Date.now()): string | null {
	if (!resetsAt) return null;
	const resetAt = Date.parse(resetsAt);
	if (!Number.isFinite(resetAt)) return null;
	const remaining = resetAt - now;
	if (remaining <= 0) return "now";
	if (remaining < MINUTE_MS) return "in <1m";
	const minutes = Math.ceil(remaining / MINUTE_MS);
	if (minutes < 60) return `in ${minutes}m`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) {
		const rest = minutes % 60;
		return `in ${hours}h${rest ? ` ${rest}m` : ""}`;
	}
	const days = Math.floor(hours / 24);
	const restHours = hours % 24;
	return `in ${days}d${restHours ? ` ${restHours}h` : ""}`;
}
