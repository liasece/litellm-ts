import { expect, test, type Locator } from "@playwright/test";

const resetsAt = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
const laterResetsAt = new Date(Date.now() + 26 * 60 * 60 * 1000).toISOString();

function window(id: string, label: string, remaining: number | null, reset: string | null) {
	return { id, label, remaining_percent: remaining, resets_at: reset };
}

/** 三类真实形态：只有一档的 Codex、三档的命令行账号（5 小时/周/月）、四档且名称更长的内额度账号。 */
const accounts = [
	{ auth_index: "a0", key: "key-zero", provider: "codex", email: "zero@example.test" },
	{ auth_index: "a1", key: "key-one", provider: "commandcode", email: "one@example.test" },
	{ auth_index: "a2", key: "key-two", provider: "commandcode", email: "two@example.test" },
];
const quotas: Record<string, unknown> = {
	a0: {
		provider: "codex",
		plan: "Pro",
		subscription_expires_at: null,
		email: "zero@example.test",
		fetched_at: resetsAt,
		balances: [],
		windows: [window("d7", "Codex · 7 天", 64, laterResetsAt)],
	},
	a1: {
		provider: "commandcode",
		plan: "Pro",
		subscription_expires_at: null,
		email: "one@example.test",
		fetched_at: resetsAt,
		balances: [],
		windows: [window("5h", "5 小时", 93, resetsAt), window("w", "周", 52, laterResetsAt), window("m", "月", 26, laterResetsAt)],
	},
	a2: {
		provider: "commandcode",
		plan: "Pro",
		subscription_expires_at: null,
		email: "two@example.test",
		fetched_at: resetsAt,
		balances: [],
		// 月这一档没有重置时间：这一排的条仍要和其他档齐平。
		windows: [window("5h", "5 小时", 100, resetsAt), window("w", "周", 0, laterResetsAt), window("m", "月", 50, null)],
	},
};
const builtIn = [
	{
		id: "minimax-a",
		provider: "minimax",
		label: "MiniMax key",
		models: ["minimax/abab"],
		account_kind: "pay_as_you_go",
		plan: null,
		subscription_expires_at: null,
		fetched_at: resetsAt,
		balances: [],
		windows: [
			window("g5h", "MiniMax · 5-hour", 99, resetsAt),
			window("g5d", "MiniMax · 7-day", 73, laterResetsAt),
			window("v5h", "Video · 5-hour", 100, resetsAt),
			window("v5d", "Video · 7-day", 100, laterResetsAt),
		],
	},
];

test.beforeEach(async ({ page }) => {
	await page.route("**/subscriptions/accounts", (route) => route.fulfill({ json: { data: accounts } }));
	await page.route("**/subscriptions/accounts/*/quota", (route) => {
		const id = new URL(route.request().url()).pathname.split("/").at(-2) ?? "";
		return route.fulfill({ json: quotas[id] ?? quotas["a1"] });
	});
	await page.route("**/provider/quota*", (route) => route.fulfill({ json: { data: builtIn } }));
	await page.goto("/ui/tests/usage/quota-windows.html");
});

/** 各维度块把本列内容区铺满：最左到最右的跨度等于列的内容宽度，右侧不留空白。 */
async function fillRatio(group: Locator): Promise<number> {
	return group.evaluate((node) => {
		const cell = node.parentElement as HTMLElement;
		const style = getComputedStyle(cell);
		const content = cell.getBoundingClientRect().width - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight);
		const blocks = [...node.children].map((child) => child.getBoundingClientRect());
		const span = Math.max(...blocks.map((box) => box.right)) - Math.min(...blocks.map((box) => box.left));
		return span / content;
	});
}

test("各维度横向单行排开，重置时间在维度名下方，条等长且铺满本列", async ({ page }) => {
	const groups = page.locator(".usage-quota-windows");
	// 按上游分组：Codex 一档、两个三档账号、四档内置额度。
	await expect(groups).toHaveCount(4);
	const counts = await groups.evaluateAll((nodes) => nodes.map((node) => node.children.length));
	expect(counts).toEqual([1, 3, 3, 4]);

	for (const index of [0, 1, 2, 3]) {
		const group = groups.nth(index);
		const blocks = group.locator(".usage-quota-window");
		const boxes = await blocks.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().toJSON()));
		// 同一排：各维度顶边一致。
		for (const box of boxes) expect(Math.abs(box.top - boxes[0].top)).toBeLessThanOrEqual(1);
		// 块宽一致，条因此等长，跨账号才好横向对齐比较。
		for (const box of boxes) expect(Math.abs(box.width - boxes[0].width)).toBeLessThanOrEqual(1);

		// 有的档有重置时间、有的没有，条的起点也必须相同：空的重置行占满 16px，不能把条挤下去。
		const trackTops = await group
			.locator(".usage-quota-window-track")
			.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().top));
		for (const top of trackTops) expect(Math.abs(top - trackTops[0])).toBeLessThanOrEqual(1);

		const first = blocks.first();
		const label = await first.locator(".usage-quota-window-label").boundingBox();
		const reset = await first.locator(".usage-quota-window-reset").boundingBox();
		const track = await first.locator(".usage-quota-window-track").boundingBox();
		expect(label?.height).toBeGreaterThan(0);
		expect(reset!.y).toBeGreaterThanOrEqual(label!.y + label!.height - 1);
		expect(track!.y).toBeGreaterThanOrEqual(reset!.y + reset!.height - 1);

		// 各维度整体留在本列内，不会压到相邻的余额列上。
		const bounds = await group.evaluate((node) => {
			const cell = node.parentElement as HTMLElement;
			return {
				right: Math.max(...[...node.children].map((child) => child.getBoundingClientRect().right)),
				cellRight: cell.getBoundingClientRect().right,
			};
		});
		expect(bounds.right).toBeLessThanOrEqual(bounds.cellRight);
	}

	// 三档行把本列内容宽度铺满，右侧不留空白死区。
	for (const index of [1, 2]) expect(await fillRatio(groups.nth(index))).toBeGreaterThan(0.95);
	// 只有一档的账号不独占整列：条宽与三档行一致，满格才是同一个尺子。
	const single = await groups.nth(0).locator(".usage-quota-window").first().boundingBox();
	const triple = await groups.nth(1).locator(".usage-quota-window").first().boundingBox();
	expect(Math.abs((single?.width ?? 0) - (triple?.width ?? 0))).toBeLessThanOrEqual(1);
	// 四档被本列宽度均分，条比三档行短。
	const quad = await groups.nth(3).locator(".usage-quota-window").first().boundingBox();
	expect(quad!.width).toBeLessThan(triple!.width);

	// 条内只放数字百分比，短条也放得下。
	await expect(groups.nth(1).locator(".usage-quota-window-value")).toHaveText(["93%", "52%", "26%"]);

	// 窗口变宽时，多出来的宽度给到 Quota windows 列，条跟着变长（不是固定百分比切列）。
	const before = await groups.nth(1).locator(".usage-quota-window-track").first().boundingBox();
	await page.setViewportSize({ width: 1920, height: 900 });
	await expect
		.poll(async () => (await groups.nth(1).locator(".usage-quota-window-track").first().boundingBox())!.width)
		.toBeGreaterThan((before?.width ?? 0) + 40);
	for (const index of [1, 2]) expect(await fillRatio(groups.nth(index))).toBeGreaterThan(0.95);
});
