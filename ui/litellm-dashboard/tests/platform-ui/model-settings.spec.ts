import { expect, test } from "@playwright/test";

test("model numerical settings retain the existing decimal step and cache-control label and switch use separate rows", async ({ page }) => {
	await page.route("**/builtin-capabilities", (route) => route.fulfill({ json: { capabilities: {} } }));
	await page.goto("/ui/tests/models/settings.html");
	const tpm = page.getByRole("spinbutton", { name: "TPM (Tokens per Minute)", exact: true });
	await expect(tpm).toHaveAttribute("placeholder", "Enter TPM");
	await tpm.press("ArrowUp");
	await expect(tpm).toHaveValue("10.01");
	await expect(page.getByTestId("model-tpm")).toHaveText("10.01");
	const cache = page.getByRole("switch", { name: "Cache Control Injection Points", exact: true });
	const field = page.locator(".model-cache-control-field");
	const label = (await field.locator(".model-field__label").boundingBox())!,
		switchBox = (await cache.boundingBox())!;
	expect(switchBox.y).toBeGreaterThanOrEqual(label.y + label.height);
	await expect(field.locator(".ui-popover-anchor")).toHaveCount(1);
	await cache.click();
	await expect(page.getByTestId("model-cache-control")).toHaveText("true");
	await page.getByRole("button", { name: "Add Injection Point", exact: true }).click();
	await expect(page.getByPlaceholder("Optional", { exact: true })).toBeVisible();
});
