import { expect, test, type Locator, type Route } from "@playwright/test";
import { group } from "../log-details/Fixtures";

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

const summary = {
	keys: [{ alias: "Fixture Key", hash: "fixture-key-hash" }],
	request_count: 120,
	event_count: 60,
	total_spend: 0.003,
	total_tokens: 140,
	duration_seconds: 2,
	start_time: "2026-11-07T02:00:00Z",
	end_time: "2026-11-07T02:00:02Z",
};

/** A text event; the timeline renders `parts` for assistant messages. */
const textEvent = (id: string, requestId: string, text: string) => ({
	id,
	request_id: requestId,
	role: "assistant" as const,
	label: "助手",
	timestamp: "2026-11-07T02:00:00Z",
	model: "fixture",
	content: text,
	parts: [{ kind: "text" as const, label: "Text", text }],
});

const windowed = {
	data: Array.from({ length: 60 }, (_, index) => textEvent(`window-${index}`, "log-window", `windowed event ${index}`)),
	summary,
	active_requests: [],
	window: { returned_requests: 50, total_requests: 120, has_more: true, before: "earlier-page", limit: 50 },
};

const earlier = {
	data: [textEvent("earlier-1", "log-earlier", "earlier page event")],
	summary: { ...summary, event_count: 1 },
	active_requests: [],
	window: { returned_requests: 50, total_requests: 120, has_more: false, before: null, limit: 50 },
};

test.beforeEach(async ({ page }) => {
	await page.route("**/spend/logs/ui**", (route) =>
		route.fulfill({ json: { data: [sessionLog], total: 1, page: 1, page_size: 25, total_pages: 1, session_total_count: 1 } }),
	);
	await page.route("**/config/list**", (route) => route.fulfill({ json: [] }));
	await page.route("**/key/list**", (route) => route.fulfill({ json: { keys: [], total_count: 0 } }));
	await page.route("**/v2/team/list**", (route) => route.fulfill({ json: { teams: [] } }));
	await page.route("**/spend/logs/session/timeline?**", (route) => {
		const before = new URL(route.request().url()).searchParams.get("before");
		return route.fulfill({ json: before === "earlier-page" ? earlier : windowed });
	});
	await page.routeWebSocket(/spend\/logs\/session\/timeline\/stream/, (socket) => {
		socket.send(JSON.stringify({ type: "snapshot", group, data: windowed }));
	});
	await page.goto("/ui/tests/logs/logs.html");
});

test("scrolling to the older end of the session timeline loads the earlier page", async ({ page }) => {
	await page.getByRole("link", { name: group.id, exact: true }).click();
	const drawer = page.getByRole("dialog", { name: /Session 模拟/ });
	await expect(drawer).toBeVisible();
	await expect(drawer.getByText("windowed event 59", { exact: true })).toBeVisible();
	const olderPage = page.waitForRequest((request) => new URL(request.url()).searchParams.get("before") === "earlier-page", {
		timeout: 10_000,
	});
	await drawer.locator(".ui-drawer__body").evaluate((element) => {
		element.scrollTop = element.scrollHeight;
	});
	await olderPage;
	await expect(drawer.getByText("earlier page event", { exact: true })).toBeAttached();
});

/** 视野内最靠上的条目 id，用来核对补页后阅读位置是否被顶走。 */
function firstVisibleEventId(body: Locator) {
	return body.evaluate((element) => {
		const containerTop = element.getBoundingClientRect().top;
		for (const node of element.querySelectorAll<HTMLElement>("[data-event-id]"))
			if (node.getBoundingClientRect().bottom > containerTop) return node.dataset.eventId ?? null;
		return null;
	});
}

test("最早优先排列下补进更早的一页时保持读者正在看的位置", async ({ page }) => {
	let held: Route | null = null;
	await page.route("**/spend/logs/session/timeline?**", async (route) => {
		if (new URL(route.request().url()).searchParams.get("before") === "earlier-page") {
			held = route;
			return;
		}
		await route.fulfill({ json: windowed });
	});
	await page.getByRole("link", { name: group.id, exact: true }).click();
	const drawer = page.getByRole("dialog", { name: /Session 模拟/ });
	const body = drawer.locator(".ui-drawer__body");
	await expect(drawer.getByText("windowed event 59", { exact: true })).toBeVisible();
	await drawer.getByRole("button", { name: "最新优先", exact: true }).click();
	await expect(drawer.getByRole("button", { name: "最早优先", exact: true })).toBeVisible();
	await body.evaluate((element) => {
		element.scrollTop = 120;
		element.scrollTop = 0;
	});
	await expect.poll(() => held !== null, { timeout: 10_000 }).toBe(true);
	const reference = await firstVisibleEventId(body);
	expect(reference).not.toBeNull();
	const anchor = body.locator(`[data-event-id="${reference as string}"]`);
	const topBefore = await anchor.evaluate((element) => element.getBoundingClientRect().top);
	const pending = held as Route | null;
	if (!pending) throw new Error("更早一页的请求没有发出");
	await pending.fulfill({ json: earlier });
	await expect(drawer.getByText("earlier page event", { exact: true })).toBeAttached();
	expect(Math.abs((await anchor.evaluate((element) => element.getBoundingClientRect().top)) - topBefore)).toBeLessThanOrEqual(1);
	expect(await body.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
});
