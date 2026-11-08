import { expect, test } from "@playwright/test";
test.beforeEach(async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 1000 });
	await page.goto("/ui/tests/keys/edit.html");
});
test("the long edit form keeps its original sticky Cancel and Save controls while validating invalid metadata", async ({ page }) => {
	await page.getByRole("button", { name: "Open key edit", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Edit Virtual Key", exact: true }),
		footer = dialog.locator(".vk-edit-footer"),
		save = dialog.getByRole("button", { name: "Save Changes", exact: true });
	await expect(footer).toHaveCSS("position", "sticky");
	const initial = await footer.boundingBox();
	expect(initial!.y + initial!.height).toBe(1024);
	expect((await dialog.getByRole("button", { name: "Cancel", exact: true }).boundingBox())!.x).toBeLessThan(
		(await save.boundingBox())!.x,
	);
	await dialog.locator('textarea[id$="-metadataText"]').fill("{ invalid JSON");
	await save.click();
	await expect(page.getByRole("alert").filter({ hasText: "Invalid metadata JSON" })).toBeVisible();
	await expect(page.getByTestId("key-saves")).toHaveText("0");
	const current = await footer.boundingBox();
	expect(current!.y + current!.height).toBe(1024);
	await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
	await expect(dialog).toBeHidden();
});
test("the existing pending update state disables cancel until the operation ends", async ({ page }) => {
	await page.getByRole("button", { name: "Open busy key edit", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Edit Virtual Key", exact: true });
	await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
	await expect(dialog.getByRole("button", { name: /Save Changes$/ })).toHaveAttribute("aria-busy", "true");
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
});

test("editing a legacy reset-budget label keeps the existing normalized request payload", async ({ page }) => {
	await page.getByRole("button", { name: "Open key edit", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Edit Virtual Key", exact: true }),
		reset = dialog.getByRole("combobox", { name: "Reset Budget", exact: true });
	await expect(reset.locator("../..")).toContainText("30d");
	await reset.click();
	await page.getByRole("option", { name: "Daily", exact: true }).click();
	await dialog.getByRole("button", { name: "Save Changes", exact: true }).click();
	await expect(page.getByTestId("key-saves")).toHaveText("1");
	await expect(page.getByTestId("key-budget-duration")).toHaveText("24h");
});
