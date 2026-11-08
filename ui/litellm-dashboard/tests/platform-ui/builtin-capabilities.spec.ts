import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
	const blank = { enabled: false, always_inject: false, handler_model: "", executors: [], max_iterations: 4, max_output_tokens: 32768 };
	const capabilities = {
		vision: structuredClone(blank),
		image_generation: { ...structuredClone(blank), always_inject: true },
		web: structuredClone(blank),
	};
	await page.route("**/builtin-capabilities", async (route) =>
		route.fulfill({ json: { capabilities, available_models: [], image_generation_available_models: [], web_available_models: [] } }),
	);
	await page.route("**/credentials", async (route) =>
		route.fulfill({ json: { credentials: [{ credential_name: "deepseek-fixture" }] } }),
	);
	await page.goto("/ui/tests/builtin-capabilities/builtin.html");
	await expect(page.getByText("Built-in Capabilities", { exact: true })).toBeVisible();
});

test("a narrow executor preserves a compact API endpoint and its original wrapping header", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.getByRole("button", { name: "Add DeepSeek Search & Fetch", exact: true }).click();
	const endpoint = page.getByRole("combobox", { name: "API base for executor 1", exact: true }).locator("../..");
	expect((await endpoint.boundingBox())?.height).toBe(32);
	const number = page.locator(".builtin-executor-kind>.builtin-xs");
	expect((await number.boundingBox())?.height).toBe(32);
	const credential = page.getByRole("combobox", { name: "Credential for executor 1", exact: true });
	await credential.fill("deepseek-fixture");
	await credential.press("ArrowDown");
	await credential.press("Enter");
	await expect(credential.locator("../..")).toContainText("deepseek-fixture");
	// The original narrow header overflows; operate the remove action at its desktop viewport.
	await page.setViewportSize({ width: 1440, height: 1000 });
	await page.getByRole("button", { name: "Remove executor 1", exact: true }).click();
	await expect(page.getByText("No executor configured. Add a model or DeepSeek Search & Fetch executor.", { exact: true })).toBeVisible();
});

test("an executor validation message reserves only the original AntD additional field height", async ({ page }) => {
	await page.getByRole("switch").nth(4).click();
	await page.getByRole("button", { name: "Save Changes", exact: true }).click();
	const error = page.getByText("Add at least one executor", { exact: true });
	await expect(error).toBeVisible();
	const card = page.locator(".ui-card").filter({ has: error });
	const label = card.locator("label").filter({ hasText: "Maximum private turns" });
	const errorBox = await error.boundingBox(),
		labelBox = await label.boundingBox();
	expect(labelBox!.y).toBe(errorBox!.y + errorBox!.height);
	await page.getByRole("button", { name: "Add DeepSeek Search & Fetch", exact: true }).click();
	const remove = page.getByRole("button", { name: "Remove executor 1", exact: true });
	await remove.hover();
	await expect(page.getByText("Remove", { exact: true })).toBeVisible();
});

test("saving the form submits editable fields without changing hidden web injection defaults", async ({ page }) => {
	let submitted: Record<string, Record<string, unknown>> | undefined;
	await page.route("**/builtin-capabilities", async (route) => {
		submitted = route.request().postDataJSON();
		await route.fulfill({ status: 403, body: "Synthetic save rejection" });
	});
	await page.getByRole("button", { name: "Save Changes", exact: true }).click();
	await expect.poll(() => submitted).toBeDefined();
	expect(submitted!.web).toEqual({ enabled: false, executors: [], max_iterations: 4, max_output_tokens: 32768 });
	expect(submitted!.vision).toEqual({
		enabled: false,
		always_inject: false,
		executors: [],
		max_iterations: 4,
		max_output_tokens: 32768,
	});
	expect(submitted!.image_generation).toEqual({
		enabled: false,
		always_inject: true,
		executors: [],
		max_iterations: 4,
		max_output_tokens: 32768,
	});
	await expect(page.getByRole("button", { name: "Save Changes", exact: true })).toBeEnabled();
});
