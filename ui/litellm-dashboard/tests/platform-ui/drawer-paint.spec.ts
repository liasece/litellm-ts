import { expect, test, type Page } from "@playwright/test";
test.use({ viewport: { width: 390, height: 844 }, contextOptions: { reducedMotion: "reduce" } });
const harness = "/ui/tests/drawer-paint/drawer-paint.html";
async function ready(page: Page) {
	await page.evaluate(() => document.fonts.ready);
	await page.waitForTimeout(50);
}
async function outsideDifference(
	page: Page,
	actual: Buffer,
	reference: Buffer,
	bounds: { x: number; y: number; width: number; height: number },
) {
	return page.evaluate(
		async ({ a, b, bounds }) => {
			async function decode(url: string) {
				const image = new Image();
				image.src = url;
				await image.decode();
				const canvas = document.createElement("canvas");
				canvas.width = image.width;
				canvas.height = image.height;
				const context = canvas.getContext("2d");
				if (!context) throw new Error("Canvas unavailable");
				context.drawImage(image, 0, 0);
				return { width: canvas.width, height: canvas.height, pixels: context.getImageData(0, 0, canvas.width, canvas.height).data };
			}
			const native = await decode(a),
				old = await decode(b);
			if (native.width !== old.width || native.height !== old.height) throw new Error("Screenshot dimensions differ");
			let changedPixels = 0,
				maxChannelDifference = 0;
			const samples: { x: number; y: number; actual: number[]; reference: number[] }[] = [];
			for (let y = 0; y < native.height; y++)
				for (let x = 0; x < native.width; x++) {
					if (x >= bounds.x && x < bounds.x + bounds.width && y >= bounds.y && y < bounds.y + bounds.height) continue;
					const p = (y * native.width + x) * 4;
					let delta = 0;
					for (let c = 0; c < 4; c++) delta = Math.max(delta, Math.abs(native.pixels[p + c] - old.pixels[p + c]));
					if (!delta) continue;
					changedPixels++;
					maxChannelDifference = Math.max(maxChannelDifference, delta);
					if (samples.length < 8)
						samples.push({ x, y, actual: [...native.pixels.slice(p, p + 4)], reference: [...old.pixels.slice(p, p + 4)] });
				}
			return { changedPixels, maxChannelDifference, samples };
		},
		{ a: "data:image/png;base64," + actual.toString("base64"), b: "data:image/png;base64," + reference.toString("base64"), bounds },
	);
}
for (const placement of ["right", "left"] as const) {
	test(`the ${placement} phone drawer exterior exactly matches the old ordinary DOM mask and shadow`, async ({ page }, testInfo) => {
		await page.goto(harness + `?renderer=native&placement=${placement}`);
		await page.getByRole("button", { name: "Open drawer", exact: true }).click();
		const drawer = page.getByRole("dialog", { name: "Drawer paint", exact: true });
		await expect(drawer).toBeVisible();
		await ready(page);
		const bounds = await drawer.boundingBox();
		if (!bounds) throw new Error("Drawer bounds missing");
		const actual = await page.screenshot({ animations: "disabled", caret: "hide" });
		await page.goto(harness + `?renderer=reference&placement=${placement}`);
		await page.getByRole("button", { name: "Open drawer", exact: true }).click();
		await ready(page);
		expect(await page.getByRole("dialog", { name: "Drawer paint", exact: true }).boundingBox()).toEqual(bounds);
		const reference = await page.screenshot({ animations: "disabled", caret: "hide" });
		const difference = await outsideDifference(page, actual, reference, bounds);
		await testInfo.attach("native", { body: actual, contentType: "image/png" });
		await testInfo.attach("ordinary-reference", { body: reference, contentType: "image/png" });
		await testInfo.attach("exact-rgba", { body: JSON.stringify(difference, null, 2), contentType: "application/json" });
		expect(difference.changedPixels, JSON.stringify(difference)).toBe(0);
	});
}
test("native modality, focus isolation, Tab, Escape and trusted mask clicks keep their behavior", async ({ page }) => {
	await page.goto(harness + "?renderer=native&maskClosable=false");
	const initial = await page.evaluate(() => document.body.style.overflow);
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
	expect(await page.evaluate(() => document.body.style.overflow)).toBe(initial);
	await open.click();
	await expect(input).toHaveValue("kept value");
	await page.mouse.click(39, 400);
	await expect(drawer).toBeVisible();
	await drawer.getByRole("button", { name: "Allow mask close", exact: true }).click();
	await page.mouse.click(39, 400);
	await expect(drawer).toBeHidden();
	const events = JSON.parse((await page.getByTestId("mask-events").textContent()) ?? "[]") as { trusted: boolean }[];
	expect(events).toHaveLength(2);
	expect(events.every((e) => e.trusted)).toBe(true);
	expect(await page.evaluate(() => document.body.style.overflow)).toBe(initial);
});
test("a nested native left drawer clamps fixed 720px width and preserves foreground and scroll ownership", async ({ page }) => {
	await page.goto(harness);
	const initial = await page.evaluate(() => ({
		overflow: document.body.style.overflow,
		scrollTop: document.scrollingElement?.scrollTop ?? 0,
	}));
	await page.getByRole("button", { name: "Open parent", exact: true }).click();
	const parent = page.locator("dialog.ui-dialog-overlay[open]");
	await expect(parent).toBeVisible();
	await parent.getByRole("button", { name: "Open inner drawer", exact: true }).click();
	const drawer = page.getByRole("dialog", { name: "Nested drawer", exact: true });
	await expect(drawer).toBeVisible();
	expect(await page.locator("dialog:modal").count()).toBe(2);
	const bounds = await drawer.boundingBox();
	if (!bounds) throw new Error("Drawer bounds missing");
	expect(bounds).toEqual({ x: 0, y: 0, width: 390, height: 844 });
	const plane = await drawer.evaluate((e) => {
		const p = getComputedStyle(e, "::before"),
			r = e.getBoundingClientRect();
		return p.content === "none" ? { width: r.width, height: r.height } : { width: parseFloat(p.width), height: parseFloat(p.height) };
	});
	expect(plane).toEqual({ width: bounds.width, height: bounds.height });
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
	expect(await drawer.boundingBox()).toEqual(bounds);
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
	expect(
		await page.evaluate(() => ({ overflow: document.body.style.overflow, scrollTop: document.scrollingElement?.scrollTop ?? 0 })),
	).toEqual(initial);
});
