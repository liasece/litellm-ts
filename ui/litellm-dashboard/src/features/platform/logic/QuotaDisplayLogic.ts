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
