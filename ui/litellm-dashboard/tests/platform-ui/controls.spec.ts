import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
	await page.goto("/ui/tests/platform-ui/controls.html");
});

test("searching and keyboard selection update the selected provider", async ({ page }) => {
	const provider = page.getByRole("combobox", { name: "Provider", exact: true });
	await provider.fill("Anth");
	await expect(page.getByRole("option", { name: "Anthropic", exact: true })).toBeVisible();
	await provider.press("Enter");
	await expect(page.getByTestId("provider")).toHaveText("anthropic");
	await expect(page.getByRole("listbox")).toBeHidden();
	await provider.press("ArrowDown");
	await provider.press("ArrowDown");
	await provider.press("Enter");
	await expect(page.getByTestId("provider")).toHaveText("openai");
});

test("a provider popup works inside the modal and Escape restores focus", async ({ page }) => {
	const trigger = page.getByRole("button", { name: "Open dialog", exact: true });
	await trigger.click();
	const dialog = page.getByRole("dialog", { name: "Edit model", exact: true });
	await expect(dialog).toBeVisible();
	await dialog.getByRole("combobox", { name: "Dialog provider" }).fill("Open");
	await page.getByRole("option", { name: "OpenAI", exact: true }).click();
	await expect(page.getByTestId("provider")).toHaveText("openai");
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
	await expect(trigger).toBeFocused();
	await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
});

test("a request drawer closes with Escape and returns keyboard focus", async ({ page }) => {
	const trigger = page.getByRole("button", { name: "Open drawer", exact: true });
	await trigger.click();
	const drawer = page.getByRole("dialog", { name: "Request details" });
	await expect(drawer).toBeVisible();
	await expect(drawer).toHaveAttribute("data-panel", "request");
	await drawer.getByRole("textbox", { name: "Request note" }).fill("diagnostic draft");
	await page.keyboard.press("Escape");
	await expect(drawer).toBeHidden();
	await expect(trigger).toBeFocused();
});

test("numeric table sorting, row selection and page-size changes preserve user intent", async ({ page }) => {
	await page.getByRole("button", { name: /^Count/ }).click();
	await expect(page.getByTestId("numeric-table").locator("tbody tr").first()).toContainText("Three");
	await page.getByRole("checkbox", { name: "Select row 1", exact: true }).check();
	await expect(page.getByTestId("selected")).toHaveText("2");
	await page.getByRole("button", { name: "Page 6", exact: true }).click();
	await page.getByRole("combobox", { name: "Items per page" }).selectOption("25");
	await expect(page.getByTestId("pagination")).toHaveText("3/25");
});

test("remote matches remain visible and custom tags support Enter and comma separators", async ({ page }) => {
	const remote = page.getByRole("combobox", { name: "Remote owner" });
	await remote.fill("opaque-id");
	await expect(page.getByRole("option", { name: "Research owner", exact: true })).toBeVisible();
	await remote.press("Enter");
	const tags = page.getByRole("combobox", { name: "Custom tags" });
	await tags.fill("research");
	await tags.press("Enter");
	await tags.fill("billing,");
	await expect(page.getByTestId("tags")).toContainText("research");
	await expect(page.getByTestId("tags")).toContainText("billing");
});
test("a long key form accepts multi-line drafts and saves", async ({ page }) => {
	const input = page.getByRole("textbox", { name: "Auto sized draft" });
	await input.fill(Array.from({ length: 12 }, (_, index) => "line " + index).join("\n"));
	await page.getByRole("button", { name: "Open long form", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Long key form", exact: true });
	await expect(dialog).toBeVisible();
	await dialog.getByRole("button", { name: "Save long form", exact: true }).click();
	await expect(dialog).toBeHidden();
});

test("shared notifications stay visible over native modals", async ({ page }) => {
	await page.getByRole("button", { name: "Notify error", exact: true }).click();
	const error = page.getByRole("alert").filter({ hasText: "Fixture notification" });
	await expect(error).toBeVisible();
	await error.getByRole("button", { name: "Close Error", exact: true }).click();
	await expect(error).toBeHidden();
	await page.getByRole("button", { name: "Open long form", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Long key form", exact: true });
	await dialog.getByRole("button", { name: "Notify inside modal", exact: true }).click();
	await expect(dialog.getByRole("alert").filter({ hasText: "Fixture inside modal" })).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
	await expect(page.getByRole("alert").filter({ hasText: "Fixture inside modal" })).toBeVisible();
});
test("two mounted Key forms use distinct IDs and labels focus their own fields", async ({ page }) => {
	const ids = await page.locator('input[id$="-key_alias"]').evaluateAll((inputs) => inputs.map((input) => input.id));
	expect(new Set(ids).size).toBe(2);
	const edit = page.locator(".edit-key-fixture");
	await edit.locator("label").filter({ hasText: "Key Alias" }).click();
	await expect(edit.getByRole("textbox", { name: "Key Alias", exact: true })).toBeFocused();
	await edit.getByRole("textbox", { name: "Key Alias", exact: true }).fill("Edited alias");
	await expect(page.locator(".create-key-fixture").getByRole("textbox", { name: "Key Alias", exact: true })).toHaveValue("");
});
test("the preserved Tremor numerical control keeps its step increments", async ({ page }) => {
	const box = page.locator(".tremor-number-fixture .ui-input-number");
	await box.getByRole("button", { name: "Increase Value", exact: true }).click();
	await expect(box.getByRole("spinbutton", { name: "Tremor budget" })).toHaveValue("0.01");
	await box.getByRole("button", { name: "Decrease Value", exact: true }).click();
	await expect(box.getByRole("spinbutton")).toHaveValue("0");
});

test("formatted numeric values preserve separators, caret, steps, empty values and blur bounds", async ({ page }) => {
	const input = page.getByRole("spinbutton", { name: "Formatted tokens", exact: true });
	await expect(input).toHaveValue("1,000");
	await input.focus();
	await input.evaluate((control: HTMLInputElement) => control.setSelectionRange(1, 1));
	await page.keyboard.type("5");
	await expect(input).toHaveValue("15,000");
	expect(await input.evaluate((control: HTMLInputElement) => control.selectionStart)).toBe(2);
	await page.keyboard.type("2");
	await expect(input).toHaveValue("152,000");
	await input.press("ArrowUp");
	await expect(input).toHaveValue("152,001");
	await expect(page.getByTestId("formatted-tokens")).toHaveText("152001");
	await input.fill("1000001");
	await input.press("Tab");
	await expect(input).toHaveValue("1,000,000");
	await expect(page.getByTestId("formatted-tokens")).toHaveText("1000000");
	await input.fill("");
	await expect(input).toHaveValue("");
	await expect(page.getByTestId("formatted-tokens")).toHaveText("empty");
});

test("Tremor passwords retain original visibility control without adding an AntD default eye", async ({ page }) => {
	const password = page.getByLabel("Provider password", { exact: true });
	await expect(password).toHaveAttribute("type", "password");
	await expect(page.getByRole("button", { name: "Show Password", exact: true })).toHaveCount(1);
	await page.getByRole("button", { name: "Show Password", exact: true }).click();
	await expect(password).toHaveAttribute("type", "text");
	await expect(page.getByLabel("Native password", { exact: true })).toHaveAttribute("type", "password");
	await page.getByRole("button", { name: "Hide password", exact: true }).click();
	await expect(password).toHaveAttribute("type", "password");
});

test("auto-sized content shrinks after editing", async ({ page }) => {
	const draft = page.getByRole("textbox", { name: "Auto sized draft", exact: true });
	await draft.evaluate((element: HTMLTextAreaElement) => element.style.setProperty("transition", "height 200ms linear", "important"));
	await draft.fill("first\nsecond\nthird\nfourth\nfifth");
	const expanded = (await draft.boundingBox())!.height;
	await draft.fill("a");
	await expect.poll(async () => (await draft.boundingBox())!.height).toBeLessThan(expanded);
});

test("a bordered AntD two-character label retains its readable space and still invokes the action", async ({ page }) => {
	await page.getByRole("button", { name: "接 受", exact: true }).click();
	await expect(page.getByTestId("chinese-accepts")).toHaveText("1");
	for (const name of ["查看", "保存", "取消"]) await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
});

test("all Tremor navigation items remain clickable when their labels must shrink on a narrow screen", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	const navigation = page.getByTestId("narrow-tremor-navigation");
	const last = navigation.getByRole("tab", { name: "Email Alerts", exact: true });
	await last.click();
	await expect(last).toHaveAttribute("aria-selected", "true");
	await expect(page.getByTestId("narrow-tremor-page")).toHaveText("email");
	await navigation.getByRole("tab", { name: "Alerting Types", exact: true }).click();
	await expect(page.getByTestId("narrow-tremor-page")).toHaveText("types");
	await navigation.getByRole("tab", { name: "Logging Callbacks", exact: true }).click();
	await expect(page.getByTestId("narrow-tremor-page")).toHaveText("callbacks");
});

test("an alert projects the supplied icon and retains a default symbol when no icon is supplied", async ({ page }) => {
	await expect(page.getByTestId("custom-alert-icon")).toBeVisible();
	await expect(page.getByTestId("custom-alert")).toContainText("Policy description");
	await expect(page.getByTestId("default-alert").locator(".ui-alert__symbol svg")).toBeVisible();
});
