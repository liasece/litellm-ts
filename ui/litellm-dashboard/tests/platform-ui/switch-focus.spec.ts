import { expect, test } from "@playwright/test";
for (const width of [1440, 390]) {
	test("Tremor focus feedback follows pointer and keyboard focus at " + width, async ({ page }) => {
		await page.setViewportSize({ width, height: 844 });
		await page.goto("/ui/tests/platform-ui/switch-focus.html");
		const tremor = page.getByRole("switch", { name: "Tremor choice", exact: true });
		const handle = tremor.locator(".ui-switch__handle");
		await expect(handle).toHaveCSS("outline-style", "none");
		await tremor.click();
		await expect(tremor).toHaveAttribute("aria-checked", "true");
		expect(await tremor.evaluate((element) => element.matches(":focus-visible"))).toBe(false);
		await expect(handle).toHaveCSS("outline-style", "solid");
		await expect(handle).toHaveCSS("outline-width", "2px");
		await page.getByRole("button", { name: "Outside action", exact: true }).click();
		await expect(handle).toHaveCSS("outline-style", "none");
		await page.keyboard.press("Shift+Tab");
		await page.keyboard.press("Shift+Tab");
		await expect(tremor).toBeFocused();
		await expect(handle).toHaveCSS("outline-style", "solid");
		await page.getByRole("switch", { name: "AntD choice", exact: true }).click();
		await expect(page.getByRole("switch", { name: "AntD choice", exact: true }).locator(".ui-switch__handle")).toHaveCSS(
			"outline-style",
			"none",
		);
	});
}
