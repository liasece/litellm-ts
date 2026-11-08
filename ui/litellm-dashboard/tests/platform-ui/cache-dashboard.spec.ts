import { expect, test, type Page } from "@playwright/test";
const first = {
	api_key: "key-a",
	model: "gpt-4.1",
	call_type: "acompletion",
	total_rows: 20,
	cache_hit_true_rows: 5,
	cached_completion_tokens: 1000,
	generated_completion_tokens: 3000,
};
async function mount(page: Page, rows: Record<string, unknown>[] = [first]) {
	await page.route("**/global/activity/cache_hits*", (route) => route.fulfill({ json: rows }));
	await page.goto("/ui/tests/cache/cache.html");
	await expect(page.getByText("Cache Hit Ratio", { exact: true })).toBeVisible();
	await expect(page.locator(".cache-chart .echarts svg").first()).toBeVisible();
}
async function blueBar(page: Page) {
	return page
		.locator(".cache-chart")
		.first()
		.locator('svg path[fill="#0ea5e9"]')
		.evaluateAll((nodes) =>
			nodes
				.map((e) => {
					const r = e.getBoundingClientRect();
					return { x: r.x, y: r.y, width: r.width, height: r.height, opacity: getComputedStyle(e).opacity };
				})
				.filter((r) => r.width > 0 && r.height > 0),
		);
}
test("cache stacked bars retain the original single-category width and both numerical formats", async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 1000 });
	await mount(page);
	await expect.poll(async () => blueBar(page)).toHaveLength(1);
	expect((await blueBar(page))[0].width).toBe(816);
	await expect(page.locator(".cache-chart").first().locator("text").filter({ hasText: /^20$/ })).toBeVisible();
	await expect(
		page
			.locator(".cache-chart")
			.nth(1)
			.locator("text")
			.filter({ hasText: /^4,000$/ }),
	).toBeVisible();
	await page.setViewportSize({ width: 390, height: 844 });
	await expect.poll(async () => (await blueBar(page))[0]?.width).toBe(190);
});
test("the cache chart preserves its existing tooltip and does not add category selection to its static legend", async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 1000 });
	await mount(page);
	await expect.poll(async () => blueBar(page)).toHaveLength(1);
	const before = (await blueBar(page))[0];
	await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
	const tooltip = page.locator(".usage-chart-tooltip");
	await expect(tooltip).toBeVisible();
	await expect(tooltip).toContainText("acompletion");
	await expect(tooltip).toContainText("15");
	await expect(tooltip).toContainText("5");
	const legend = await page.locator(".cache-chart").first().getByText("Cache hit", { exact: true }).boundingBox();
	await page.mouse.click(legend!.x + legend!.width / 2, legend!.y + legend!.height / 2);
	await expect.poll(async () => blueBar(page)).toHaveLength(1);
	expect((await blueBar(page))[0].opacity).toBe("1");
});
test("key and model filters apply together to the displayed cache totals", async ({ page }) => {
	await mount(page, [
		first,
		{ ...first, api_key: "key-b", model: "claude", total_rows: 10, cache_hit_true_rows: 2, cached_completion_tokens: 500 },
	]);
	await expect(page.locator(".cache-statistics strong").nth(1)).toHaveText("7");
	const key = page.getByRole("combobox", { name: "Select Virtual Keys", exact: true });
	await key.fill("key-a");
	await key.press("Enter");
	await expect(page.locator(".cache-statistics strong").nth(1)).toHaveText("5");
	const model = page.getByRole("combobox", { name: "Select Models", exact: true });
	await model.fill("claude");
	await model.press("Enter");
	await expect(page.locator(".cache-statistics strong").first()).toHaveText("0%");
	await expect(page.locator(".cache-statistics strong").nth(1)).toHaveText("0");
});
