import { expect, test } from "@playwright/test";

test("counts down an active fallback cooldown and clears it at expiry", async ({ page }) => {
	await page.clock.install({ time: new Date("2026-11-19T10:00:00.000Z") });
	await page.clock.pauseAt(new Date("2026-11-19T10:00:00.000Z"));
	await page.goto("/ui/tests/platform-ui/model-cooldown.html");

	const badge = page.getByTestId("model-cooldown");
	await expect(badge).toHaveText("Cooldown 3s");
	await expect(badge).toHaveAttribute("title", /1m total, 3s remaining/);

	await page.clock.runFor(1_000);
	await expect(badge).toHaveText("Cooldown 2s");

	await page.clock.runFor(2_000);
	await expect(badge).toHaveCount(0);
	await expect(page.getByTestId("model-cooldown-empty")).toHaveText("-");
});
