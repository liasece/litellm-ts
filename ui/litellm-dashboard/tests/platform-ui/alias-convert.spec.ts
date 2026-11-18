import { expect, test, type Page } from "@playwright/test";

interface Write {
	path: string;
	body: Record<string, unknown>;
}

/**
 * 转换弹窗的行为契约：先写别名再删部署，删的是同一公共名的全部部署，
 * 表单里改过的名字与目标要原样进入别名表；名字撞车时一个写请求都不该发出。
 */
async function openDialog(page: Page, writes: Write[]): Promise<void> {
	page.on("request", (request) => {
		const path = new URL(request.url()).pathname;
		if (path === "/config/update" || path === "/model/delete") writes.push({ path, body: request.postDataJSON() });
	});
	await page.route("**/*", async (route) => {
		const path = new URL(route.request().url()).pathname;
		if (path.startsWith("/ui/") || path.startsWith("/@") || path.startsWith("/src/") || path.startsWith("/node_modules/"))
			return route.continue();
		if (path === "/get/config/callbacks")
			return route.fulfill({ json: { router_settings: { num_retries: 2, model_group_alias: { keep: "model-z" } } } });
		if (path === "/config/routable_model/options")
			return route.fulfill({
				json: {
					data: [
						{ model_name: "gpt-5.5", type: "model" },
						{ model_name: "gpt-5.6-terra", type: "model" },
						{ model_name: "model-a", type: "model" },
					],
				},
			});
		if (path === "/v2/model/info")
			return route.fulfill({
				json: {
					data: [
						{ model_name: "gpt-5.5", litellm_params: { model: "openai/gpt-5.5" }, model_info: { id: "id-1" } },
						{ model_name: "gpt-5.5", litellm_params: { model: "openai/gpt-5.5" }, model_info: { id: "id-2" } },
						{ model_name: "neighbour", litellm_params: { model: "openai/x" }, model_info: { id: "id-3" } },
					],
					total_count: 3,
					current_page: 1,
					total_pages: 1,
					size: 50,
				},
			});
		if (path === "/config/update" || path === "/model/delete") return route.fulfill({ json: { success: true } });
		return route.continue();
	});
	await page.goto("/ui/tests/models/alias-convert.html");
	await expect(page.getByRole("dialog", { name: "Convert to alias" })).toBeVisible();
}

test("confirms the alias the dialog pre-fills from the model and its override", async ({ page }) => {
	const writes: Write[] = [];
	await openDialog(page, writes);
	const dialog = page.getByRole("dialog", { name: "Convert to alias" });
	await expect(page.getByLabel("Alias name")).toHaveValue("gpt-5.5");
	await expect(dialog.getByRole("article").filter({ hasText: "Primary target" })).toContainText("gpt-5.6-terra");
	await expect(dialog).toContainText("removes 2 deployment(s) of “gpt-5.5”");
	await dialog.getByRole("button", { name: "Convert to alias", exact: true }).click();
	await expect(page.getByTestId("converted")).toHaveText("keep,gpt-5.5");
	expect(writes).toEqual([
		{ path: "/config/update", body: { router_settings: { model_group_alias: { keep: "model-z", "gpt-5.5": "gpt-5.6-terra" } } } },
		{ path: "/model/delete", body: { id: "id-1" } },
		{ path: "/model/delete", body: { id: "id-2" } },
	]);
});

test("saves the edited name and target list instead of the pre-filled ones", async ({ page }) => {
	const writes: Write[] = [];
	await openDialog(page, writes);
	const dialog = page.getByRole("dialog", { name: "Convert to alias" });
	await page.getByLabel("Alias name").fill("gpt-5.5-legacy");
	await dialog.getByRole("button", { name: "Add target", exact: true }).click();
	await page.getByRole("combobox", { name: "Fallback target 2", exact: true }).click();
	await page.getByRole("option", { name: "model-a", exact: true }).click();
	await expect(dialog).toContainText("The alias uses a different name");
	await dialog.getByRole("button", { name: "Convert to alias", exact: true }).click();
	await expect(page.getByTestId("converted")).toHaveText("keep,gpt-5.5-legacy");
	expect(writes[0]).toEqual({
		path: "/config/update",
		body: {
			router_settings: { model_group_alias: { keep: "model-z", "gpt-5.5-legacy": { targets: ["gpt-5.6-terra", "model-a"] } } },
		},
	});
});

test("refuses a name that is already an alias and sends nothing", async ({ page }) => {
	const writes: Write[] = [];
	await openDialog(page, writes);
	const dialog = page.getByRole("dialog", { name: "Convert to alias" });
	await page.getByLabel("Alias name").fill("keep");
	await expect(dialog.getByRole("alert")).toHaveText('An alias named "keep" already exists. Choose a different name.');
	await dialog.getByRole("button", { name: "Convert to alias", exact: true }).click();
	await expect(dialog.getByRole("alert")).toBeVisible();
	expect(writes).toEqual([]);
});
