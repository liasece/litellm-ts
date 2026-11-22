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
});

test("draws one percentage line per series and leaves a gap where a day has no value", async ({ page }) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("/ui/tests/platform-ui/usage-chart.html");
	const rate = page.locator(".rate");
	await expect(rate).toBeVisible();
	// 纵轴是 0–100 的百分比刻度，而不是原始 token 数。
	await expect(rate.locator(".usage-native-bar-axes")).toContainText("100%");
	await expect(rate.locator(".usage-native-bar-axes")).toContainText("50%");
	// 每个系列一条线；中间那天为 null 的系列被拆成两段，另两条日期之间没有断点。
	await expect(rate.locator("svg path[stroke='#6366f1']")).toHaveCount(1);
	await expect(rate.locator("svg path[stroke='#10b981']")).toHaveCount(2);
	expect(errors).toEqual([]);
});

test("marks a day without data with a grey band and a No data tooltip", async ({ page }) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("/ui/tests/platform-ui/usage-chart.html");
	const empty = page.locator(".empty-day");
	await expect(empty).toBeVisible();
	// 没有数据的那天不画柱子（其余两天各一根有高度的柱子），也没有被当成 0 贴地补一根。
	const heights = await empty
		.locator("svg path[fill='#06b6d4']")
		.evaluateAll((nodes) => nodes.map((node) => (node as SVGGraphicsElement).getBBox().height));
	expect(heights.filter((height) => height > 0)).toHaveLength(2);
	await expect(empty.locator(".usage-chart-no-data rect[fill='#f3f4f6']")).toHaveCount(1);
	await expect(empty.locator(".usage-chart-no-data text")).toHaveText("No data");
	await empty.scrollIntoViewIfNeeded();
	const band = empty.locator(".usage-chart-no-data rect").first();
	const box = await band.boundingBox();
	expect(box).not.toBeNull();
	await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
	await expect(page.locator(".usage-chart-tooltip")).toContainText("2026-11-06");
	await expect(page.locator(".usage-chart-tooltip")).toContainText("No data");
	expect(errors).toEqual([]);
});
