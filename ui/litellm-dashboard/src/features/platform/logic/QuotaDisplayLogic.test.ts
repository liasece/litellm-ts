import { describe, expect, it } from "vitest";
import { isRemainingExhausted, QUOTA_TONE_COLORS, remainingTone, roundedRemainingPercent } from "./QuotaDisplayLogic";

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
});
