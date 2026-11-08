import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
	await page.goto("/ui/tests/platform-ui/controls.html");
});

test("Tremor prop icons preserve original sizes, side margins and label geometry", async ({ page }) => {
	for (const [size, pixels] of [
		["sm", 20],
		["xs", 16],
		["lg", 24],
	] as const) {
		const button = page.getByTestId("tremor-icon-" + size);
		const icon = (await button.locator(".ui-button__tremor-icon").boundingBox())!;
		const label = (await button.locator(".ui-button__label").boundingBox())!;
		expect(icon.width).toBe(pixels);
		expect(icon.height).toBe(pixels);
		expect(Math.abs(icon.y + icon.height / 2 - label.y - label.height / 2)).toBeLessThan(0.5);
		expect(label.x - icon.x - icon.width).toBe(6);
	}
	const small = page.getByTestId("tremor-icon-xs");
	expect((await small.boundingBox())!.width - (await small.locator(".ui-button__label").boundingBox())!.width).toBe(18);
});

test("a Tremor AntD prop icon keeps its inner glyph and loading replaces the icon", async ({ page }) => {
	const button = page.getByTestId("tremor-antd-icon");
	expect((await button.locator(".ui-button__tremor-icon").boundingBox())!.width).toBe(20);
	expect((await button.locator("svg").boundingBox())!.width).toBe(14);
	const pending = page.getByTestId("tremor-loading");
	await expect(pending).toBeDisabled();
	await expect(pending.locator("svg")).toHaveCount(1);
	await expect(pending.locator("svg")).toHaveCSS("width", "20px");
});

test("Tremor tabs, table and select roots inherit a containing AntD font while the popup uses the body font", async ({ page }) => {
	const context = page.getByTestId("inherited-tremor-font");
	const font = await context.evaluate((element) => getComputedStyle(element).fontFamily);
	for (const selector of [".ui-tabs__tab", ".ui-select", ".ui-table-wrapper"]) {
		await expect(context.locator(selector)).toHaveCSS("font-family", font);
	}
	await context.getByRole("combobox", { name: "Nested inherited choice", exact: true }).click();
	const bodyFont = await page.locator("body").evaluate((element) => getComputedStyle(element).fontFamily);
	await expect(page.getByRole("listbox")).toHaveCSS("font-family", bodyFont);
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

test("AntD action buttons yield to a narrow title while Tremor actions retain their width", async ({ page }) => {
	const button = page.getByTestId("shrinkable-antd-button");
	await expect(button).toHaveCSS("flex-shrink", "1");
	await expect(button.locator(".ui-icon")).toHaveCSS("flex-shrink", "1");
	expect((await button.boundingBox())!.width).toBe(100);
	expect((await button.locator(".ui-icon").boundingBox())!.width).toBeLessThan(14);
	await expect(page.getByTestId("tremor-icon-sm")).toHaveCSS("flex-shrink", "0");
});

test("AntD ink bars stay outside layout while Tremor button keyboard focus retains its transparent outline", async ({ page }) => {
	const navigation = page.getByTestId("antd-navigation"),
		list = navigation.getByRole("tablist");
	const tab = navigation.getByRole("tab", { name: "Overview", exact: true });
	expect((await tab.boundingBox())!.height).toBe(46);
	expect((await list.boundingBox())!.height).toBe(46);
	const listBox = (await list.boundingBox())!,
		panelBox = (await page.getByTestId("after-antd-navigation").boundingBox())!;
	expect(panelBox.y - listBox.y - listBox.height).toBe(16);
	const button = page.getByTestId("tremor-icon-sm");
	await button.focus();
	await expect(button).toHaveCSS("outline-color", "rgba(0, 0, 0, 0)");
	await expect(button).toHaveCSS("outline-width", "2px");
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
