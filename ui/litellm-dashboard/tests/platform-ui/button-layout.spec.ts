import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
	await page.goto("/ui/tests/platform-ui/controls.html");
});

test("keyboard navigation keeps the selected Tremor tab and its focus state", async ({ page }) => {
	const navigation = page.getByTestId("tremor-navigation"),
		tabs = navigation.getByRole("tab");
	await tabs.nth(0).focus();
	await tabs.nth(0).press("ArrowRight");
	await expect(tabs.nth(1)).toBeFocused();
	await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
});
