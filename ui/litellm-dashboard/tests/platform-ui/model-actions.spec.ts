import { expect, test } from "@playwright/test";

test("saving fallbacks retains peer entries and their order through the actual API payload", async ({ page }) => {
	const writes: unknown[] = [];
	await page.route("**/get/config/callbacks", (route) =>
		route.fulfill({
			json: {
				router_settings: {
					num_retries: 3,
					model_group_retry_policy: { obsolete: 1 },
					fallbacks: [{ first: ["keep"] }, { research: ["old"], peer: ["keep-peer"] }, { last: ["keep-last"] }],
				},
			},
		}),
	);
	await page.route("**/config/update", async (route) => {
		writes.push(route.request().postDataJSON());
		await route.fulfill({ json: {} });
	});
	await page.goto("/ui/tests/models/actions.html");
	await page.getByRole("button", { name: "Open fallbacks", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Edit Fallbacks", exact: true });
	await dialog.getByRole("combobox", { name: "Fallback Models", exact: true }).fill("backup");
	await page.getByRole("option", { name: "backup", exact: true }).click();
	await dialog.getByRole("button", { name: "Save", exact: true }).click();
	await expect(dialog).toBeHidden();
	expect(writes).toEqual([
		{
			router_settings: {
				num_retries: 3,
				fallbacks: [{ first: ["keep"] }, { research: ["backup"], peer: ["keep-peer"] }, { last: ["keep-last"] }],
			},
		},
	]);
	await expect(page.getByRole("alert").filter({ hasText: "Fallbacks updated successfully" })).toBeVisible();
	await expect(page.getByTestId("model-actions-changed")).toHaveText("1");
});

test("a rejected fallback update keeps the selected chain available for correction", async ({ page }) => {
	await page.route("**/get/config/callbacks", (route) => route.fulfill({ json: { router_settings: { fallbacks: [] } } }));
	await page.route("**/config/update", (route) =>
		route.fulfill({ status: 403, json: { error: { message: "Synthetic permission denied" } } }),
	);
	await page.goto("/ui/tests/models/actions.html");
	await page.getByRole("button", { name: "Open fallbacks", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Edit Fallbacks", exact: true });
	await dialog.getByRole("combobox", { name: "Fallback Models", exact: true }).fill("backup");
	await page.getByRole("option", { name: "backup", exact: true }).click();
	await dialog.getByRole("button", { name: "Save", exact: true }).click();
	await expect(page.getByRole("alert")).toContainText("Failed to update fallbacks");
	await expect(dialog).toBeVisible();
	await expect(dialog.locator(".ui-select__tag")).toContainText("backup");
	await expect(page.getByTestId("model-actions-changed")).toHaveText("0");
});

test("storage settings load their current value before saving and retain the mobile label and switch rows", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	let release: () => void = () => {};
	const ready = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route("**/config/list?config_type=general_settings", async (route) => {
		await ready;
		await route.fulfill({ json: [{ field_name: "store_model_in_db", field_value: true, field_description: "Current storage help" }] });
	});
	const writes: unknown[] = [];
	await page.route("**/config/field/update", async (route) => {
		writes.push(route.request().postDataJSON());
		await route.fulfill({ json: {} });
	});
	await page.goto("/ui/tests/models/actions.html");
	await page.getByRole("button", { name: "Open storage settings", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Model Settings", exact: true });
	const save = dialog.getByRole("button", { name: "Save Settings", exact: true });
	await expect(save).toBeDisabled();
	release();
	const toggle = dialog.getByRole("switch", { name: "Store Model in DB", exact: true });
	await expect(toggle).toBeChecked();
	await expect(save).toBeEnabled();
	const label = (await dialog.locator(".model-field__label").boundingBox())!;
	const control = (await toggle.boundingBox())!;
	expect(control.x).toBe(label.x);
	expect(control.y).toBeGreaterThanOrEqual(label.y + label.height);
	await toggle.click();
	await save.click();
	await expect(dialog).toBeHidden();
	expect(writes).toEqual([{ field_name: "store_model_in_db", field_value: false, config_type: "general_settings" }]);
	await expect(page.getByRole("alert")).toContainText("Model storage settings updated successfully");
});

test("route previews show the configured proxy origin for the endpoint and its subpaths", async ({ page }) => {
	await page.goto("/ui/tests/models/actions.html");
	const preview = page.locator(".model-pass-preview");
	const codes = preview.locator("code");
	const origin = new URL(page.url()).origin;
	await expect(codes.nth(0)).toHaveText(origin + "/research");
	await expect(codes.nth(2)).toHaveText(origin + "/research/v1/text-to-image/base/model");
	await expect(codes.nth(1)).toHaveText("https://api.example.test/research");
});

test("a completed earlier routing save cannot close a newly opened settings dialog", async ({ page }) => {
	let release: () => void = () => {};
	const ready = new Promise<void>((resolve) => {
		release = resolve;
	});
	let reads = 0;
	await page.route("**/get/config/callbacks", async (route) => {
		reads++;
		await ready;
		await route.fulfill({ json: { router_settings: { fallbacks: [] } } });
	});
	await page.route("**/config/update", (route) => route.fulfill({ json: {} }));
	await page.route("**/config/list?config_type=general_settings", (route) =>
		route.fulfill({ json: [{ field_name: "store_model_in_db", field_value: true }] }),
	);
	await page.goto("/ui/tests/models/actions.html");
	await page.getByRole("button", { name: "Open fallbacks", exact: true }).click();
	const fallbacks = page.getByRole("dialog", { name: "Edit Fallbacks", exact: true });
	await fallbacks.getByRole("button", { name: "Save", exact: true }).click();
	await expect.poll(() => reads).toBe(1);
	await fallbacks.getByRole("button", { name: "Cancel", exact: true }).click();
	await page.getByRole("button", { name: "Open storage settings", exact: true }).click();
	const settings = page.getByRole("dialog", { name: "Model Settings", exact: true });
	await expect(settings.getByRole("button", { name: "Save Settings", exact: true })).toBeEnabled();
	release();
	await expect(page.getByTestId("model-actions-changed")).toHaveText("1");
	await expect(settings).toBeVisible();
	await expect(settings.getByRole("switch", { name: "Store Model in DB", exact: true })).toBeChecked();
});

test("model naming help retains its full usage example and stays inside a narrow viewport", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/ui/tests/models/actions.html");
	await page.locator(".model-mapping-help").hover();
	const help = page.getByRole("tooltip");
	await expect(help).toContainText("The name you specify in your API calls to LiteLLM Proxy");
	await expect(help).toContainText('model = "example-name"');
	await expect(help).toContainText("LiteLLM sends qwen-plus-latest to the provider");
	const box = (await help.boundingBox())!;
	expect(box.x).toBeGreaterThanOrEqual(0);
	expect(box.x + box.width).toBeLessThanOrEqual(390);
});
