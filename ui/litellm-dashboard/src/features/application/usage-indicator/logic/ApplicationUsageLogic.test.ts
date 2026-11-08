import { describe, it, expect, afterEach } from "vitest";
import {
	applicationUsageMetrics,
	daysUntilLicenseExpiration,
	formatLicenseExpiration,
	hideUsageIndicator,
	quotaMetrics,
} from "./ApplicationUsageLogic";
import type { ApplicationUsageData } from "../support/ApplicationUsageModels";
const originalZone = process.env.TZ;
afterEach(() => {
	if (originalZone === undefined) delete process.env.TZ;
	else process.env.TZ = originalZone;
});
const usage = (total: number | null = 10, used = 8): ApplicationUsageData => ({
	total_users: total,
	total_users_used: used,
	total_users_remaining: total === null ? null : total - used,
	total_teams: null,
	total_teams_used: 0,
	total_teams_remaining: null,
});
describe("Application usage indicator semantics", () => {
	it("keeps the indicator visible for signed-in admins unless the browser preference disables it", () => {
		expect(hideUsageIndicator(true, false)).toBe(false);
		expect(hideUsageIndicator(true, true)).toBe(true);
		expect(hideUsageIndicator(false, false)).toBe(true);
	});
	it("keeps 100 percent near limit, marks above 100 as over, and treats zero limits like the existing card", () => {
		expect(quotaMetrics(10, 8)).toMatchObject({ isNearLimit: true, isOverLimit: false });
		expect(quotaMetrics(10, 10)).toMatchObject({ isNearLimit: true, isOverLimit: false });
		expect(quotaMetrics(10, 11)).toMatchObject({ isNearLimit: false, isOverLimit: true });
		expect(quotaMetrics(10, 11).usagePercentage).toBeCloseTo(110);
		expect(quotaMetrics(0, 1).usagePercentage).toBe(0);
	});
	it("uses the worst quota or license status and retains separate user/team progress", () => {
		const value = usage(10, 2);
		value.total_teams = 2;
		value.total_teams_used = 3;
		const metrics = applicationUsageMetrics(value, null);
		expect(metrics).toMatchObject({
			error: true,
			warning: false,
			hasIssue: true,
			user: { usagePercentage: 20 },
			team: { usagePercentage: 150 },
		});
	});
	it("preserves the UTC expiration versus local-midnight rounding used by the old UI", () => {
		process.env.TZ = "Asia/Shanghai";
		expect(daysUntilLicenseExpiration("2026-11-07", new Date("2026-11-07T12:00:00+08:00"))).toBe(1);
		expect(formatLicenseExpiration(daysUntilLicenseExpiration("2026-11-07", new Date("2026-11-08T12:00:00+08:00")))).toBe(
			"Expires today",
		);
		expect(daysUntilLicenseExpiration(null)).toBeNull();
	});
	it("keeps the original expiration wording thresholds and whole-month approximation", () => {
		expect([null, -1, 0, 1, 29, 30, 59, 60, 89].map(formatLicenseExpiration)).toEqual([
			"No expiration",
			"Expired",
			"Expires today",
			"1 day remaining",
			"29 days remaining",
			"1 month remaining",
			"1 month remaining",
			"2 months remaining",
			"2 months remaining",
		]);
	});
});
