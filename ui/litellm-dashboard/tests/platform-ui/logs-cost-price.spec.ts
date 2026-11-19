import { expect, test, type Page } from "@playwright/test";

const log = {
	request_id: "log-cost-price",
	startTime: "2026-11-09T09:00:00Z",
	endTime: "2026-11-09T09:00:02Z",
	call_type: "acompletion",
	model: "deepseek/deepseek-v4-flash",
	spend: 0.0015,
	prompt_tokens: 1000,
	completion_tokens: 1000,
	total_tokens: 2000,
	request_duration_ms: 900,
	status: "success",
	metadata: {
		status: "success",
		cost_breakdown: {
			input_cost: 0.0003,
			output_cost: 0.0012,
			cache_input_cost: 0,
			total_cost: 0.0015,
			price_snapshot: {
				unit_prices: {
					input_cost_per_token: 0.00000015,
					output_cost_per_token: 0.0000006,
					cache_read_input_token_cost: 0.000000003,
				},
				sources: {
					input_cost_per_token: "config",
					output_cost_per_token: "config",
					cache_read_input_token_cost: "config",
				},
				peak: { tier: "peak", multiplier: 2 },
			},
		},
	},
};

async function openLogs(page: Page, data: Array<typeof log> = [log]): Promise<void> {
	await page.route("**/spend/logs/ui**", (route) =>
		route.fulfill({ json: { data: data, total: data.length, page: 1, page_size: 25, total_pages: 1, session_total_count: 0 } }),
	);
	await page.route("**/config/list**", (route) => route.fulfill({ json: [] }));
	await page.route("**/key/list**", (route) => route.fulfill({ json: { keys: [], total_count: 0 } }));
	await page.route("**/v2/team/list**", (route) => route.fulfill({ json: { teams: [] } }));
	await page.goto("/ui/tests/logs/logs.html");
	await expect(page.locator(".logs-time-button")).toHaveText(/All Time/);
}

test("cost popover shows the applied unit prices and the frozen peak tier with an icon", async ({ page }) => {
	await openLogs(page);
	await page.locator("tbody tr").filter({ hasText: "log-cost-price" }).locator(".logs-cost-value").hover();

	const popover = page.locator(".ui-popover.logs-cost-popover-shell");
	await expect(popover).toBeVisible();
	await expect(popover.getByText("本次单价", { exact: true })).toBeVisible();

	const prices = popover.locator(".logs-cost-prices__value");
	await expect(prices.nth(0)).toHaveText("$0.300/1M");
	await expect(prices.nth(1)).toHaveText("$1.20/1M");
	await expect(prices.nth(2)).toHaveText("$0.0060/1M");
	await expect(popover.locator(".logs-cost-prices__base").first()).toHaveText("基础价 $0.150 ×2");

	const tier = popover.locator(".logs-price-tier");
	await expect(tier).toHaveClass(/is-peak/);
	await expect(tier).toHaveAttribute("data-icon", "Sun");
	await expect(tier).toContainText("峰时");
	await expect(tier).toContainText("×2");
	await expect(tier.locator("svg")).toBeVisible();
});

test("off-peak pricing shows the base price and the moon tier without a multiplier", async ({ page }) => {
	const snapshot = log.metadata.cost_breakdown.price_snapshot;
	const offPeak = {
		...log,
		request_id: "log-cost-off-peak",
		metadata: {
			...log.metadata,
			cost_breakdown: {
				...log.metadata.cost_breakdown,
				price_snapshot: { ...snapshot, peak: { tier: "off_peak", multiplier: 1 } },
			},
		},
	};
	await openLogs(page, [offPeak]);
	await page.locator("tbody tr").filter({ hasText: "log-cost-off-peak" }).locator(".logs-cost-value").hover();

	const popover = page.locator(".ui-popover.logs-cost-popover-shell");
	await expect(popover.locator(".logs-cost-prices__value").nth(0)).toHaveText("$0.150/1M");
	await expect(popover.locator(".logs-cost-prices__base")).toHaveCount(0);
	const tier = popover.locator(".logs-price-tier");
	await expect(tier).toHaveClass(/is-off_peak/);
	await expect(tier).toHaveAttribute("data-icon", "Moon");
	await expect(tier).toContainText("谷时");
	await expect(tier).not.toContainText("×");
});
