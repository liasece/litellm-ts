import { expect, test, type Locator } from "@playwright/test";

const tags = (root: Locator) => root.locator(".ui-select__values > .ui-select__tag:not(.ui-select__tag--overflow)");
const rest = (root: Locator) => root.locator(".ui-select__values > .ui-select__tag--overflow");
async function contentsFit(root: Locator) {
	return root.locator(".ui-select__values").evaluate((element) => {
		const bounds = element.getBoundingClientRect();
		return Array.from(element.children)
			.filter((child) => !child.classList.contains("ui-select__measurements"))
			.every((child) => {
				const rect = child.getBoundingClientRect();
				return (
					rect.left >= bounds.left && rect.right <= bounds.right + 0.1 && rect.top >= bounds.top && rect.bottom <= bounds.bottom
				);
			});
	});
}

test.beforeEach(async ({ page }) => {
	await page.goto("/ui/tests/platform-ui/select-overflow.html");
});

test("fixed limits fold only the requested tags, recompute after removal, and accept zero", async ({ page }) => {
	const root = page.getByTestId("fixed");
	await expect(tags(root)).toHaveCount(2);
	await expect(rest(root)).toHaveText("+ 2 ...");
	await root.getByRole("button", { name: "Remove Alpha model", exact: true }).click();
	await expect(page.getByTestId("fixed-values")).toHaveText("beta,gamma,delta");
	await expect(tags(root)).toHaveText(["Beta model", "Gamma model"]);
	await expect(rest(root)).toHaveText("+ 1 ...");
	await page.getByRole("spinbutton", { name: "Fixed limit", exact: true }).fill("0");
	await expect(tags(root)).toHaveCount(0);
	await expect(rest(root)).toHaveText("+ 3 ...");
	await root.getByRole("combobox").press("Backspace");
	await expect(page.getByTestId("fixed-values")).toHaveText("beta,gamma");
	await expect(rest(root)).toHaveText("+ 2 ...");
});

test("responsive tags resize with their container and expose the exact omitted count without changing selected values", async ({
	page,
}) => {
	const root = page.getByTestId("responsive");
	await expect.poll(() => tags(root).count()).toBeGreaterThan(0);
	await expect.poll(() => tags(root).count()).toBeLessThan(4);
	const initial = await tags(root).count();
	await expect(rest(root)).toHaveText("+ " + (4 - initial) + " ...");
	await expect.poll(() => contentsFit(root)).toBe(true);
	await page.getByRole("spinbutton", { name: "Container width", exact: true }).fill("180");
	await expect.poll(() => tags(root).count()).toBeLessThan(initial);
	await expect.poll(() => contentsFit(root)).toBe(true);
	await page.getByRole("spinbutton", { name: "Container width", exact: true }).fill("700");
	await expect(tags(root)).toHaveCount(4);
	await expect(rest(root)).toHaveCount(0);
	await expect(page.getByTestId("responsive-values")).toHaveText("alpha,beta,gamma,delta");
	await expect.poll(() => contentsFit(root)).toBe(true);
});

test("updated option text and a custom remainder are measured before choosing visible tags", async ({ page }) => {
	const root = page.getByTestId("custom");
	await expect.poll(() => tags(root).count()).toBeGreaterThan(0);
	const initial = await tags(root).count();
	await expect(rest(root)).toHaveText("+" + (4 - initial) + " more models");
	await page.getByRole("button", { name: "Longer model labels", exact: true }).click();
	await expect.poll(() => tags(root).count()).toBeLessThan(initial);
	await expect(rest(root)).toHaveText("+" + (4 - (await tags(root).count())) + " more models");
	await expect.poll(() => contentsFit(root)).toBe(true);
});

test("typing reserves real search width and keyboard removal still reaches folded selections", async ({ page }) => {
	const root = page.getByTestId("responsive"),
		input = root.getByRole("combobox");
	await expect.poll(() => tags(root).count()).toBeGreaterThan(0);
	const initial = await tags(root).count();
	await input.fill("a substantially longer query");
	await expect.poll(() => tags(root).count()).toBeLessThan(initial);
	await expect.poll(() => contentsFit(root)).toBe(true);
	await input.press("Backspace");
	await expect(page.getByTestId("responsive-values")).toHaveText("alpha,beta,gamma,delta");
	await input.fill("");
	await input.press("Backspace");
	await expect(page.getByTestId("responsive-values")).toHaveText("alpha,beta,gamma");
	await input.fill("Delta");
	await input.press("Enter");
	await expect(page.getByTestId("responsive-values")).toHaveText("alpha,beta,gamma,delta");
	await input.press("Escape");
	await root.hover();
	await root.getByRole("button", { name: "Clear selection", exact: true }).click();
	await expect(page.getByTestId("responsive-values")).toHaveText("");
	await expect(tags(root)).toHaveCount(0);
	await expect(rest(root)).toHaveCount(0);
});

test("disabled selections cannot be removed and Backspace skips a disabled final option", async ({ page }) => {
	const root = page.getByTestId("locked"),
		input = root.getByRole("combobox");
	await input.press("Backspace");
	await expect(page.getByTestId("locked-values")).toHaveText("alpha,omega");
	await input.press("Backspace");
	await expect(page.getByTestId("locked-values")).toHaveText("omega");
	await expect(root.getByRole("button", { name: "Remove Omega model", exact: true })).toHaveCount(0);
	await expect(rest(root)).toHaveCount(0);
	await page.getByRole("button", { name: "Toggle disabled", exact: true }).click();
	await expect(input).toBeDisabled();
	await expect(root.getByRole("button", { name: /^Remove/ })).toHaveCount(0);
});

test("an open responsive selector follows a container-only resize and keeps every omitted option selectable", async ({ page }) => {
	const root = page.getByTestId("responsive"),
		input = root.getByRole("combobox");
	await input.press("ArrowDown");
	const popup = page.getByRole("listbox");
	await expect(popup.getByRole("option")).toHaveCount(5);
	await page.getByRole("spinbutton", { name: "Container width", exact: true }).fill("180");
	await popup.getByRole("option", { name: "Delta model", exact: true }).click();
	await expect(page.getByTestId("responsive-values")).toHaveText("alpha,beta,gamma");
	await expect(rest(root)).toHaveText("+ " + (3 - (await tags(root).count())) + " ...");
	await input.press("Escape");
	await expect(popup).toBeHidden();
	await expect(input).toBeFocused();
});

test("Access model fields forward responsive limits, the original omitted-values tooltip, and actual change events", async ({ page }) => {
	const root = page.getByTestId("access");
	await expect.poll(() => tags(root).count()).toBeGreaterThan(0);
	await expect.poll(() => tags(root).count()).toBeLessThan(4);
	const shown = await tags(root).count();
	await expect(rest(root)).toHaveText("+" + (4 - shown) + " more");
	await rest(root).hover();
	const tooltip = page.getByRole("tooltip");
	await expect(tooltip).toHaveText(["alpha", "beta", "gamma", "delta"].slice(shown).join(", "));
	await root.getByRole("button", { name: "Remove Alpha model", exact: true }).click();
	await expect(page.getByTestId("access-values")).toHaveText('["beta","gamma","delta"]');
	await expect(page.getByTestId("access-change")).toHaveText('["beta","gamma","delta"]');
	await page.getByRole("spinbutton", { name: "Container width", exact: true }).fill("700");
	await expect(tags(root)).toHaveCount(3);
	await expect(rest(root)).toHaveCount(0);
});

test("one long selected model remains a removable ellipsized tag without an empty remainder", async ({ page }) => {
	const root = page.getByTestId("long-model");
	await expect(tags(root)).toHaveCount(1);
	await expect(rest(root)).toHaveCount(0);
	await expect.poll(() => contentsFit(root)).toBe(true);
	await expect(page.getByTestId("long-values")).toHaveText("long-deployment");
	await root.getByRole("button", { name: /^Remove A deployment/ }).click();
	await expect(page.getByTestId("long-values")).toHaveText("");
	await expect(rest(root)).toHaveCount(0);
});

test("default multiple selectors keep every tag, original wrap rows and an independent empty placeholder", async ({ page }) => {
	const root = page.getByTestId("expanded"),
		control = root.locator(".ui-select"),
		input = root.getByRole("combobox");
	await expect(tags(root)).toHaveCount(4);
	await expect(rest(root)).toHaveCount(0);
	await page.getByRole("spinbutton", { name: "Container width", exact: true }).fill("180");
	await expect.poll(async () => (await control.boundingBox())!.width).toBe(180);
	await expect(tags(root)).toHaveCount(4);
	await root.hover();
	await root.getByRole("button", { name: "Clear selection", exact: true }).click();
	await expect(page.getByTestId("expanded-values")).toHaveText("");
	const placeholder = control.locator(".ui-select__placeholder");
	await expect(placeholder).toHaveText("Select several model deployments");
	await input.fill("Gamma");
	await expect(placeholder).toHaveCount(0);
	await input.press("Enter");
	await expect(page.getByTestId("expanded-values")).toHaveText("gamma");
	await expect(rest(root)).toHaveCount(0);
});

test("a searchable AntD credential retains its original inner focus ring and SVG clear action", async ({ page }) => {
	const root = page.getByTestId("focused-credential"),
		control = root.locator(".ui-select"),
		input = root.getByRole("combobox");
	await input.focus();
	await input.fill("TypeScript");
	await input.press("Enter");
	await expect(control.locator(".ui-select__single")).toHaveText("TypeScript");
	await root.hover();
	const clear = root.getByRole("button", { name: "Clear selection", exact: true });
	await expect(clear.locator("svg")).toHaveCount(1);
	await clear.click();
	await expect(input).toHaveValue("");
	await expect(input).toHaveAttribute("placeholder", "Search credentials");
	await expect(control.locator(".ui-select__single")).toHaveCount(0);
});
