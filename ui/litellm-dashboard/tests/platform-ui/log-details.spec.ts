import { expect, test } from "@playwright/test";
import { first, second, group, timeline, event } from "../log-details/Fixtures";
test.beforeEach(async ({ page }) => {
	await page.route("**/spend/logs/**", async (route) => {
		const url = new URL(route.request().url());
		let payload: unknown;
		if (url.pathname.endsWith("/session/timeline"))
			payload = url.searchParams.has("before")
				? {
						...timeline,
						data: [event("earlier", "user", "Earlier prompt")],
						window: { ...timeline.window, has_more: false, before: null },
					}
				: timeline;
		else if (url.pathname.endsWith("/session/ui"))
			payload = {
				data: url.searchParams.get("page") === "2" ? [second] : [first],
				total: 2,
				page: url.searchParams.get("page") === "2" ? 2 : 1,
				page_size: 1,
				total_pages: 2,
			};
		else payload = url.pathname.endsWith("/log-two") ? second : first;
		await route.fulfill({ json: payload });
	});
	await page.route("**/compliance/**", (route) =>
		route.fulfill({
			json: {
				compliant: true,
				regulation: "fixture",
				checks: [{ check_name: "Fixture check", article: "Article 1", passed: true, detail: "Fixture compliance evidence" }],
			},
		}),
	);
	await page.routeWebSocket(/spend\/logs\/.*stream/, (socket) => {
		if (socket.url().includes("/session/timeline/")) socket.send(JSON.stringify({ type: "snapshot", group, data: timeline }));
	});
	await page.goto("/ui/tests/log-details/details.html");
});
test("Pretty, JSON, upstream and actual Diff remain navigable", async ({ page }) => {
	await page.getByRole("button", { name: "Open request", exact: true }).click();
	const drawer = page.getByRole("dialog", { name: "Log details", exact: true });
	await expect(drawer).toBeVisible();
	await expect(drawer.getByText("Current request", { exact: true })).toBeVisible();
	await drawer.getByRole("button", { name: "TOOLS (1)", exact: true }).click();
	await drawer.getByRole("button", { name: /1\. lookup/ }).click();
	await expect(drawer.getByText("Look up a fixture")).toBeVisible();
	await drawer.getByRole("button", { name: "JSON", exact: true }).click();
	await expect(drawer.getByRole("tree", { name: "JSON view" })).toBeVisible();
	await drawer.getByRole("tab", { name: "Upstream", exact: true }).click();
	await expect(drawer.getByText("https://example.test/v1/responses", { exact: false }).first()).toBeVisible();
	await drawer.getByRole("tab", { name: "Diff", exact: true }).click();
	await expect(drawer.getByTestId("upstream-downstream-diff")).toBeVisible();
	await expect(drawer.locator('[data-diff-kind="change"]').first()).toBeVisible();
});
test("detail panels reveal routing, costs, provider guardrail results and vector content", async ({ page }) => {
	await page.getByRole("button", { name: "Open request", exact: true }).click();
	const drawer = page.getByRole("dialog", { name: "Log details", exact: true });
	await drawer.getByRole("button", { name: "Routing", exact: true }).click();
	await expect(drawer.getByText("Final upstream model", { exact: true })).toBeVisible();
	await drawer.getByRole("button", { name: "Detail Info", exact: true }).click();
	await expect(drawer.getByText("Final Calculated Cost:", { exact: true })).toBeVisible();
	await drawer.getByRole("button", { name: /PII fixture/ }).click();
	await drawer.getByRole("button", { name: /EMAIL_ADDRESS.*Score/ }).click();
	await expect(drawer.getByText("Fixture recognizer", { exact: true })).toBeVisible();
	await drawer.getByRole("button", { name: /Bedrock fixture/ }).click();
	await expect(drawer.getByText("HATE", { exact: true })).toBeVisible();
	await drawer.getByRole("button", { name: /Filter fixture/ }).click();
	await expect(drawer.getByText("Fixture pattern", { exact: true })).toBeVisible();
	await drawer.getByRole("button", { name: /Result 1.*Score/ }).click();
	await expect(drawer.getByText("Retrieved fixture text", { exact: true })).toBeVisible();
});
test("J/K navigation selects another request and Escape restores the trigger focus", async ({ page }) => {
	const trigger = page.getByRole("button", { name: "Open request", exact: true });
	await trigger.click();
	await page.keyboard.press("j");
	await expect(page.getByText("Second prompt", { exact: true })).toBeVisible();
	await page.keyboard.press("k");
	await expect(page.getByText("Current request", { exact: true })).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page.getByRole("dialog", { name: "Log details", exact: true })).toBeHidden();
	await expect(trigger).toBeFocused();
});
test("Session simulation replays context, tool output and older pages without calling a model", async ({ page }) => {
	const modelRequests: string[] = [];
	page.on("request", (request) => {
		if (/\/v1\/(?:chat\/completions|responses|messages)$/.test(new URL(request.url()).pathname)) modelRequests.push(request.url());
	});
	await page.getByRole("button", { name: "Open session", exact: true }).click();
	await page.getByRole("button", { name: "模拟 Session", exact: true }).click();
	const simulation = page.getByRole("dialog", { name: "Session 模拟", exact: true });
	await expect(simulation.getByTestId("session-simulation-keys")).toHaveText("Fixture Key");
	await simulation.getByRole("button", { name: "展开系统提醒", exact: true }).click();
	await expect(simulation.getByRole("region", { name: "系统提醒全文" })).toHaveText("Remember the fixture");
	await simulation.getByRole("button", { name: "展开工具结果 Bash", exact: true }).click();
	await expect(simulation.getByRole("region", { name: "工具结果全文 Bash" })).toContainText("Fixture command output");
	await simulation.getByTestId("session-simulation-load-earlier").click();
	await expect(simulation.getByText("Earlier prompt", { exact: true })).toBeVisible();
	await expect(simulation.getByTestId("session-simulation-load-earlier")).toBeHidden();
	expect(modelRequests).toEqual([]);
});

test("recorded images preview with working controls and restore nested drawer focus", async ({ page }) => {
	await page.getByRole("button", { name: "Open request", exact: true }).click();
	const trigger = page.getByRole("button", { name: "预览图片 Generated", exact: true });
	await trigger.click();
	const preview = page.getByRole("dialog", { name: "Image preview", exact: true });
	await expect(preview).toBeVisible();
	await preview.getByRole("button", { name: "Zoom in", exact: true }).click();
	await preview.getByRole("button", { name: "Rotate right", exact: true }).click();
	await page.keyboard.press("Escape");
	await expect(preview).toBeHidden();
	await expect(trigger).toBeFocused();
	await expect(page.getByRole("dialog", { name: "Log details", exact: true })).toBeVisible();
});
