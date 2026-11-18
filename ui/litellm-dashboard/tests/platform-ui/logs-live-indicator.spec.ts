import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";

const log = {
	request_id: "log-live-dot",
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

async function openLogs(page: Page): Promise<void> {
	await page.route("**/spend/logs/ui**", (route) =>
		route.fulfill({ json: { data: [log], total: 1, page: 1, page_size: 25, total_pages: 1, session_total_count: 0 } }),
	);
	await page.route("**/config/list**", (route) => route.fulfill({ json: [] }));
	await page.route("**/key/list**", (route) => route.fulfill({ json: { keys: [], total_count: 0 } }));
	await page.route("**/v2/team/list**", (route) => route.fulfill({ json: { teams: [] } }));
	await page.goto("/ui/tests/logs/logs.html");
	await expect(page.locator(".logs-time-button")).toHaveText(/All Time/);
}

test("Live Tail 指示灯跟随实时通道：关闭时不显示，在线与重连中给出不同的可访问名字", async ({ page }) => {
	let socket: WebSocketRoute | undefined;
	await page.routeWebSocket(/spend\/logs\/ui\/live/, (route) => {
		socket = route;
		route.onMessage(() => undefined);
	});
	await openLogs(page);

	const dot = page.locator(".logs-live-dot");
	await expect(dot).toHaveCount(0);

	await page.getByRole("switch", { name: "Live Tail" }).click();
	await expect(dot).toHaveAttribute("aria-label", "Live tail connected");

	// 服务端断开后进入指数退避重连：这一秒内页面只有轮询在刷新，指示灯要如实说明。
	await socket?.close();
	await expect(dot).toHaveAttribute("aria-label", "Live tail reconnecting");

	await page.getByRole("switch", { name: "Live Tail" }).click();
	await expect(dot).toHaveCount(0);
});
