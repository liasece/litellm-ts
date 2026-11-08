import { expect, test } from "@playwright/test";
test.beforeEach(async ({ page }) => {
	await page.goto("/ui/tests/platform-ui/controls.html");
});
test("alert icon, action and close spacing follows the actual AntD layout rather than applying a root gap to every child", async ({
	page,
}) => {
	for (const [id, iconMargin] of [
		["action-alert", 8],
		["description-action-alert", 12],
	] as const) {
		const alert = page.getByTestId(id),
			icon = await alert.locator(".ui-alert__symbol").boundingBox(),
			content = await alert.locator(".ui-alert__content").boundingBox(),
			action = await alert.locator(".ui-alert__action").boundingBox();
		await expect(alert).toHaveCSS("column-gap", "0px");
		expect(content!.x - icon!.x - icon!.width).toBe(iconMargin);
		expect(action!.x - content!.x - content!.width).toBe(0);
		if (id === "action-alert") {
			const close = await alert.getByRole("button", { name: "Close", exact: true }).boundingBox();
			expect(close!.x - action!.x - action!.width).toBe(8);
			await alert.getByRole("button", { name: "Close", exact: true }).click();
			await expect(page.getByTestId("alert-closes")).toHaveText("1");
		}
	}
});
