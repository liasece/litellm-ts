import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
	await page.goto("/ui/tests/platform-ui/controls.html");
});

test("keyboard navigation keeps the selected Tremor tab and its original transparent focus outline", async ({ page }) => {
	const navigation = page.getByTestId("tremor-navigation"),
		tabs = navigation.getByRole("tab");
	await tabs.nth(0).focus();
	await tabs.nth(0).press("ArrowRight");
	await expect(tabs.nth(1)).toBeFocused();
	await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
	await expect(tabs.nth(1)).toHaveCSS("outline-color", "rgba(0, 0, 0, 0)");
	await expect(tabs.nth(1)).toHaveCSS("border-bottom-color", "rgb(99, 102, 241)");
});

test("an AntD navigation bar keeps its selected tab visible after resizing", async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 1000 });
	const navigation = page.getByTestId("responsive-antd-navigation"),
		settings = navigation.getByRole("tab", { name: "Settings", exact: true });
	await settings.click();
	await page.setViewportSize({ width: 390, height: 1000 });
	await expect.poll(async () => navigation.getByRole("tablist").evaluate((e) => e.scrollLeft)).toBeGreaterThan(0);
	const selected = (await settings.boundingBox())!,
		box = (await navigation.boundingBox())!;
	expect(selected.x).toBeGreaterThanOrEqual(box.x);
	expect(selected.x + selected.width).toBeLessThanOrEqual(box.x + box.width);
});
