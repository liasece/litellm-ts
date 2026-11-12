import { expect, test, type Page } from "@playwright/test";

const log = {
	request_id: "log-time-range",
	startTime: "2026-11-09T08:00:00Z",
	endTime: "2026-11-09T08:00:02Z",
	call_type: "acompletion",
	model: "openai/gpt-fixture",
	spend: 0.001,
	prompt_tokens: 10,
	completion_tokens: 5,
	total_tokens: 15,
	request_duration_ms: 900,
	status: "success",
	metadata: { status: "success" },
};

/** 记录列表请求的 URL，用来核对时间范围是否真的下发给服务端。 */
type ListRequests = URL[];

async function openLogs(page: Page, requests: ListRequests = []): Promise<void> {
	await page.route("**/spend/logs/ui**", (route) => {
		requests.push(new URL(route.request().url()));
		return route.fulfill({ json: { data: [log], total: 1, page: 1, page_size: 25, total_pages: 1, session_total_count: 0 } });
	});
	await page.route("**/config/list**", (route) => route.fulfill({ json: [] }));
	await page.route("**/key/list**", (route) => route.fulfill({ json: { keys: [], total_count: 0 } }));
	await page.route("**/v2/team/list**", (route) => route.fulfill({ json: { teams: [] } }));
	await page.goto("/ui/tests/logs/logs.html");
	await expect(page.locator(".logs-time-button")).toHaveText(/All Time/);
}

test("默认时间范围是 All Time：列表请求不带 start_date", async ({ page }) => {
	const requests: ListRequests = [];
	await openLogs(page, requests);

	await expect.poll(() => requests.length).toBeGreaterThan(0);
	expect(requests[0].searchParams.has("start_date")).toBe(false);
	expect(requests[0].searchParams.has("end_date")).toBe(false);
});

test("选择预设区间后按该区间请求，切回 All Time 又不再带时间参数", async ({ page }) => {
	const requests: ListRequests = [];
	await openLogs(page, requests);
	const trigger = page.locator(".logs-time-button");

	await trigger.click();
	await page.getByRole("button", { name: "Last 24 Hours", exact: true }).click();
	await expect(trigger).toHaveText(/Last 24 Hours/);
	await expect.poll(() => requests.at(-1)?.searchParams.has("start_date") ?? false).toBe(true);

	await trigger.click();
	await page.getByRole("button", { name: "All Time", exact: true }).click();
	await expect(trigger).toHaveText(/All Time/);
	await expect.poll(() => requests.at(-1)?.searchParams.has("start_date") ?? true).toBe(false);
});

test("picking an interval closes the menu, updates the trigger and reopens", async ({ page }) => {
	await openLogs(page);
	// 选中后按钮文字会变，触发器按稳定类名定位。
	const trigger = page.locator(".logs-time-button");
	await trigger.click();
	await page.getByRole("button", { name: "Last 4 Hours", exact: true }).click();
	await expect(page.locator(".logs-time-menu")).toHaveCount(0);
	await expect(trigger).toHaveAttribute("aria-expanded", "false");
	await expect(trigger).toHaveText(/Last 4 Hours/);
	await trigger.click();
	await expect(page.locator(".logs-time-menu")).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page.locator(".logs-time-menu")).toHaveCount(0);
});
