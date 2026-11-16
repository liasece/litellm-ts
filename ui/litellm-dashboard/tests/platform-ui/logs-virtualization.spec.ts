import { expect, test } from "@playwright/test";

const TOTAL = 300;
const rows = Array.from({ length: TOTAL }, (_, index) => ({
	request_id: `virtual-${String(index).padStart(4, "0")}`,
	startTime: new Date(Date.UTC(2026, 10, 15, 2, 0, index % 60)).toISOString(),
	endTime: new Date(Date.UTC(2026, 10, 15, 2, 0, index % 60) + 1_500).toISOString(),
	call_type: "acompletion",
	model: "openai/gpt-fixture",
	spend: 0.001,
	prompt_tokens: 100,
	completion_tokens: 20,
	total_tokens: 120,
	status: "success",
	request_duration_ms: 1_500,
	metadata: { status: "success" },
}));

test.beforeEach(async ({ page }) => {
	await page.route("**/spend/logs/ui**", (route) =>
		route.fulfill({
			json: {
				data: rows,
				total: TOTAL,
				page: 1,
				page_size: 1_000,
				total_pages: 1,
				session_total_count: TOTAL,
			},
		}),
	);
	await page.route("**/config/list**", (route) => route.fulfill({ json: [] }));
	await page.route("**/key/list**", (route) => route.fulfill({ json: { keys: [], total_count: 0 } }));
	await page.route("**/v2/team/list**", (route) => route.fulfill({ json: { teams: [] } }));
});

test("only mounts the visible log rows and swaps them while scrolling", async ({ page }) => {
	await page.goto("/ui/tests/logs/logs.html?logs_page_size=1000");
	const dataRows = page.locator("tbody tr.ui-table__row");
	await expect(dataRows.first()).toBeVisible();

	// 300 行数据不应变成 300 个已挂载的日志行；虚拟窗口只保留当前视口附近的行。
	expect(await dataRows.count()).toBeLessThan(100);
	await expect(page.locator("tbody tr").filter({ hasText: "virtual-0000" })).toBeVisible();

	await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
	await expect(page.locator("tbody tr").filter({ hasText: "virtual-0299" })).toBeVisible({ timeout: 5_000 });
	expect(await dataRows.count()).toBeLessThan(100);

	await page.evaluate(() => window.scrollTo(0, 0));
	await expect(page.locator("tbody tr").filter({ hasText: "virtual-0000" })).toBeVisible();
});

test("keeps a usable window after leaving and returning to the request logs tab", async ({ page }) => {
	await page.goto("/ui/tests/logs/logs.html?logs_page_size=1000");
	const dataRows = page.locator("tbody tr.ui-table__row");
	await expect(dataRows.first()).toBeVisible();

	await page.getByRole("tab", { name: "Deleted Keys" }).click();
	await expect(page.getByRole("tab", { name: "Deleted Keys" })).toHaveAttribute("aria-selected", "true");
	await page.getByRole("tab", { name: "Request Logs" }).click();
	await expect(dataRows.first()).toBeVisible();
	expect(await dataRows.count()).toBeLessThan(100);
});

test("updates the window when the application uses an inner scroll container", async ({ page }) => {
	await page.goto("/ui/tests/logs/logs-inner-scroll.html?logs_page_size=1000");
	const dataRows = page.locator("tbody tr.ui-table__row");
	await expect(dataRows.first()).toBeVisible();
	expect(await dataRows.count()).toBeLessThan(100);
	const before = await dataRows.first().innerText();

	const container = page.locator("#logs-scroll");
	await container.evaluate((element) => {
		element.scrollTop = element.scrollHeight;
	});
	await expect(page.locator("tbody tr").filter({ hasText: "virtual-0299" })).toBeVisible({ timeout: 5_000 });
	expect(await dataRows.first().innerText()).not.toBe(before);
	expect(await dataRows.count()).toBeLessThan(100);
});
