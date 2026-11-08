import { expect, test } from "@playwright/test";

test("credential deletion requires the exact name, retains the warning card, and clears confirmation on reopen", async ({ page }) => {
	const requests: string[] = [];
	await page.route("**/credentials/Research%20OpenAI", async (route) => {
		requests.push(route.request().method());
		await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
	});
	await page.goto("/ui/tests/models/credentials.html");
	await page.getByRole("button", { name: "Delete credential Research OpenAI", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Delete Credential?", exact: true });
	const confirm = dialog.getByRole("button", { name: "Delete", exact: true });
	await expect(dialog.getByText("Credential Information", { exact: true })).toBeVisible();
	await expect(dialog.locator(".model-resource-delete__information")).toHaveCSS("background-color", "rgb(255, 242, 240)");
	await expect(confirm).toBeDisabled();
	await dialog.getByRole("textbox").fill("Research");
	await expect(confirm).toBeDisabled();
	await page.keyboard.press("Enter");
	expect(requests).toEqual([]);
	await dialog.getByRole("textbox").fill("Research OpenAI");
	await expect(confirm).toBeEnabled();
	await expect(confirm).toHaveCSS("background-color", "rgb(255, 77, 79)");
	await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
	await page.getByRole("button", { name: "Delete credential Research OpenAI", exact: true }).click();
	await expect(dialog.getByRole("textbox")).toHaveValue("");
	await expect(confirm).toBeDisabled();
	await dialog.getByRole("textbox").fill("Research OpenAI");
	await confirm.click();
	await expect(page.getByTestId("credentials-changed")).toHaveText("1");
	expect(requests).toEqual(["DELETE"]);
	await expect(dialog).toBeHidden();
});
