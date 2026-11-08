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
	await expect(drawer).toHaveClass(/request-details-fixture/);
	await expect(drawer).toHaveAttribute("data-panel", "request");
	await expect(drawer).toHaveCSS("padding", "0px");
	const close = drawer.getByRole("button", { name: "Close", exact: true });
	await expect(close).toHaveCSS("width", "24px");
	await expect(close).toHaveCSS("height", "24px");
	await expect(close).toHaveCSS("margin-inline-end", "8px");
	await expect(close.locator("svg")).toHaveCSS("width", "16px");
	await expect(drawer.locator(".ui-drawer__title")).toHaveCSS("min-width", "auto");
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

test("icon-only AntD controls retain the original compact hit targets", async ({ page }) => {
	for (const [label, size] of [
		["Compact settings", 32],
		["Small compact settings", 24],
		["Large compact settings", 40],
	] as const) {
		const bounds = await page.getByRole("button", { name: label, exact: true }).boundingBox();
		expect(bounds?.width).toBe(size);
		expect(bounds?.height).toBe(size);
	}
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
test("long key forms scroll the overlay and auto-size inputs keep wrapper sizing", async ({ page }) => {
	const input = page.getByRole("textbox", { name: "Auto sized draft" });
	await input.fill(Array.from({ length: 12 }, (_, index) => "line " + index).join("\n"));
	const wrapper = input.locator("..");
	await expect(wrapper).toHaveClass(/custom-draft-size/);
	expect((await wrapper.boundingBox())?.width).toBe(180);
	await expect(input).toHaveCSS("overflow-y", "auto");
	await expect(input).toHaveCSS("resize", "none");
	await page.getByRole("button", { name: "Open long form", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Long key form", exact: true });
	await expect(dialog).toBeVisible();
	await expect(dialog.locator(".ui-dialog--overlay-panel")).toHaveCSS("overflow-y", "visible");
	await dialog.getByRole("button", { name: "Save long form", exact: true }).click();
	await expect(dialog).toBeHidden();
});

test("shared notifications retain original geometry and stay visible over native modals", async ({ page }) => {
	await page.getByRole("button", { name: "Notify error", exact: true }).click();
	const error = page.getByRole("alert").filter({ hasText: "Fixture notification" });
	await expect(error).toBeVisible();
	const bounds = await error.boundingBox(),
		size = page.viewportSize();
	expect(bounds?.width).toBe(384);
	expect(bounds?.x).toBe((size?.width || 0) - 408);
	expect(bounds?.y).toBe(24);
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
test("the preserved Tremor numerical control keeps horizontal steps and full width", async ({ page }) => {
	const box = page.locator(".tremor-number-fixture .ui-input-number");
	await expect(box).toHaveClass(/ui-input-number--tremor/);
	expect((await box.boundingBox())?.width).toBe(400);
	await box.getByRole("button", { name: "Increase Value", exact: true }).click();
	await expect(box.getByRole("spinbutton", { name: "Tremor budget" })).toHaveValue("0.01");
	const down = await box.getByRole("button", { name: "Decrease Value", exact: true }).boundingBox(),
		up = await box.getByRole("button", { name: "Increase Value", exact: true }).boundingBox();
	expect(down?.y).toBe(up?.y);
	expect(up!.x).toBe(down!.x + down!.width);
	await page.locator(".tremor-number-fixture").evaluate((element: HTMLElement) => (element.style.width = "326px"));
	await expect(box).toHaveCSS("width", "326px");
	expect((await box.getByRole("spinbutton").boundingBox())!.width).toBe(264.640625);
	expect((await box.getByRole("button", { name: "Decrease Value", exact: true }).boundingBox())!.width).toBe(29.6875);
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
test("a filtered CRUD group still toggles all tools in that group", async ({ page }) => {
	await expect(page.getByRole("checkbox", { name: "get_users", exact: true })).toBeVisible();
	await expect(page.getByRole("checkbox", { name: "get_reports", exact: true })).toHaveCount(0);
	const all = page.getByRole("checkbox", { name: "Allow all read tools", exact: true });
	await all.uncheck();
	await expect(page.getByTestId("allowed-tools")).toHaveText("");
	await all.check();
	await expect(page.getByTestId("allowed-tools")).toHaveText("get_users,get_reports");
	await page.getByRole("textbox", { name: "Filter tools", exact: true }).fill("");
	await expect(page.getByRole("checkbox", { name: "get_reports", exact: true })).toBeChecked();
});

test("auto-sized content shrinks after editing even when its height inherits a transition", async ({ page }) => {
	const draft = page.getByRole("textbox", { name: "Auto sized draft", exact: true });
	await draft.evaluate((element: HTMLTextAreaElement) => element.style.setProperty("transition", "height 200ms linear", "important"));
	await draft.fill("first\nsecond\nthird\nfourth\nfifth");
	const expanded = (await draft.boundingBox())!.height;
	await draft.fill("a");
	await expect.poll(async () => (await draft.boundingBox())!.height).toBeLessThan(expanded);
	expect(
		await draft.evaluate((element: HTMLTextAreaElement) => ({
			value: element.style.getPropertyValue("transition"),
			priority: element.style.getPropertyPriority("transition"),
		})),
	).toEqual({ value: "height 200ms linear", priority: "important" });
});

test("a narrow modal preserves the original two scroll containers without an opening focus jump", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	const trigger = page.getByRole("button", { name: "Open long form", exact: true });
	await trigger.click();
	const dialog = page.getByRole("dialog", { name: "Long key form", exact: true }),
		panel = dialog.locator(".ui-dialog--overlay-panel");
	await expect(dialog).toBeVisible();
	expect((await panel.boundingBox())?.y).toBe(108);
	expect((await panel.boundingBox())?.height).toBe(820);
	expect(await dialog.evaluate((e) => e.scrollTop)).toBe(0);
	expect(await dialog.evaluate((e) => e.scrollHeight)).toBe(940);
	await expect(panel).toHaveCSS("overflow-y", "auto");
	expect(await panel.evaluate((e) => e.scrollHeight > e.clientHeight)).toBe(true);
	await expect(panel).toBeFocused();
	await panel.evaluate((e) => {
		e.scrollTop = e.scrollHeight;
	});
	await dialog.evaluate((e) => {
		e.scrollTop = e.scrollHeight;
	});
	await expect(dialog.getByRole("button", { name: "Save long form", exact: true })).toBeInViewport();
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
	await expect(trigger).toBeFocused();
});

test("the active Tremor tab keeps its full underline outside the list padding box", async ({ page }) => {
	const navigation = page.getByTestId("tremor-navigation"),
		list = navigation.getByRole("tablist"),
		active = navigation.getByRole("tab", { name: "Overview", exact: true });
	await active.scrollIntoViewIfNeeded();
	const box = await active.boundingBox();
	expect(box).not.toBeNull();
	const selected = await page.evaluate(
		({ x, y }) => document.elementFromPoint(x, y)?.closest("[role=tab]")?.getAttribute("aria-selected"),
		{ x: box!.x + box!.width / 2, y: box!.y + box!.height - 0.25 },
	);
	expect(selected).toBe("true");
	await expect(list).toHaveCSS("overflow-x", "clip");
	await expect(list).toHaveCSS("overflow-y", "visible");
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

test("an AntD inline icon remains beside its text and keeps the button action", async ({ page }) => {
	const button = page.getByTestId("inline-icon-button");
	const icon = (await button.locator("svg").boundingBox())!;
	const label = (await page.getByTestId("inline-icon-label").boundingBox())!;
	expect(Math.abs(icon.y + icon.height / 2 - label.y - label.height / 2)).toBeLessThan(0.5);
	expect(label.x - icon.x - icon.width).toBe(8);
	await button.click();
	await expect(page.getByTestId("inline-clicks")).toHaveText("1");
});

test("message-only alerts retain single-line and wrapped-message heights without a description gap", async ({ page }) => {
	await expect.poll(async () => (await page.getByTestId("single-line-alert").boundingBox())!.height).toBe(40);
	await expect.poll(async () => (await page.getByTestId("two-line-alert").boundingBox())!.height).toBe(62);
});
