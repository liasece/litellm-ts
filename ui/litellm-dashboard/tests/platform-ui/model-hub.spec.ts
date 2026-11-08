import { expect, test } from "@playwright/test";
import { fixtureForModelHub } from "../model-hub/Fixtures";
import { png } from "../playground/Fixtures";
test.beforeEach(async ({ page }) => {
	await page.route("**/*", async (route) => {
		const request = route.request(),
			path = new URL(request.url()).pathname;
		if (path.startsWith("/ui/") || path.startsWith("/@") || path.startsWith("/src/") || path.startsWith("/node_modules/"))
			return route.continue();
		if (path === "/get_image") return route.fulfill({ contentType: "image/png", body: Buffer.from(png.split(",")[1], "base64") });
		let body: Record<string, unknown> = {};
		try {
			body = request.postDataJSON() ?? {};
		} catch {
			/* Only fixture JSON writes are used. */
		}
		const fixture = fixtureForModelHub(path, request.method(), body);
		return route.fulfill({ status: fixture === null ? 404 : 200, json: fixture ?? { detail: "No fixture for this path" } });
	});
});
test("admin model filters and column sorting operate on displayed resource rows", async ({ page }) => {
	await page.goto("/ui/tests/model-hub/model-hub.html");
	const table = page.locator(".hub-resource-card:visible table");
	await expect(table.locator("tbody tr")).toHaveCount(3);
	await table.getByRole("columnheader", { name: /^Public Model Name/ }).click();
	await expect(table.locator("tbody tr").first()).toContainText("fixture-wildcard/*");
	await page.getByRole("combobox", { name: "Provider", exact: true }).selectOption("openai");
	await expect(table.locator("tbody tr")).toHaveCount(1);
	await page.getByRole("button", { name: "Clear Filters", exact: true }).click();
	await page.getByPlaceholder("Search model names...", { exact: true }).filter({ visible: true }).fill("not-present");
	await expect(table).toContainText("No models found");
});
test("all three publish wizards preserve public preselection and send the reviewed identifiers", async ({ page }) => {
	const writes: { path: string; body: unknown }[] = [];
	page.on("request", (request) => {
		if (request.method() === "POST") writes.push({ path: new URL(request.url()).pathname, body: request.postDataJSON() });
	});
	await page.goto("/ui/tests/model-hub/model-hub.html");
	await page.getByRole("button", { name: "Select Models to Make Public", exact: true }).click();
	await expect(page.getByRole("checkbox", { name: "Select fixture-alpha", exact: true })).toBeChecked();
	await page.getByRole("checkbox", { name: "Select fixture-private", exact: true }).check();
	await page.getByRole("button", { name: "Next", exact: true }).click();
	await expect(page.getByText("Confirm Making Models Public", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Make Public", exact: true }).click();
	await expect.poll(() => writes.length).toBe(1);
	expect(writes[0]).toEqual({
		path: "/model_group/make_public",
		body: { model_groups: ["fixture-alpha", "fixture-wildcard/*", "fixture-private"] },
	});
	await page.getByRole("tab", { name: "Agent Hub", exact: true }).click();
	await page.getByRole("button", { name: "Select Agents to Make Public", exact: true }).click();
	await expect(page.getByRole("checkbox", { name: "Select Fixture Research", exact: true })).toBeChecked();
	await page.getByRole("button", { name: "Next", exact: true }).click();
	await page.getByRole("button", { name: "Make Public", exact: true }).click();
	await expect.poll(() => writes.length).toBe(2);
	expect(writes[1]).toEqual({ path: "/v1/agents/make_public", body: { agent_ids: ["fixture-agent-id"] } });
	await page.getByRole("tab", { name: "MCP Hub", exact: true }).click();
	await page.getByRole("button", { name: "Select MCP Servers to Make Public", exact: true }).click();
	await expect(page.getByRole("checkbox", { name: "Select fixture-docs", exact: true })).toBeChecked();
	await page.getByRole("button", { name: "Next", exact: true }).click();
	await page.getByRole("button", { name: "Make Public", exact: true }).click();
	await expect.poll(() => writes.length).toBe(3);
	expect(writes[2]).toEqual({ path: "/v1/mcp/make_public", body: { mcp_server_ids: ["fixture-server"] } });
});
test("link management edits and reorders only after successful fixture saves", async ({ page }) => {
	const bodies: Record<string, unknown>[] = [];
	page.on("request", (request) => {
		if (new URL(request.url()).pathname === "/model_hub/update_useful_links") bodies.push(request.postDataJSON());
	});
	await page.goto("/ui/tests/model-hub/model-hub.html");
	await page.getByPlaceholder("Friendly name").fill("Status");
	await page.getByPlaceholder("https://example.com").fill("https://status.example.test");
	await page.getByRole("button", { name: "Add Link", exact: true }).click();
	await expect.poll(() => bodies.length).toBe(1);
	await page.getByRole("button", { name: "Edit Status", exact: true }).click();
	await page.getByRole("textbox", { name: "Edit display name", exact: true }).fill("Service Status");
	await page.getByRole("button", { name: "Save", exact: true }).click();
	await expect.poll(() => bodies.length).toBe(2);
	await page.getByRole("button", { name: "Rearrange Order", exact: true }).click();
	await page.getByRole("button", { name: "Move up Service Status", exact: true }).click();
	await page.getByRole("button", { name: "Save Order", exact: true }).click();
	await expect.poll(() => bodies.length).toBe(3);
	expect(bodies[2]).toEqual({
		useful_links: {
			Documentation: { url: "https://docs.example.test", index: 0 },
			"Service Status": { url: "https://status.example.test", index: 1 },
			Support: { url: "https://support.example.test", index: 2 },
		},
	});
	await page.getByRole("button", { name: "Delete Service Status", exact: true }).click();
	await expect.poll(() => bodies.length).toBe(4);
	expect(JSON.stringify(bodies[3])).not.toContain("Service Status");
});
test("marketplace category and keyword search expose the original installation command", async ({ page, context }) => {
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	await page.goto("/ui/tests/model-hub/model-hub.html");
	await page.getByRole("tab", { name: "Claude Code Plugin Marketplace", exact: true }).click();
	await page.getByPlaceholder("Search plugins by name, description, or keywords...").fill("testing");
	await page.getByRole("tab", { name: "Development (1)", exact: true }).click();
	await expect(page.locator(".hub-marketplace table tbody tr")).toHaveCount(1);
	await page.getByRole("button", { name: "Copy install command", exact: true }).click();
	await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("/plugin marketplace add fixture/dev-tools");
});
test("anonymous public Hub shows model, agent and MCP details without private catalog requests", async ({ page }) => {
	const paths: string[] = [];
	page.on("request", (request) => {
		if (["fetch", "xhr"].includes(request.resourceType())) paths.push(new URL(request.url()).pathname);
	});
	await page.goto("/ui/tests/model-hub/model-hub.html?view=public");
	await expect(page.getByRole("button", { name: "Open navigation", exact: true })).toHaveCount(0);
	await page.getByRole("button", { name: "+2", exact: true }).click();
	await expect(page.getByText("All Features:", { exact: true })).toBeVisible();
	await page.keyboard.press("Escape");
	await page.getByRole("button", { name: "fixture-wildcard/*", exact: true }).click();
	await expect(page.getByRole("dialog")).toContainText("Wildcard Routing");
	await expect(page.getByRole("dialog")).toContainText("your_api_key");
	await page.keyboard.press("Escape");
	await page.getByRole("tab", { name: "Agent Hub", exact: true }).click();
	await page.getByRole("button", { name: "Fixture Research", exact: true }).click();
	await expect(page.getByRole("dialog")).toContainText("Usage Example (A2A Protocol)");
	await page.keyboard.press("Escape");
	await page.getByRole("tab", { name: "MCP Hub", exact: true }).click();
	await page.getByRole("button", { name: "fixture-docs", exact: true }).click();
	await expect(page.getByRole("dialog")).toContainText("Additional Information");
	expect(paths).not.toContain("/model_group/info");
	expect(paths).not.toContain("/v1/agents");
	expect(paths).not.toContain("/v1/mcp/server");
});
test("public-table key entry respects the enabled setting before showing the public page", async ({ page }) => {
	await page.route("**/config/field/info?field_name=enable_public_model_hub", (route) => route.fulfill({ json: { field_value: false } }));
	await page.goto("/ui/tests/model-hub/model-hub.html?view=table&key=synthetic-fixture");
	await expect(page.getByText("Public Model Hub not enabled.", { exact: true })).toBeVisible();
	await expect(page.getByText("Available Models", { exact: true })).toHaveCount(0);
});

test("a forbidden model publication keeps the reviewed selection open and reports failure", async ({ page }) => {
	await page.route("**/model_group/make_public", (route) => route.fulfill({ status: 403, json: { detail: "Forbidden fixture" } }));
	await page.goto("/ui/tests/model-hub/model-hub.html");
	await page.getByRole("button", { name: "Select Models to Make Public", exact: true }).click();
	await page.getByRole("button", { name: "Next", exact: true }).click();
	await page.getByRole("button", { name: "Make Public", exact: true }).click();
	await expect(page.getByText("Failed to make model groups public. Please try again.", { exact: true })).toBeVisible();
	await expect(page.getByRole("dialog", { name: "Make Models Public", exact: true })).toBeVisible();
	await expect(page.getByText("Confirm Making Models Public", { exact: true })).toBeVisible();
});
