import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
	await page.goto("/ui/tests/platform-ui/table-filters.html");
});

test("a column filter applies, shows a removable tag and restores every row when cleared", async ({ page }) => {
	const rows = page.locator(".ui-table tbody tr");
	await expect(rows).toHaveCount(3);
	await page.getByRole("button", { name: "Model filters", exact: true }).click();
	const panel = page.getByRole("dialog", { name: "Model filters", exact: true });
	await panel.getByRole("searchbox", { name: "Model", exact: true }).fill("alpha");
	await panel.getByRole("button", { name: "Apply", exact: true }).click();
	await expect(rows).toHaveCount(1);
	await expect(rows.first()).toContainText("alpha");
	const chip = page.locator(".ui-active-filters__chip");
	await expect(chip).toContainText("Model");
	await expect(chip).toContainText("alpha");
	await page.getByRole("button", { name: "Remove Model filter", exact: true }).click();
	await expect(rows).toHaveCount(3);
	await expect(page.locator(".ui-active-filters")).toHaveCount(0);
});

test("select filters and sortable headers drive the same table state", async ({ page }) => {
	await page.getByRole("button", { name: "Provider filters", exact: true }).click();
	const panel = page.getByRole("dialog", { name: "Provider filters", exact: true });
	await panel.getByRole("option", { name: "Anthropic", exact: true }).click();
	await panel.getByRole("button", { name: "Apply", exact: true }).click();
	const rows = page.locator(".ui-table tbody tr");
	await expect(rows).toHaveCount(1);
	await expect(rows.first()).toContainText("alpha");
	await expect(page.locator(".ui-active-filters__chip")).toContainText("Provider");

	await page.getByRole("button", { name: "Clear all", exact: true }).click();
	await expect(rows).toHaveCount(3);
	await page.getByRole("button", { name: "Model", exact: true }).click();
	await expect(rows.first()).toContainText("alpha");
	await page.getByRole("button", { name: "Model", exact: true }).click();
	await expect(rows.first()).toContainText("zeta");
});
