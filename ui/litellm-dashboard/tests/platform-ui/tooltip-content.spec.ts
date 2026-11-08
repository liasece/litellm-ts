import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
	await page.goto("/ui/tests/platform-ui/controls.html");
});

test("empty help never opens a blank popup on pointer or keyboard focus", async ({ page }) => {
	for (const label of ["Undefined help", "Empty help"]) {
		const trigger = page.getByRole("button", { name: label, exact: true });
		await trigger.hover();
		await page.waitForTimeout(150);
		await expect(page.getByRole("tooltip")).toHaveCount(0);
		await trigger.focus();
		await expect(trigger.locator("..")).not.toHaveAttribute("aria-describedby");
		await expect(page.getByRole("tooltip")).toHaveCount(0);
	}
});

test("clearing an open title removes the popup and its accessible description", async ({ page }) => {
	const trigger = page.getByRole("button", { name: "Dynamic help", exact: true });
	await trigger.focus();
	await expect(page.getByRole("tooltip")).toHaveText("Mutable help");
	await page.getByRole("textbox", { name: "Tooltip title", exact: true }).evaluate((input: HTMLInputElement) => {
		input.value = "";
		input.dispatchEvent(new Event("input", { bubbles: true }));
	});
	await expect(page.getByRole("tooltip")).toHaveCount(0);
	await expect(trigger.locator("..")).not.toHaveAttribute("aria-describedby");
	await expect(trigger).toBeFocused();
});

test("forwarded content and named slots still show their help", async ({ page }) => {
	for (const [label, content] of [
		["Forwarded help trigger", "Forwarded help"],
		["Slotted help trigger", "Slotted help"],
	]) {
		const trigger = page.getByRole("button", { name: label, exact: true });
		await trigger.focus();
		await expect(page.getByRole("tooltip")).toHaveText(content);
		await trigger.press("Escape");
		await expect(page.getByRole("tooltip")).toHaveCount(0);
	}
});
