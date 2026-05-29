/**
 * CooldownManager 测试
 */
import { CooldownManager } from "./CooldownManager";

describe("CooldownManager", () => {
	let cm: CooldownManager;

	beforeEach(() => {
		cm = new CooldownManager();
	});

	it("marks a deployment as failed and enters cooldown", () => {
		cm.markFailed("gpt-4", 5000);
		expect(cm.isInCooldown("gpt-4")).toBe(true);
	});

	it("returns false for deployment not in cooldown", () => {
		expect(cm.isInCooldown("claude")).toBe(false);
	});

	it("clears cooldown", () => {
		cm.markFailed("gpt-4", 5000);
		cm.clearCooldown("gpt-4");
		expect(cm.isInCooldown("gpt-4")).toBe(false);
	});

	it("tracks multiple deployments independently", () => {
		cm.markFailed("gpt-4", 5000);
		cm.markFailed("claude", 10000);
		expect(cm.isInCooldown("gpt-4")).toBe(true);
		expect(cm.isInCooldown("claude")).toBe(true);
		cm.clearCooldown("gpt-4");
		expect(cm.isInCooldown("gpt-4")).toBe(false);
		expect(cm.isInCooldown("claude")).toBe(true);
	});

	it("getRemainingCooldown returns positive during cooldown", () => {
		cm.markFailed("gpt-4", 10000);
		const remaining = cm.getRemainingCooldown("gpt-4");
		expect(remaining).toBeGreaterThan(0);
		expect(remaining).toBeLessThanOrEqual(10000);
	});

	it("getRemainingCooldown returns 0 when not in cooldown", () => {
		expect(cm.getRemainingCooldown("gpt-4")).toBe(0);
	});

	it("cooldown expires automatically", async () => {
		cm.markFailed("gpt-4", 100);
		await new Promise((r) => setTimeout(r, 200));
		expect(cm.isInCooldown("gpt-4")).toBe(false);
	});
});
