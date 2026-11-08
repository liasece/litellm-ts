import { expect, test } from "@playwright/test";
test.beforeEach(async ({ page }) => {
	await page.route("**/*", (route) => {
		const path = new URL(route.request().url()).pathname;
		if (path.startsWith("/ui/") || path.startsWith("/@") || path.startsWith("/src/") || path.startsWith("/node_modules/"))
			return route.continue();
		return route.fulfill({ json: path === "/in_product_nudges" ? { is_claude_code_enabled: true } : {} });
	});
	await page.addInitScript(() => {
		window.open = (...args) => {
			(window as unknown as { feedbackOpens: unknown[] }).feedbackOpens.push(args);
			return null;
		};
		(window as unknown as { feedbackOpens: unknown[] }).feedbackOpens = [];
	});
});
test("feedback opens the exact external form and completing does not re-show or persist a completed marker", async ({ page }) => {
	await page.goto("/ui/tests/claude-code-nudge/nudge.html");
	await page.getByRole("button", { name: "Share feedback", exact: true }).click();
	await expect(page.getByText("Help us improve your experience", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Close Claude Code feedback", exact: true }).click();
	await expect(page.getByRole("button", { name: "Share feedback", exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Share feedback", exact: true }).click();
	await page.getByRole("button", { name: "Open Feedback Form", exact: true }).click();
	expect(await page.evaluate(() => (window as unknown as { feedbackOpens: unknown[] }).feedbackOpens)).toEqual([
		["https://forms.gle/LZeJQ3XytBakckYa9", "_blank", "noopener,noreferrer"],
	]);
	await expect(page.locator(".claude-code-modal,.claude-code-prompt")).toHaveCount(0);
	expect(await page.evaluate(() => localStorage.getItem("disableShowPrompts"))).toBeNull();
});
test("Don't ask persists the existing preference and confirmation then expires at five seconds", async ({ page }) => {
	await page.clock.install();
	await page.goto("/ui/tests/claude-code-nudge/nudge.html");
	await page.getByRole("button", { name: "Don't ask me again", exact: true }).click();
	expect(await page.evaluate(() => localStorage.getItem("disableShowPrompts"))).toBe("true");
	await expect(
		page.getByText("Got it, we will not ask again. Reactivate this at any time in the User Menu.", { exact: true }),
	).toBeVisible();
	await page.clock.fastForward(5000);
	await expect(page.locator(".claude-code-prompt")).toHaveCount(0);
});
test("the legacy local storage event reactivates a prompt while its original fifteen second window is active", async ({ page }) => {
	await page.addInitScript(() => localStorage.setItem("disableShowPrompts", "true"));
	await page.clock.install();
	await page.goto("/ui/tests/claude-code-nudge/nudge.html");
	await expect(page.locator(".claude-code-prompt")).toHaveCount(0);
	await page.evaluate(() => {
		localStorage.removeItem("disableShowPrompts");
		window.dispatchEvent(new CustomEvent("local-storage-change", { detail: { key: "disableShowPrompts" } }));
	});
	await expect(page.getByRole("button", { name: "Share feedback", exact: true })).toBeVisible();
	await page.clock.fastForward(15000);
	await expect(page.locator(".claude-code-prompt")).toHaveCount(0);
});
