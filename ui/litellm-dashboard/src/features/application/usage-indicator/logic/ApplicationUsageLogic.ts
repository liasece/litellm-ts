import type { ApplicationUsageData, ApplicationLicenseInfo, UsageQuotaMetrics } from "../support/ApplicationUsageModels";
export function daysUntilLicenseExpiration(expirationDate: string | null, now = new Date()): number | null {
	if (!expirationDate) return null;
	const expiration = new Date(expirationDate + "T00:00:00Z"),
		midnight = new Date(now);
	midnight.setHours(0, 0, 0, 0);
	return Math.ceil((expiration.getTime() - midnight.getTime()) / 86400000);
}
export function formatLicenseExpiration(days: number | null): string {
	if (days === null) return "No expiration";
	if (days < 0) return "Expired";
	if (days === 0) return "Expires today";
	if (days === 1) return "1 day remaining";
	if (days < 30) return days + " days remaining";
	if (days < 60) return "1 month remaining";
	return Math.floor(days / 30) + " months remaining";
}
export function quotaMetrics(total: number | null, used: number): UsageQuotaMetrics {
	const usagePercentage = total ? (used / total) * 100 : 0;
	return { isOverLimit: usagePercentage > 100, isNearLimit: usagePercentage >= 80 && usagePercentage <= 100, usagePercentage };
}
export function applicationUsageMetrics(data: ApplicationUsageData | null, license: ApplicationLicenseInfo | null, now = new Date()) {
	const user = quotaMetrics(data?.total_users ?? null, data?.total_users_used ?? 0),
		team = quotaMetrics(data?.total_teams ?? null, data?.total_teams_used ?? 0),
		days = daysUntilLicenseExpiration(license?.expiration_date ?? null, now),
		expired = days !== null && days < 0,
		expiring = days !== null && days >= 0 && days < 30,
		over = user.isOverLimit || team.isOverLimit,
		near = (user.isNearLimit || team.isNearLimit) && !over,
		error = over || expired,
		warning = (near || expiring) && !error;
	return { user, team, days, expired, expiring, hasIssue: over || near || expired || expiring, error, warning };
}
export const usageTone = (metrics: UsageQuotaMetrics): "error" | "warning" | "normal" =>
	metrics.isOverLimit ? "error" : metrics.isNearLimit ? "warning" : "normal";
/**
 * 指示器只在未登录或用户主动关闭时隐藏；没有许可上限时仍显示已用用户数/团队数。
 * @param authorized - 已完成登录
 * @param disabled - 用户偏好中关闭了用量指示器
 */
export const hideUsageIndicator = (authorized: boolean, disabled: boolean) => disabled || !authorized;
