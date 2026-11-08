import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
	await page.goto("/ui/tests/platform-ui/controls.html");
});

test("opening from a disabled selection chooses the first enabled worker with one Down and Enter", async ({ page }) => {
	const input = page.getByRole("combobox", { name: "Disabled current worker", exact: true });
	await input.focus();
	await input.press("ArrowDown");
	await input.press("Enter");
	await expect(page.getByTestId("disabled-current-value")).toHaveText("other");
	await expect(input).toHaveAttribute("aria-expanded", "false");
});

test("an all-disabled list does not select or expose an invalid active option", async ({ page }) => {
	const input = page.getByRole("combobox", { name: "All disabled workers", exact: true });
	await input.focus();
	await input.press("ArrowDown");
	await input.press("Enter");
	await input.press("ArrowDown");
	await input.press("ArrowUp");
	await input.press("Enter");
	await expect(page.getByTestId("all-disabled-value")).toHaveText("current");
	await expect(input).not.toHaveAttribute("aria-activedescendant", /.+/);
	await expect(page.getByRole("option", { name: "Only current worker", exact: true })).toBeDisabled();
	await expect(page.getByRole("option", { name: "Only other worker", exact: true })).toBeDisabled();
});

test("an enabled selected worker remains active on opening and the next Down moves to its successor", async ({ page }) => {
	const input = page.getByRole("combobox", { name: "Normal current worker", exact: true });
	await input.focus();
	await input.press("ArrowDown");
	await input.press("Enter");
	await expect(page.getByTestId("normal-current-value")).toHaveText("second");
	await input.press("ArrowDown");
	await input.press("ArrowDown");
	await input.press("Enter");
	await expect(page.getByTestId("normal-current-value")).toHaveText("third");
});

test("selected multiple tags leave compact editable space without reserving an empty placeholder line", async ({ page }) => {
	const input = page.getByRole("combobox", { name: "Compact endpoint tags", exact: true }),
		control = input.locator("../..");
	await expect(input).toHaveAttribute("placeholder", "");
	await expect(input).toHaveCSS("min-width", "4px");
	expect((await control.boundingBox())?.height).toBe(32);
	await input.fill("regional");
	await input.press("Enter");
	await expect(page.getByTestId("endpoint-tags")).toContainText("regional");
	await control.getByRole("button", { name: "Remove regional", exact: true }).click();
	await control.getByRole("button", { name: "Remove https://api.deepseek.com", exact: true }).click();
	await expect(input).toHaveAttribute("placeholder", "Enter API base");
	await expect(input).toHaveCSS("min-width", "90px");
	expect((await control.boundingBox())?.height).toBe(32);
	await input.fill("https://api.deepseek.com");
	await input.press("Enter");
	await expect(input).toHaveValue("");
	await expect(input).toHaveCSS("min-width", "4px");
	expect((await control.boundingBox())?.height).toBe(32);
	await expect(page.getByTestId("endpoint-tags")).toContainText("https://api.deepseek.com");
});
