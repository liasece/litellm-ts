import { describe, expect, it, vi } from "vitest";
import { cooldownDeadline, cooldownDeadlineForSnapshot, formatCooldownDuration } from "./ModelCooldownLogic";
import type { ModelCooldown } from "../support/ModelModels";

const cooldown: ModelCooldown = {
	deployment_id: "gpt-4o-primary",
	duration_ms: 60_000,
	remaining_ms: 42_000,
	expires_at: "2026-11-19T10:00:00.000Z",
};

describe("model cooldown display", () => {
	it("uses the response-relative remainder instead of the absolute server clock", () => {
		expect(cooldownDeadline(cooldown, 1_000)).toBe(43_000);
	});
	it("shares one deadline for a snapshot mounted in both the table and the mobile cards", () => {
		vi.useFakeTimers();
		try {
			vi.setSystemTime(10_000);
			const snapshot = { ...cooldown };
			expect(cooldownDeadlineForSnapshot(snapshot)).toBe(52_000);
			vi.setSystemTime(10_700);
			expect(cooldownDeadlineForSnapshot(snapshot)).toBe(52_000);
			expect(cooldownDeadlineForSnapshot({ ...cooldown })).toBe(52_700);
		} finally {
			vi.useRealTimers();
		}
	});
	it("formats a compact countdown that rounds up instead of showing 0s while active", () => {
		expect(formatCooldownDuration(42_000)).toBe("42s");
		expect(formatCooldownDuration(500)).toBe("1s");
		expect(formatCooldownDuration(60_000)).toBe("1m");
		expect(formatCooldownDuration(61_000)).toBe("1m 1s");
		expect(formatCooldownDuration(3_661_000)).toBe("1h 1m");
		expect(formatCooldownDuration(0)).toBeNull();
		expect(formatCooldownDuration(-1)).toBeNull();
	});
});
