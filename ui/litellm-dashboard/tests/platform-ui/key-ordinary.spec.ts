import { expect, test, type Locator, type Page } from "@playwright/test";
async function selectModel(page: Page, control: Locator, value: string) {
	await control.fill(value);
	await page.getByRole("option", { name: value, exact: true }).click();
}
async function aliases(page: Page) {
	return JSON.parse(await page.getByTestId("aliases-value").innerText()) as Record<string, string>;
}
test("aliases preserve empty disablement and create/edit/cancel/delete order and feedback", async ({ page }) => {
	await page.goto("/ui/tests/key-ordinary/key-ordinary.html");
	const add = page.getByRole("button", { name: "Add Alias", exact: true });
	await expect(add).toBeDisabled();
	await page.getByLabel("Alias Name", { exact: true }).fill("friendly");
	await expect(add).toBeDisabled();
	await selectModel(page, page.getByRole("combobox", { name: "Target Model", exact: true }), "gpt-4.1");
	await expect(add).toBeEnabled();
	await add.click();
	await expect.poll(() => aliases(page)).toEqual({ friendly: "gpt-4.1" });
	await expect(page.getByText("Alias added successfully", { exact: true })).toBeVisible();
	await expect(add).toBeDisabled();
	await page.getByLabel("Alias Name", { exact: true }).fill("friendly");
	await selectModel(page, page.getByRole("combobox", { name: "Target Model", exact: true }), "gpt-4.1-mini");
	await add.click();
	await expect(page.getByText("An alias with this name already exists", { exact: true })).toBeVisible();
	expect(await aliases(page)).toEqual({ friendly: "gpt-4.1" });
	await page.getByLabel("Alias Name", { exact: true }).fill("secondary");
	await add.click();
	const first = page.getByRole("row").filter({ hasText: "friendly" });
	await first.getByRole("button", { name: "Edit alias", exact: true }).click();
	await page.getByRole("textbox", { name: "Edit alias name", exact: true }).fill("renamed");
	await selectModel(page, page.getByRole("combobox", { name: "Edit target model", exact: true }), "gpt-4.1-mini");
	await page.getByRole("button", { name: "Save", exact: true }).click();
	await expect.poll(() => aliases(page)).toEqual({ renamed: "gpt-4.1-mini", secondary: "gpt-4.1-mini" });
	expect(Object.keys(await aliases(page))).toEqual(["renamed", "secondary"]);
	await page.getByRole("row").filter({ hasText: "secondary" }).getByRole("button", { name: "Edit alias", exact: true }).click();
	await page.getByRole("textbox", { name: "Edit alias name", exact: true }).fill("not-saved");
	await page.getByRole("button", { name: "Cancel", exact: true }).click();
	expect(Object.keys(await aliases(page))).toEqual(["renamed", "secondary"]);
	await page.getByRole("row").filter({ hasText: "renamed" }).getByRole("button", { name: "Delete alias", exact: true }).click();
	await expect.poll(() => aliases(page)).toEqual({ secondary: "gpt-4.1-mini" });
	await expect(page.getByText("Alias deleted successfully", { exact: true })).toBeVisible();
});
test("regeneration shows the returned secret once, retains original labels/panel geometry and copies with feedback", async ({
	page,
	context,
}) => {
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	const requests: unknown[] = [];
	await page.route("**/key/**", async (route) => {
		requests.push(route.request().postDataJSON());
		await route.fulfill({ json: { key: "synthetic-rotated-value", token: "synthetic-new-hash" } });
	});
	await page.goto("/ui/tests/key-ordinary/key-ordinary.html?mode=regenerate");
	await page.getByRole("button", { name: "Regenerate", exact: true }).click();
	await expect(page.getByText("Regenerated Key", { exact: true })).toBeVisible();
	const label = page.getByText("Key Alias:", { exact: true });
	await expect(label).toHaveCSS("font-size", "12.4px");
	await expect(label).toHaveCSS("line-height", "18.4px");
	const secret = page.getByText("synthetic-rotated-value", { exact: true });
	await expect(secret).toBeVisible();
	expect(await secret.evaluate((e) => e.parentElement?.getBoundingClientRect().height)).toBe(38);
	expect(requests).toHaveLength(1);
	expect(requests[0]).toMatchObject({
		key_alias: "Synthetic key",
		max_budget: 100,
		tpm_limit: 10000,
		rpm_limit: 100,
		duration: "",
		grace_period: "",
	});
	await page.getByRole("button", { name: "Copy Virtual Key", exact: true }).click();
	await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("synthetic-rotated-value");
	await expect(page.getByText("Virtual Key copied to clipboard", { exact: true })).toBeVisible();
	await page.getByRole("contentinfo").getByRole("button", { name: "Close", exact: true }).click();
	await expect(page.getByRole("dialog")).not.toBeVisible();
});
test("regeneration rejection keeps the draft available and uses its existing notification feedback", async ({ page }) => {
	await page.route("**/key/**", (route) => route.fulfill({ status: 500, json: { error: "Synthetic regeneration rejection" } }));
	await page.goto("/ui/tests/key-ordinary/key-ordinary.html?mode=regenerate");
	await page.getByRole("button", { name: "Regenerate", exact: true }).click();
	await expect(page.getByText(/Synthetic regeneration rejection/)).toBeVisible();
	await expect(page.getByRole("button", { name: "Regenerate", exact: true })).toBeEnabled();
	await expect(page.locator(".ui-dialog__body .ui-alert")).toHaveCount(0);
});
