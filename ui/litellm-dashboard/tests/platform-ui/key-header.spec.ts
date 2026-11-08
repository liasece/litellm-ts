import { expect, test } from "@playwright/test";
test.use({ permissions: ["clipboard-read", "clipboard-write"] });

test("the copy control inherits the title font and copies the full alias", async ({ page }) => {
	await page.goto("/ui/tests/keys/header.html");
	const title = page.locator(".vk-detail-heading h3");
	expect((await title.boundingBox())!.height).toBe(32);
	const copy = page.getByRole("button", { name: "Copy Key Alias", exact: true });
	await expect(copy.locator("svg")).toHaveCSS("width", "24px");
	await copy.click();
	await expect(copy).toHaveAttribute("title", "Copied!");
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("Research API");
});

test("a narrow copied identity preserves the original wrapped layout and copies its full value", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/ui/tests/keys/header.html");
	const title = page.locator(".vk-detail-heading h3");
	expect((await title.boundingBox())!.height).toBe(384);
	const facts = page.locator(".vk-key-facts");
	expect((await facts.boundingBox())!.height).toBe(1117);
	const identity = page.locator(".vk-key-fact-value-text[aria-label='visual-admin']");
	await expect(identity).toHaveText("...");
	const copy = page.getByRole("button", { name: "Copy User ID", exact: true });
	await copy.click();
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("visual-admin");
});
