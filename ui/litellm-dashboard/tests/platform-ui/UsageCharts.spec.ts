import { test, expect } from "@playwright/test";
test("renders the daily bars and forwards actual pointer selection", async ({ page }) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("/ui/tests/platform-ui/usage-chart.html");
	const bars = page.locator(".daily .echarts svg path[fill='#06b6d4']");
	await expect(bars).toHaveCount(3);
	const target = await bars.nth(1).boundingBox();
	expect(target).not.toBeNull();
	const point = { x: target!.x + target!.width / 2, y: target!.y + target!.height / 2 };
	await page.mouse.move(point.x, point.y);
	await expect(page.getByTestId("chart-tooltip")).toHaveText("2026-11-06");
	await page.mouse.click(point.x, point.y);
	await expect(page.getByTestId("selection")).toHaveText("2026-11-06");
	expect(errors).toEqual([]);
});
test("cleans up chart and resize listeners across repeated mounting", async ({ page }) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("/ui/tests/platform-ui/usage-chart.html");
	for (let index = 0; index < 3; index++) {
		await expect(page.locator(".daily .echarts")).toBeVisible();
		await page.getByRole("button", { name: "Toggle charts", exact: true }).click();
		await expect(page.locator(".daily")).toHaveCount(0);
		await page.setViewportSize({ width: 900 + index * 20, height: 800 });
		await page.getByRole("button", { name: "Toggle charts", exact: true }).click();
	}
	await expect(page.locator(".daily .echarts svg path[fill='#06b6d4']")).toHaveCount(3);
	expect(errors).toEqual([]);
});

test("shows area series values and tooltips while hovering the plot", async ({ page }) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("/ui/tests/platform-ui/usage-chart.html");
	await expect(page.locator(".area .usage-native-bar-axes")).toContainText("10,000");
	const chart = page.locator(".area .usage-chart");
	await chart.scrollIntoViewIfNeeded();
	const bounds = await chart.boundingBox();
	expect(bounds).not.toBeNull();
	await page.mouse.move(bounds!.x + 286.5, bounds!.y + 12);
	await expect(page.locator(".usage-chart-tooltip")).toContainText("Day 2");
	await expect(page.locator(".usage-chart-tooltip")).toContainText("Total Tokens");
	await expect(page.locator(".usage-chart-tooltip")).toContainText("6,000");
	await page.mouse.move(1, 1);
	await expect(page.locator(".usage-chart-tooltip")).toHaveCount(0);
	expect(errors).toEqual([]);
});
test("renders the legend values through the value-only formatter", async ({ page }) => {
	await page.goto("/ui/tests/platform-ui/usage-chart.html");
	await expect(page.locator(".legend .usage-native-legend")).toContainText("spend");
	await expect(page.locator(".legend .usage-native-bar-axes")).toContainText("8");
	await expect(page.locator(".legend .usage-native-bar-axes")).not.toContainText("8.0000");
	const chart = page.locator(".daily .usage-chart");
	await chart.scrollIntoViewIfNeeded();
	const bounds = await chart.boundingBox();
	await page.mouse.move(bounds!.x + 375.5, bounds!.y + 10);
	await expect(page.getByTestId("chart-tooltip")).toHaveText("2026-11-06");
});

test("updates the hovered category after resizing without requiring another pointer move", async ({ page }) => {
	await page.goto("/ui/tests/platform-ui/usage-chart.html");
	await expect(page.locator(".daily .echarts svg path[fill='#06b6d4']")).toHaveCount(3);
	const chart = page.locator(".daily .usage-chart"),
		bounds = await chart.boundingBox();
	expect(bounds).not.toBeNull();
	await page.mouse.move(bounds!.x + 210, bounds!.y + 10);
	await expect(page.getByTestId("chart-tooltip")).toHaveText("2026-11-05");
	await page.locator(".daily").evaluate((element) => {
		element.style.width = "330px";
	});
	await expect(page.getByTestId("chart-tooltip")).toHaveText("2026-11-06");
});
