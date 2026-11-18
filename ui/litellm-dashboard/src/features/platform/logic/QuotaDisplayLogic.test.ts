import { describe, expect, it } from "vitest";
import { formatResetCountdown, isRemainingExhausted, QUOTA_TONE_COLORS, remainingTone, roundedRemainingPercent } from "./QuotaDisplayLogic";

describe("quota display logic", () => {
	it("把 0.21% 的浮点余量显示并标记为耗尽", () => {
		expect(roundedRemainingPercent(0.21)).toBe(0);
		expect(roundedRemainingPercent(0.1)).toBe(0);
		expect(isRemainingExhausted(0.21)).toBe(true);
		expect(remainingTone(0.21)).toBe("danger");
	});

	it("不足 1% 但取整后仍有 1% 时不标记为耗尽", () => {
		expect(roundedRemainingPercent(0.6)).toBe(1);
		expect(isRemainingExhausted(0.6)).toBe(false);
	});

	it("保留原有的低额度、警戒和正常颜色档位", () => {
		expect(remainingTone(5)).toBe("danger");
		expect(remainingTone(20)).toBe("warning");
		expect(remainingTone(50)).toBe("ok");
		expect(remainingTone(null)).toBe("ok");
		expect(QUOTA_TONE_COLORS.danger).toBe("#ff4d4f");
	});

	describe("quota reset countdown", () => {
		const now = Date.parse("2026-11-18T12:00:00Z");

		it("formats the reset time relative to now instead of an absolute timestamp", () => {
			expect(formatResetCountdown("2026-11-22T00:00:00Z", now)).toBe("in 3 days 12 hours");
			expect(formatResetCountdown("2026-11-18T12:43:00Z", now)).toBe("in 43 minutes");
			expect(formatResetCountdown("2026-11-18T12:01:00Z", now)).toBe("in 1 minute");
			expect(formatResetCountdown("2026-11-18T13:05:00Z", now)).toBe("in 1 hour 5 minutes");
			expect(formatResetCountdown("2026-11-19T12:00:00Z", now)).toBe("in 1 day");
		});

		it("rounds up to the next minute and handles unit boundaries", () => {
			expect(formatResetCountdown("2026-11-18T12:00:45Z", now)).toBe("in less than a minute");
			expect(formatResetCountdown("2026-11-18T12:42:01Z", now)).toBe("in 43 minutes");
			expect(formatResetCountdown("2026-11-18T12:59:59Z", now)).toBe("in 1 hour");
			expect(formatResetCountdown("2026-11-18T13:00:00Z", now)).toBe("in 1 hour");
			expect(formatResetCountdown("2026-11-19T13:00:00Z", now)).toBe("in 1 day 1 hour");
		});

		it("marks elapsed and invalid reset times separately from future windows", () => {
			expect(formatResetCountdown("2026-11-18T11:59:00Z", now)).toBe("now");
			expect(formatResetCountdown(null, now)).toBeNull();
			expect(formatResetCountdown("not-a-date", now)).toBeNull();
		});
	});
});
