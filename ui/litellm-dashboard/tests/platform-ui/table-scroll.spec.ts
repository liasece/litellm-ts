import { expect, test } from "@playwright/test";

test("table body keeps its configured scroll space when a responsive header changes height", async ({ page }) => {
	await page.goto("/ui/tests/platform-ui/controls.html");
	const fixture = page.getByTestId("body-height-fixture");
	const scroll = fixture.locator(".ui-table-scroll");
	const header = fixture.getByRole("columnheader");
	const firstHeight = (await header.boundingBox())!.height;
	async function bodySpace() {
		return scroll.evaluate((element) => element.clientHeight - element.querySelector("thead")!.getBoundingClientRect().height);
	}
	await expect.poll(bodySpace).toBeCloseTo(80, 0);
	await fixture.evaluate((element) => {
		element.style.width = "100px";
	});
	await expect.poll(async () => (await header.boundingBox())!.height).toBeGreaterThan(firstHeight);
	await expect.poll(bodySpace).toBeCloseTo(80, 0);
	await fixture.scrollIntoViewIfNeeded();
	await scroll.evaluate((element) => {
		element.scrollTop = element.scrollHeight;
	});
	await expect(fixture.getByText("Body row 10", { exact: true })).toBeInViewport();
	expect(Math.abs((await header.boundingBox())!.y - (await scroll.boundingBox())!.y)).toBeLessThan(1);
});
