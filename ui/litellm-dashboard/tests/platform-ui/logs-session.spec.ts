import { expect, test } from "@playwright/test";
import { first, group, second, timeline } from "../log-details/Fixtures";

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

test("a selected log in the URL restores the detail drawer and is cleared on close", async ({ page }) => {
	await page.goto("/ui/tests/logs/logs.html?log=log-session");
	const drawer = page.getByRole("dialog", { name: "Log details", exact: true });
	await expect(drawer).toBeVisible();
	await expect(page).toHaveURL(/[?&]log=log-session/);

	await drawer.getByRole("button", { name: "Close log details", exact: true }).click();
	await expect(page).not.toHaveURL(/[?&]log=/);
});

test("a deep link restores a log that is outside the current list page", async ({ page }) => {
	const offPageLog = { ...sessionLog, request_id: "log-offpage" };
	await page.route("**/spend/logs/ui**", (route) => {
		const requestId = new URL(route.request().url()).searchParams.get("request_id");
		const data = requestId === offPageLog.request_id ? [offPageLog] : [sessionLog];
		return route.fulfill({ json: { data, total: data.length, page: 1, page_size: 25, total_pages: 1, session_total_count: 1 } });
	});

	await page.goto("/ui/tests/logs/logs.html?log=log-offpage");
	const drawer = page.getByRole("dialog", { name: "Log details", exact: true });
	await expect(drawer).toBeVisible();
	await expect(page.locator(".ld-header__request-id")).toContainText("log-offpage");
});

test("J/K navigation uses list rows refreshed while the drawer is open", async ({ page }) => {
	const third = { ...second, request_id: "log-three", model: "openai/gpt-third" };
	let data = [first, second];
	await page.route("**/spend/logs/ui**", (route) => {
		const path = new URL(route.request().url()).pathname;
		if (path === "/spend/logs/ui") return route.fulfill({ json: { data, total: data.length, page: 1, page_size: 25, total_pages: 1 } });
		const row = data.find((log) => path.endsWith(`/${log.request_id}`));
		return route.fulfill({ json: row ?? first });
	});
	await page.goto("/ui/tests/logs/logs.html?log=log-one");
	const drawer = page.getByRole("dialog", { name: "Log details", exact: true });
	await expect(drawer).toBeVisible();
	data = [...data, third];
	await drawer.getByRole("button", { name: "Refresh log details", exact: true }).click();
	await expect(page.locator("tbody tr.ui-table__row")).toHaveCount(3);
	await page.keyboard.press("j");
	await page.keyboard.press("j");
	await expect(page.locator(".ld-header__request-id")).toContainText("log-three");
});

test("session J/K navigation includes requests added to the latest list", async ({ page }) => {
	const newer = {
		...sessionLog,
		request_id: "log-session-newer",
		model: "openai/gpt-newer",
		startTime: "2026-11-07T02:01:00Z",
		endTime: "2026-11-07T02:01:02Z",
	};
	let data = [sessionLog];
	const sessionData = [sessionLog];
	await page.route("**/spend/logs/ui**", (route) => {
		const path = new URL(route.request().url()).pathname;
		if (path === "/spend/logs/ui") return route.fulfill({ json: { data, total: data.length, page: 1, page_size: 25, total_pages: 1 } });
		return route.fulfill({ json: data.find((log) => path.endsWith(`/${log.request_id}`)) ?? sessionLog });
	});
	await page.route("**/spend/logs/session/ui**", (route) =>
		route.fulfill({ json: { data: sessionData, total: sessionData.length, total_pages: 1 } }),
	);
	await page.goto("/ui/tests/logs/logs.html?log=log-session");
	const drawer = page.getByRole("dialog", { name: "Log details", exact: true });
	await expect(drawer).toBeVisible();
	await expect(drawer.locator(".ld-sidebar__stats")).toContainText("1 req");
	data = [newer, sessionLog];
	await drawer.getByRole("button", { name: "Refresh log details", exact: true }).click();
	await expect(page.locator("tbody tr.ui-table__row")).toHaveCount(2);
	await page.keyboard.press("k");
	await expect(page.locator(".ld-header__request-id")).toContainText("log-session-newer");
});

test("opening a log row writes its request ID to the URL", async ({ page }) => {
	await page.locator("tbody tr").filter({ hasText: "log-session" }).first().click();
	await expect(page).toHaveURL(/[?&]log=log-session/);
});

test("session cell opens the session simulation timeline", async ({ page }) => {
	await expect(page.getByRole("link", { name: group.id, exact: true })).toBeVisible();
	await page.getByRole("link", { name: group.id, exact: true }).click();
	const drawer = page.getByRole("dialog", { name: /Session 模拟/ });
	await expect(drawer).toBeVisible();
	await expect(drawer.getByRole("heading", { name: new RegExp(group.id) })).toBeVisible();
	await expect(drawer.getByText("Final answer", { exact: true })).toBeVisible();
});
