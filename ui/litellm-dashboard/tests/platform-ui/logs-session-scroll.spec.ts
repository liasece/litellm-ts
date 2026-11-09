import { expect, test, type Locator, type Page, type WebSocketRoute } from "@playwright/test";
import { group } from "../log-details/Fixtures";

const sessionLog = {
	request_id: "log-window",
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

const filler = "为了让时间线超过一屏，每条事件都带一段占位正文。";
const textEvent = (id: string, text: string) => ({
	id,
	request_id: "log-window",
	role: "assistant" as const,
	label: "助手",
	timestamp: "2026-11-07T02:00:00Z",
	model: "fixture",
	content: text,
	parts: [{ kind: "text" as const, label: "Text", text }],
});

const history = Array.from({ length: 36 }, (_, index) => textEvent(`evt-${index}`, `历史事件 ${index}：${filler.repeat(4)}`));
const summary = {
	keys: [{ alias: "Fixture Key", hash: "fixture-key-hash" }],
	request_count: history.length,
	event_count: history.length,
	total_spend: 0.003,
	total_tokens: 140,
	duration_seconds: 2,
	start_time: "2026-11-07T02:00:00Z",
	end_time: "2026-11-07T02:00:02Z",
};
const timeline = {
	data: history,
	summary,
	active_requests: [],
	window: { returned_requests: history.length, total_requests: history.length, has_more: false, before: null, limit: 50 },
};

let liveSocket: WebSocketRoute | null = null;

/** 模拟服务端推送：新事件追加在时间线末尾，最新优先排列下会出现在列表顶端。 */
function pushEvents(events: Array<ReturnType<typeof textEvent>>, removed: string[] = []) {
	if (!liveSocket) throw new Error("Session 时间线长连接尚未建立");
	liveSocket.send(
		JSON.stringify({
			type: "update",
			group,
			data: {
				upsert: events,
				summary: { ...summary, event_count: summary.event_count + events.length },
				active_requests: [],
				removed,
			},
		}),
	);
}

/** 视野内最靠上的条目 id；滚动位置的参照点。 */
function firstVisibleEventId(body: Locator) {
	return body.evaluate((element) => {
		const containerTop = element.getBoundingClientRect().top;
		for (const node of element.querySelectorAll<HTMLElement>("[data-event-id]"))
			if (node.getBoundingClientRect().bottom > containerTop) return node.dataset.eventId ?? null;
		return null;
	});
}

function eventTop(body: Locator, id: string) {
	return body.locator(`[data-event-id="${id}"]`).evaluate((element) => element.getBoundingClientRect().top);
}

function scrollTop(body: Locator) {
	return body.evaluate((element) => element.scrollTop);
}

async function openDrawer(page: Page) {
	await page.getByRole("link", { name: group.id, exact: true }).click();
	const drawer = page.getByRole("dialog", { name: /Session 模拟/ });
	await expect(drawer.locator('[data-event-id="evt-35"]')).toBeVisible();
	return drawer;
}

test.beforeEach(async ({ page }) => {
	liveSocket = null;
	await page.route("**/spend/logs/ui**", (route) =>
		route.fulfill({ json: { data: [sessionLog], total: 1, page: 1, page_size: 25, total_pages: 1, session_total_count: 1 } }),
	);
	await page.route("**/config/list**", (route) => route.fulfill({ json: [] }));
	await page.route("**/key/list**", (route) => route.fulfill({ json: { keys: [], total_count: 0 } }));
	await page.route("**/v2/team/list**", (route) => route.fulfill({ json: { teams: [] } }));
	await page.route("**/spend/logs/session/timeline?**", (route) => route.fulfill({ json: timeline }));
	await page.routeWebSocket(/spend\/logs\/session\/timeline\/stream/, (socket) => {
		liveSocket = socket;
		socket.send(JSON.stringify({ type: "snapshot", group, data: timeline }));
	});
	await page.goto("/ui/tests/logs/logs.html");
});

test("最新优先时新事件插在视野上方也不会移动读者正在看的位置", async ({ page }) => {
	const drawer = await openDrawer(page);
	const body = drawer.locator(".ui-drawer__body");
	await body.evaluate((element) => {
		element.scrollTop = 640;
	});
	const reference = await firstVisibleEventId(body);
	expect(reference).not.toBeNull();
	const topBefore = await eventTop(body, reference as string);
	const scrollBefore = await scrollTop(body);
	pushEvents([textEvent("live-1", "新事件 1"), textEvent("live-2", "新事件 2"), textEvent("live-3", "新事件 3")]);
	await expect(drawer.locator('[data-event-id="live-3"]')).toBeAttached();
	const containerTop = await body.evaluate((element) => element.getBoundingClientRect().top);
	expect(await eventTop(body, "live-3")).toBeLessThan(containerTop);
	expect(Math.abs((await eventTop(body, reference as string)) - topBefore)).toBeLessThanOrEqual(1);
	expect(await scrollTop(body)).toBeGreaterThan(scrollBefore);
});

test("最新优先且停在顶端时，新事件直接出现在视野里", async ({ page }) => {
	const drawer = await openDrawer(page);
	const body = drawer.locator(".ui-drawer__body");
	expect(await scrollTop(body)).toBe(0);
	pushEvents([textEvent("live-top", "顶端新事件")]);
	await expect(drawer.locator('[data-event-id="live-top"]')).toBeVisible();
	expect(await scrollTop(body)).toBe(0);
});

test("切换排序时按新顺序从头看，不额外改变滚动位置", async ({ page }) => {
	const drawer = await openDrawer(page);
	const body = drawer.locator(".ui-drawer__body");
	await body.evaluate((element) => {
		element.scrollTop = 640;
	});
	await drawer.getByRole("button", { name: "最新优先", exact: true }).click();
	await expect(drawer.getByRole("button", { name: "最早优先", exact: true })).toBeVisible();
	expect(await scrollTop(body)).toBe(640);
});

test("视野顶部的条目被实时更新换掉时，改用视野中部的条目守住位置", async ({ page }) => {
	const drawer = await openDrawer(page);
	const body = drawer.locator(".ui-drawer__body");
	await body.evaluate((element) => {
		element.scrollTop = 640;
	});
	const picked = await body.evaluate((element) => {
		const bounds = element.getBoundingClientRect();
		const visible = [...element.querySelectorAll<HTMLElement>("[data-event-id]")].filter((node) => {
			const rect = node.getBoundingClientRect();
			return rect.bottom > bounds.top && rect.top < bounds.bottom;
		});
		const offset = (node: HTMLElement | undefined) => (node ? Math.round(node.getBoundingClientRect().top - bounds.top) : null);
		return {
			first: visible[0]?.dataset.eventId ?? null,
			middle: visible[Math.floor(visible.length / 2)]?.dataset.eventId ?? null,
			middleOffset: offset(visible[Math.floor(visible.length / 2)]),
		};
	});
	expect(picked.first).not.toBeNull();
	expect(picked.middle).not.toBeNull();
	expect(picked.middle).not.toBe(picked.first);
	pushEvents([textEvent("live-a", "新事件 A"), textEvent("live-b", "新事件 B")], [picked.first as string]);
	await expect(body.locator(`[data-event-id="${picked.first as string}"]`)).toHaveCount(0);
	await expect(drawer.locator('[data-event-id="live-b"]')).toBeAttached();
	const middleOffset = await body
		.locator(`[data-event-id="${picked.middle as string}"]`)
		.evaluate((element) =>
			Math.round(element.getBoundingClientRect().top - (element.closest(".ui-drawer__body") || element).getBoundingClientRect().top),
		);
	expect(Math.abs(middleOffset - (picked.middleOffset as number))).toBeLessThanOrEqual(1);
});
