import { expect, test } from "@playwright/test";

// 仪表盘同时通过局域网 HTTP 入口访问，此时浏览器不提供异步剪贴板；
// 写入权限被拒绝时也一样。复制控件必须继续工作，而不是静默失败。
test.use({ permissions: ["clipboard-read", "clipboard-write"] });

const aliasButton = 'button[aria-label="Copy Key Alias"]';

test("copies through the legacy path when the async clipboard is unavailable", async ({ page }) => {
	await page.addInitScript(() => {
		Object.defineProperty(Navigator.prototype, "clipboard", { configurable: true, get: () => undefined });
		const state = window as unknown as { __copyEvents: string[] };
		state.__copyEvents = [];
		document.addEventListener("copy", () => state.__copyEvents.push("copy"));
	});
	await page.goto("/ui/tests/keys/header.html");
	await expect(page.getByRole("button", { name: "Copy Key Alias", exact: true })).toBeVisible();
	await page.locator(aliasButton).click();
	await expect(page.locator(aliasButton)).toHaveAttribute("title", "Copied!");
	expect(await page.evaluate(() => (window as unknown as { __copyEvents: string[] }).__copyEvents.length)).toBe(1);
});

test("falls back when the browser rejects the async clipboard write", async ({ page }) => {
	await page.addInitScript(() => {
		Object.defineProperty(navigator.clipboard, "writeText", {
			configurable: true,
			value: () => Promise.reject(new DOMException("Write permission denied", "NotAllowedError")),
		});
	});
	await page.goto("/ui/tests/keys/header.html");
	await page.locator(aliasButton).click();
	await expect(page.locator(aliasButton)).toHaveAttribute("title", "Copied!");
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("Research API");
});

test("copies from a modal dialog when the fallback has to focus inside the dialog", async ({ page }) => {
	await page.addInitScript(() => {
		Object.defineProperty(navigator.clipboard, "writeText", {
			configurable: true,
			value: () => Promise.reject(new DOMException("Write permission denied", "NotAllowedError")),
		});
	});
	await page.goto("/ui/tests/platform-ui/copy-dialog.html");
	await page.getByRole("button", { name: "Open key dialog", exact: true }).click();
	const copy = page.locator(".vk-secret-display button");
	await copy.click();
	await expect(copy).toHaveText("Copied!");
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("sk-dialog-secret");
});
