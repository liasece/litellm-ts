import { expect, test } from "@playwright/test";
import { group, timeline } from "../log-details/Fixtures";

const sessionLog = {
	request_id: "log-session",
	startTime: "2026-11-07T02:00:00Z",
	endTime: "2026-11-07T02:00:02Z",
	call_type: "acompletion",
	model: "openai/gpt-fixture",
	spend: 0.003,
	prompt_tokens: 100,
	completion_tokens: 40,
	total_tokens: 140,
	request_duration_ms: 2000,
	status: "success",
	session_group_type: group.type,
	session_group_id: group.id,
	session_total_count: 1,
	metadata: { status: "success" },
};

test.beforeEach(async ({ page }) => {
	await page.route("**/spend/logs/ui**", (route) =>
		route.fulfill({ json: { data: [sessionLog], total: 1, page: 1, page_size: 25, total_pages: 1, session_total_count: 1 } }),
	);
	await page.route("**/config/list**", (route) => route.fulfill({ json: [] }));
	await page.route("**/key/list**", (route) => route.fulfill({ json: { keys: [], total_count: 0 } }));
	await page.route("**/v2/team/list**", (route) => route.fulfill({ json: { teams: [] } }));
	await page.route("**/spend/logs/session/timeline?**", (route) => route.fulfill({ json: timeline }));
	await page.routeWebSocket(/spend\/logs\/session\/timeline\/stream/, (socket) => {
		socket.send(JSON.stringify({ type: "snapshot", group, data: timeline }));
	});
	await page.goto("/ui/tests/logs/logs.html");
});

test("session cell opens the session simulation timeline", async ({ page }) => {
	await expect(page.getByRole("link", { name: group.id, exact: true })).toBeVisible();
	await page.getByRole("link", { name: group.id, exact: true }).click();
	const drawer = page.getByRole("dialog", { name: /Session 模拟/ });
	await expect(drawer).toBeVisible();
	await expect(drawer.getByRole("heading", { name: new RegExp(group.id) })).toBeVisible();
	await expect(drawer.getByText("Final answer", { exact: true })).toBeVisible();
});
