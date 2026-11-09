import { expect, test, type Page } from "@playwright/test";
import { fixtureForPlayground, chatStream, responsesStream, anthropicStream, png } from "../playground/Fixtures";
async function choose(page: Page, name: string, label: string) {
	await page.getByRole("combobox", { name, exact: true }).click();
	await page.getByRole("option", { name: label, exact: true }).click();
}
test.beforeEach(async ({ page }) => {
	await page.route("**/*", async (route) => {
		const request = route.request(),
			url = new URL(request.url()),
			path = url.pathname;
		if (path.startsWith("/ui/") || path.startsWith("/@") || path.startsWith("/src/") || path.startsWith("/node_modules/"))
			return route.continue();
		let body: Record<string, unknown> = {};
		try {
			body = request.postDataJSON() ?? {};
		} catch {
			/* Binary fixtures are handled below. */
		}
		if (path === "/chat/completions") return route.fulfill({ contentType: "text/event-stream", body: chatStream() });
		if (path === "/responses") return route.fulfill({ contentType: "text/event-stream", body: responsesStream() });
		if (path === "/v1/messages") return route.fulfill({ contentType: "text/event-stream", body: anthropicStream() });
		if (path === "/audio/speech") return route.fulfill({ contentType: "audio/mpeg", body: Buffer.from("synthetic audio") });
		if (path === "/get_image") return route.fulfill({ contentType: "image/png", body: Buffer.from(png.split(",")[1], "base64") });
		const fixture = fixtureForPlayground(path, request.method(), body);
		if (fixture !== null) return route.fulfill({ json: fixture });
		return route.continue();
	});
});
test("chat streams reasoning and metrics, switches provider protocol, and shows generated code", async ({ page }) => {
	const requests: { path: string; body: Record<string, unknown>; headers: Record<string, string> }[] = [];
	page.on("request", (request) => {
		const path = new URL(request.url()).pathname;
		if (["/chat/completions", "/v1/messages"].includes(path))
			requests.push({ path, body: request.postDataJSON(), headers: request.headers() });
	});
	await page.goto("/ui/tests/playground/playground.html");
	await choose(page, "Select Model", "Alias: fixture-chat");
	await page.getByPlaceholder("Type your message... (Shift+Enter for new line)").filter({ visible: true }).fill("Hello fixture");
	await page.getByRole("button", { name: "Send message", exact: true }).click();
	await expect(page.getByText("Fixture chat answer", { exact: true })).toBeVisible();
	await expect(page.getByText("Fixture reasoning", { exact: true })).toBeVisible();
	await expect(page.getByText("Total: 7", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Get Code", exact: true }).click();
	await expect(page.getByRole("dialog", { name: "Generated Code" })).toContainText("cookie-session");
	await page.keyboard.press("Escape");
	await choose(page, "Endpoint Type", "/v1/messages");
	await choose(page, "Select Model", "Alias: fixture-chat");
	await page.getByPlaceholder("Type your message... (Shift+Enter for new line)").filter({ visible: true }).fill("Anthropic fixture");
	await page.getByRole("button", { name: "Send message", exact: true }).click();
	await expect(page.getByText("Fixture Anthropic answer", { exact: true })).toBeVisible();
	expect(requests[1].path).toBe("/v1/messages");
	expect(requests[1].body.max_tokens).toBe(1024);
	expect(requests[1].headers.authorization).toBeUndefined();
});
test("Responses attaches image data and continues with previous_response_id", async ({ page }) => {
	const bodies: Record<string, unknown>[] = [];
	page.on("request", (request) => {
		if (new URL(request.url()).pathname === "/responses") bodies.push(request.postDataJSON());
	});
	await page.goto("/ui/tests/playground/playground.html");
	await choose(page, "Endpoint Type", "/v1/responses");
	await choose(page, "Select Model", "Alias: fixture-chat");
	await page
		.locator('.pg-chat:visible input[type="file"][accept="image/*,.pdf"]')
		.setInputFiles({ name: "fixture.png", mimeType: "image/png", buffer: Buffer.from(png.split(",")[1], "base64") });
	await page.getByPlaceholder("Type your message... (Shift+Enter for new line)").filter({ visible: true }).fill("Inspect fixture");
	await page.getByRole("button", { name: "Send message", exact: true }).click();
	await expect(page.getByText("Fixture Responses answer", { exact: true })).toBeVisible();
	await page.getByPlaceholder("Type your message... (Shift+Enter for new line)").filter({ visible: true }).fill("Continue");
	await page.getByRole("button", { name: "Send message", exact: true }).click();
	await expect.poll(() => bodies.length).toBe(2);
	expect(JSON.stringify(bodies[0])).toContain("data:image/png;base64,");
	expect(bodies[1].previous_response_id).toBe("response-fixture");
	expect(bodies[1].input).toEqual([{ role: "user", content: "Continue", type: "message" }]);
});
test("Compare creates a third independent panel and sends the shared prompt concurrently", async ({ page }) => {
	await page.goto("/ui/tests/playground/playground.html");
	await page.getByRole("tab", { name: "Compare", exact: true }).click();
	await page.getByRole("button", { name: "Add Comparison", exact: true }).click();
	await expect(page.locator(".pg-compare-panel")).toHaveCount(3);
	await page.getByPlaceholder("Type your message... (Shift+Enter for new line)").filter({ visible: true }).fill("Compare fixture");
	await page.getByRole("button", { name: "Send comparison message", exact: true }).click();
	await expect(page.getByText("Fixture chat answer", { exact: true })).toHaveCount(3);
	await page.getByRole("button", { name: "Clear All Chats", exact: true }).click();
	await expect(page.getByText("Fixture chat answer", { exact: true })).toHaveCount(0);
});
test("independent Chat persists the edited message and restarts the Responses session", async ({ page }) => {
	const requests: Record<string, unknown>[] = [];
	page.on("request", (request) => {
		if (new URL(request.url()).pathname === "/responses") requests.push(request.postDataJSON());
	});
	await page.goto("/ui/tests/playground/playground.html?view=consumer");
	await page.getByPlaceholder("How can I help you today?").fill("Original prompt");
	await page.getByRole("button", { name: "Send", exact: true }).click();
	await expect(page.getByText("Fixture Responses answer", { exact: true })).toBeVisible();
	await page.getByRole("main").getByText("Original prompt", { exact: true }).hover();
	await page.getByRole("button", { name: "Edit message", exact: true }).click();
	await page.locator(".chat-user-message__editor textarea").fill("Revised prompt");
	await page.getByRole("button", { name: "Save & Send", exact: true }).click();
	await expect.poll(() => requests.length).toBe(2);
	expect(requests[1].previous_response_id).toBeUndefined();
	expect(requests[1].input).toEqual([{ role: "user", content: "Revised prompt", type: "message" }]);
	await expect
		.poll(() =>
			page.evaluate(() => {
				const conversations = JSON.parse(localStorage.getItem("litellm_chat_history_v1") || "[]") as {
					messages: { content: string }[];
				}[];
				return conversations[0]?.messages[0]?.content;
			}),
		)
		.toBe("Revised prompt");
});
test("Realtime connects with its WS protocol, sends text frames and disconnects", async ({ page }) => {
	const frames: Record<string, unknown>[] = [];
	await page.routeWebSocket(/\/v1\/realtime\?/, (socket) => {
		socket.send(JSON.stringify({ type: "session.created" }));
		socket.onMessage((message) => {
			const value = JSON.parse(String(message));
			frames.push(value);
			if (value.type === "response.create")
				socket.send(JSON.stringify({ type: "response.text.delta", delta: "Realtime fixture answer" }));
		});
	});
	await page.goto("/ui/tests/playground/playground.html");
	await choose(page, "Endpoint Type", "/v1/realtime");
	await choose(page, "Select Model", "Enter custom model");
	await page.getByPlaceholder("Enter custom model name").fill("fixture-chat");
	await page.waitForTimeout(550);
	await page.getByRole("button", { name: "Connect", exact: true }).click();
	await expect(page.getByText("Connected to realtime API", { exact: true })).toBeVisible();
	await page.getByPlaceholder("Type a message or use the mic...").fill("Realtime prompt");
	await page.getByRole("button", { name: "Send realtime message", exact: true }).click();
	await expect(page.getByText("Realtime fixture answer", { exact: true })).toBeVisible();
	expect(frames.some((frame) => frame.type === "conversation.item.create")).toBe(true);
	await page.getByRole("button", { name: "Disconnect", exact: true }).click();
	await expect(page.getByText("Disconnected", { exact: true }).first()).toBeVisible();
});

test("switching playground tabs preserves independent unsent drafts", async ({ page }) => {
	await page.goto("/ui/tests/playground/playground.html");
	const composer = () => page.getByPlaceholder("Type your message... (Shift+Enter for new line)").filter({ visible: true });
	await composer().fill("Unsent chat draft");
	await page.getByRole("tab", { name: "Compare", exact: true }).click();
	await composer().fill("Unsent comparison draft");
	await page.getByRole("button", { name: "Add Comparison", exact: true }).click();
	await page.getByRole("tab", { name: "Chat", exact: true }).click();
	await expect(composer()).toHaveValue("Unsent chat draft");
	await page.getByRole("tab", { name: "Compare", exact: true }).click();
	await expect(composer()).toHaveValue("Unsent comparison draft");
	await expect(page.locator(".pg-compare-panel")).toHaveCount(3);
});
