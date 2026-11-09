import { expect, test } from "@playwright/test";
test.use({ viewport: { width: 390, height: 844 }, contextOptions: { reducedMotion: "reduce" } });
const harness = "/ui/tests/drawer-paint/drawer-paint.html";
test("native modality, focus isolation, Tab, Escape and mask clicks keep their behavior", async ({ page }) => {
	await page.goto(harness + "?renderer=native&maskClosable=false");
	const open = page.getByRole("button", { name: "Open drawer", exact: true });
	await open.click();
	const drawer = page.getByRole("dialog", { name: "Drawer paint", exact: true });
	expect(await drawer.evaluate((e) => e.matches(":modal"))).toBe(true);
	await page.getByRole("button", { name: "Background action", exact: true }).evaluate((e) => e.focus());
	expect(await drawer.evaluate((e) => e.contains(document.activeElement))).toBe(true);
	const input = drawer.getByRole("textbox", { name: "Drawer field", exact: true });
	await input.fill("kept value");
	await input.focus();
	await page.keyboard.press("Tab");
	await expect(drawer.getByRole("button", { name: "Drawer action", exact: true })).toBeFocused();
	await page.keyboard.press("Shift+Tab");
	await expect(input).toBeFocused();
	await page.keyboard.press("Escape");
	await expect(drawer).toBeHidden();
	await open.click();
	await expect(input).toHaveValue("kept value");
	await page.mouse.click(39, 400);
	await expect(drawer).toBeVisible();
	await drawer.getByRole("button", { name: "Allow mask close", exact: true }).click();
	await page.mouse.click(39, 400);
	await expect(drawer).toBeHidden();
});
test("a nested native left drawer preserves foreground editing and scroll ownership", async ({ page }) => {
	await page.goto(harness);
	await page.getByRole("button", { name: "Open parent", exact: true }).click();
	const parent = page.locator("dialog.ui-dialog-overlay[open]");
	await expect(parent).toBeVisible();
	await parent.getByRole("button", { name: "Open inner drawer", exact: true }).click();
	const drawer = page.getByRole("dialog", { name: "Nested drawer", exact: true });
	await expect(drawer).toBeVisible();
	expect(await page.locator("dialog:modal").count()).toBe(2);
	const header = drawer.locator(".ui-drawer__header"),
		body = drawer.locator(".ui-drawer__body");
	const headerBefore = await header.boundingBox();
	const input = drawer.getByRole("textbox", { name: "Drawer field", exact: true });
	await input.fill("foreground still editable");
	await expect(input).toHaveValue("foreground still editable");
	const outerBefore = await page.evaluate(() => ({
		document: document.scrollingElement?.scrollTop ?? 0,
		parent: document.querySelector("dialog.ui-dialog-overlay[open]")?.scrollTop ?? 0,
	}));
	await body.hover();
	await page.mouse.wheel(0, 400);
	await expect.poll(() => body.evaluate((e) => e.scrollTop)).toBeGreaterThan(0);
	expect(await header.boundingBox()).toEqual(headerBefore);
	expect(
		await page.evaluate(() => ({
			document: document.scrollingElement?.scrollTop ?? 0,
			parent: document.querySelector("dialog.ui-dialog-overlay[open]")?.scrollTop ?? 0,
		})),
	).toEqual(outerBefore);
	await page.keyboard.press("Escape");
	await expect(drawer).toBeHidden();
	expect(await parent.evaluate((e) => e.matches(":modal"))).toBe(true);
	expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");
	await page.keyboard.press("Escape");
	await expect(parent).toBeHidden();
});
