import { expect, test } from "@playwright/test";

const startTime = "2026-11-15T02:00:00.000Z";
const endTime = "2026-11-15T02:00:01.500Z";
const settled = {
	request_id: "dup-1",
	startTime,
	endTime,
	call_type: "acompletion",
	model: "openai/gpt-fixture",
	spend: 0.002,
	prompt_tokens: 100,
	completion_tokens: 20,
	total_tokens: 120,
	status: "success",
	request_duration_ms: 1_500,
	metadata: { status: "success" },
};
// 结算提交落在两路分页键查询之间时，同一请求会同时以在途与已结算两种投影出现在一页里。
const inProgress = {
	...settled,
	endTime: null,
	spend: 0,
	prompt_tokens: 0,
	completion_tokens: 0,
	total_tokens: 0,
	status: "in_progress",
	request_duration_ms: 0,
	metadata: { status: "in_progress" },
};
const other = {
	...settled,
	request_id: "plain-2",
	startTime: "2026-11-15T01:59:00.000Z",
	endTime: "2026-11-15T01:59:01.000Z",
};
const rows = [inProgress, settled, other];

test.beforeEach(async ({ page }) => {
	await page.route("**/spend/logs/ui**", (route) =>
		route.fulfill({
			json: {
				data: rows,
				total: rows.length,
				page: 1,
				page_size: 1_000,
				total_pages: 1,
				session_total_count: rows.length,
			},
		}),
	);
	await page.route("**/config/list**", (route) => route.fulfill({ json: [] }));
	await page.route("**/key/list**", (route) => route.fulfill({ json: { keys: [], total_count: 0 } }));
	await page.route("**/v2/team/list**", (route) => route.fulfill({ json: { teams: [] } }));
});

test("renders one row per request even when a page reports the same request twice", async ({ page }) => {
	await page.goto("/ui/tests/logs/logs.html?logs_page_size=1000");
	const dataRows = page.locator("tbody tr.ui-table__row");
	await expect(dataRows.first()).toBeVisible();

	// 两行同 request_id 会让虚拟表格的 keyed diff 复用错位，用户看到的就是「多行内容完全一样」。
	await expect(dataRows).toHaveCount(2);
	await expect(dataRows.filter({ hasText: "dup-1" })).toHaveCount(1);
	await expect(dataRows.filter({ hasText: "plain-2" })).toHaveCount(1);
});
