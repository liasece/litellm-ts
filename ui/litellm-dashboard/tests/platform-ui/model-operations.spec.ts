import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
	await page.route("**/config/routable_model/options", (route) =>
		route.fulfill({
			json: {
				data: [
					{ model_name: "base", type: "model" },
					{ model_name: "backup", type: "model" },
				],
			},
		}),
	);
	await page.route("**/health/latest", (route) => route.fulfill({ json: { latest_health_checks: {} } }));
});

test("alias footer validates required targets and saves a daily window without dropping peer aliases", async ({ page }) => {
	const writes: unknown[] = [];
	await page.route("**/config/update", async (route) => {
		writes.push(route.request().postDataJSON());
		await route.fulfill({ json: {} });
	});
	await page.goto("/ui/tests/model-operations/operations.html?mode=aliases");
	await page.getByRole("button", { name: "Add Alias", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Add Alias", exact: true });
	await expect(dialog.getByRole("combobox", { name: "Resolution", exact: true })).toHaveAttribute(
		"placeholder",
		"Select a model or alias",
	);
	await dialog.getByRole("button", { name: "Save", exact: true }).click();
	await expect(dialog.getByRole("alert")).toHaveText("Alias name and default target are required");
	expect(writes).toEqual([]);
	await dialog.locator("#alias-name").fill("scheduled");
	await dialog.getByRole("combobox", { name: "Resolution", exact: true }).fill("base");
	await page.getByRole("option", { name: "base", exact: true }).click();
	await dialog.getByRole("button", { name: "Add time window", exact: true }).click();
	await dialog.getByLabel("Start time 1", { exact: true }).fill("09:00");
	await dialog.getByLabel("End time 1", { exact: true }).fill("11:00");
	await dialog.getByRole("combobox", { name: "Time window target 1", exact: true }).fill("backup");
	await page.getByRole("option", { name: "backup", exact: true }).click();
	await dialog.getByRole("button", { name: "Save", exact: true }).click();
	await expect(dialog).toBeHidden();
	expect(writes).toEqual([
		{
			router_settings: {
				model_group_alias: {
					research: "base",
					scheduled: {
						model: "base",
						timezone: "Asia/Shanghai",
						schedule: [{ start: "09:00", end: "11:00", model: "backup" }],
					},
				},
			},
		},
	]);
	await expect(page.getByRole("button", { name: "Edit alias scheduled", exact: true })).toBeVisible();
});

test("health header sorting retains selection and selected checks target only that deployment", async ({ page }) => {
	const checks: string[] = [];
	await page.route("**/health?*", async (route) => {
		const id = new URL(route.request().url()).searchParams.get("model_id") ?? "";
		checks.push(id);
		await route.fulfill({
			json: { healthy_count: 1, unhealthy_count: 0, healthy_endpoints: [{ model_id: id }], unhealthy_endpoints: [] },
		});
	});
	await page.goto("/ui/tests/model-operations/operations.html?mode=health");
	const rows = page.locator(".model-health-table tbody tr");
	await expect(rows.first()).toContainText("zeta");
	await page.getByRole("button", { name: "Model Name", exact: true }).click();
	await expect(rows.first()).toContainText("alpha");
	await page.getByRole("checkbox", { name: "Select alpha", exact: true }).check();
	await page.getByRole("button", { name: "Model Name", exact: true }).click();
	await expect(rows.first()).toContainText("zeta");
	await expect(page.getByRole("checkbox", { name: "Select alpha", exact: true })).toBeChecked();
	await page.getByRole("button", { name: "Run Selected Checks", exact: true }).click();
	await expect.poll(() => checks).toEqual(["a-model"]);
	await expect(rows.filter({ hasText: "alpha" })).toContainText("healthy");
	await page.getByRole("button", { name: "a-model", exact: true }).click();
	await expect(page.getByTestId("selected-health-model")).toHaveText("a-model");
});

test("retry scope changes and numerical edits save the global policy while retaining other retry values", async ({ page }) => {
	const writes: unknown[] = [];
	await page.route("**/config/update", async (route) => {
		writes.push(route.request().postDataJSON());
		await route.fulfill({ json: {} });
	});
	await page.goto("/ui/tests/model-operations/operations.html?mode=retries");
	await page.getByRole("combobox", { name: "Retry Policy Scope", exact: true }).click();
	await page.getByRole("option", { name: "Global Default", exact: true }).click();
	await expect(page.getByRole("heading", { name: "Global Retry Policy", exact: true })).toBeVisible();
	await page.getByRole("spinbutton", { name: "BadRequestError (400)", exact: true }).fill("4");
	await page.getByRole("button", { name: "Save", exact: true }).click();
	await expect
		.poll(() => writes)
		.toEqual([{ router_settings: { retry_policy: { RateLimitErrorRetries: 3, BadRequestErrorRetries: 4 } } }]);
});

test("mobile periodic reload retains input across cancel and schedules once without scrolling the background horizontally", async ({
	page,
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	const writes: string[] = [];
	await page.route("**/model/cost_map/source", (route) =>
		route.fulfill({ json: { source: "remote", model_count: 2000, url: "https://prices.example.test/model_prices.json" } }),
	);
	await page.route("**/schedule/model_cost_map_reload/status", (route) => route.fulfill({ json: { scheduled: false, last_run: null } }));
	await page.route("**/schedule/model_cost_map_reload?*", async (route) => {
		writes.push(route.request().url());
		await route.fulfill({ json: { status: "success" } });
	});
	await page.goto("/ui/tests/model-operations/operations.html?mode=prices");
	const setup = page.getByRole("button", { name: "Set Up Periodic Reload", exact: true });
	await setup.click();
	const dialog = page.getByRole("dialog", { name: "Set Up Periodic Reload", exact: true });
	await dialog.getByRole("spinbutton", { name: "Reload interval hours", exact: true }).fill("12");
	await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
	expect(writes).toEqual([]);
	await setup.click();
	await expect(dialog.getByRole("spinbutton", { name: "Reload interval hours", exact: true })).toHaveValue("12");
	await expect.poll(() => page.locator("main").evaluate((element) => element.scrollLeft)).toBe(0);
	await dialog.getByRole("button", { name: "Schedule", exact: true }).click();
	await expect(dialog).toBeHidden();
	expect(writes).toHaveLength(1);
	expect(new URL(writes[0]).searchParams.get("hours")).toBe("12");
});

test("a rejected periodic schedule keeps the dialog and selected interval for correction", async ({ page }) => {
	await page.route("**/model/cost_map/source", (route) => route.fulfill({ json: { source: "remote", model_count: 2000 } }));
	await page.route("**/schedule/model_cost_map_reload/status", (route) => route.fulfill({ json: { scheduled: false } }));
	await page.route("**/schedule/model_cost_map_reload?*", (route) =>
		route.fulfill({ status: 403, json: { error: { message: "Synthetic forbidden" } } }),
	);
	await page.goto("/ui/tests/model-operations/operations.html?mode=prices");
	await page.getByRole("button", { name: "Set Up Periodic Reload", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Set Up Periodic Reload", exact: true });
	await dialog.getByRole("spinbutton", { name: "Reload interval hours", exact: true }).fill("9");
	await dialog.getByRole("button", { name: "Schedule", exact: true }).click();
	await expect(dialog).toBeVisible();
	await expect(dialog.getByRole("spinbutton", { name: "Reload interval hours", exact: true })).toHaveValue("9");
	await expect(page.getByRole("alert")).toContainText("Failed to schedule periodic reload");
});
