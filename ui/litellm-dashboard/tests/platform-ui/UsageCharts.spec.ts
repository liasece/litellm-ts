import { test, expect } from "@playwright/test";
test("renders legacy bar geometry through ECharts and forwards actual pointer selection", async ({ page }) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("/ui/tests/platform-ui/usage-chart.html");
	const bars = page.locator(".daily .echarts svg path[fill='#06b6d4']");
	await expect(bars).toHaveCount(3);
	const shapes = await bars.evaluateAll((elements) =>
		elements.map((element) => {
			const box = (element as SVGGraphicsElement).getBBox();
			return { x: box.x, y: box.y, width: box.width, height: box.height };
		}),
	);
	expect(shapes[0].x).toBeCloseTo(137.03333333333333, 3);
	expect(shapes[0].width).toBe(136);
	expect(shapes[0].y).toBe(194.75);
	expect(shapes[0].height).toBe(63.25);
	const target = await bars.nth(1).boundingBox();
	expect(target).not.toBeNull();
	const point = { x: target!.x + target!.width / 2, y: target!.y + target!.height / 2 };
	await page.mouse.move(point.x, point.y);
	await expect(page.getByTestId("chart-tooltip")).toHaveText("2026-11-06");
	await expect(bars.nth(1)).toHaveCSS("fill", "rgb(6, 182, 212)");
	await page.mouse.click(point.x, point.y);
	await expect(page.getByTestId("selection")).toHaveText("2026-11-06");
	expect(errors).toEqual([]);
});
test("retains numeric labels and cache annotations at the original ranking bar positions", async ({ page }) => {
	await page.goto("/ui/tests/platform-ui/usage-chart.html");
	await expect(page.locator(".ranking .echarts svg path[fill='#06b6d4']")).toHaveCount(2);
	const annotations = page.locator(".ranking .usage-chart-annotations foreignObject");
	await expect(annotations).toHaveCount(2);
	await expect(annotations.first()).toHaveAttribute("x", "168");
	await expect(annotations.first()).toHaveAttribute("height", "16");
	await expect(page.locator(".ranking .usage-native-bar-axes")).toContainText("$8");
	await expect(page.locator(".ranking .usage-native-bar-axes")).toContainText("claude-sonnet-4");
	await expect(page.locator(".ranking .usage-native-bar-axes")).not.toContainText("gpt-4.1");
});
test("cleans up chart and resize listeners across repeated mounting", async ({ page }) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("/ui/tests/platform-ui/usage-chart.html");
	for (let index = 0; index < 3; index++) {
		await expect(page.locator(".daily .echarts")).toBeVisible();
		await page.getByRole("button", { name: "Toggle charts", exact: true }).click();
		await expect(page.locator(".daily")).toHaveCount(0);
		await page.setViewportSize({ width: 900 + index * 20, height: 800 });
		await page.getByRole("button", { name: "Toggle charts", exact: true }).click();
	}
	await expect(page.locator(".daily .echarts svg path[fill='#06b6d4']")).toHaveCount(3);
	expect(errors).toEqual([]);
});

test("keeps area paths, gradient and nested-series dots while hovering the entire plot", async ({ page }) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("/ui/tests/platform-ui/usage-chart.html");
	await expect(page.locator(".area .echarts svg path[stroke='#3b82f6']")).toHaveCount(1);
	await expect(page.locator(".area .echarts svg linearGradient stop").first()).toHaveAttribute("offset", "5%");
	await expect(page.locator(".area .echarts svg path[fill^='url(']").first()).toHaveAttribute("fill-opacity", "0.6");
	await expect(page.locator(".area .usage-native-bar-axes")).toContainText("10,000");
	const chart = page.locator(".area .usage-chart");
	await chart.scrollIntoViewIfNeeded();
	const bounds = await chart.boundingBox();
	expect(bounds).not.toBeNull();
	await page.mouse.move(bounds!.x + 286.5, bounds!.y + 12);
	await expect(page.locator(".usage-chart-tooltip")).toContainText("Day 2");
	await expect(page.locator(".usage-chart-tooltip")).toContainText("Total Tokens");
	await expect(page.locator(".usage-chart-tooltip")).toContainText("6,000");
	await page.mouse.move(1, 1);
	await expect(page.locator(".usage-chart-tooltip")).toHaveCount(0);
	expect(errors).toEqual([]);
});
test("preserves top legend spacing and calls formatters with a value only", async ({ page }) => {
	await page.goto("/ui/tests/platform-ui/usage-chart.html");
	await expect(page.locator(".legend .usage-native-legend")).toContainText("spend");
	await expect(page.locator(".legend .usage-native-bar-axes > g").first().locator("line").last()).toHaveAttribute("y1", "65");
	await expect(page.locator(".legend .usage-native-bar-axes")).toContainText("8");
	await expect(page.locator(".legend .usage-native-bar-axes")).not.toContainText("8.0000");
	const chart = page.locator(".daily .usage-chart");
	await chart.scrollIntoViewIfNeeded();
	const bounds = await chart.boundingBox();
	await page.mouse.move(bounds!.x + 375.5, bounds!.y + 10);
	await expect(page.getByTestId("chart-tooltip")).toHaveText("2026-11-06");
});

test("updates the hovered category after resizing without requiring another pointer move", async ({ page }) => {
	await page.goto("/ui/tests/platform-ui/usage-chart.html");
	await expect(page.locator(".daily .echarts svg path[fill='#06b6d4']")).toHaveCount(3);
	const chart = page.locator(".daily .usage-chart"),
		bounds = await chart.boundingBox();
	expect(bounds).not.toBeNull();
	await page.mouse.move(bounds!.x + 210, bounds!.y + 10);
	await expect(page.getByTestId("chart-tooltip")).toHaveText("2026-11-05");
	await page.locator(".daily").evaluate((element) => {
		element.style.width = "330px";
	});
	await expect(page.getByTestId("chart-tooltip")).toHaveText("2026-11-06");
});

test("ranking drawing follows native SVG meet semantics at fractional widths and actual pointer selection remains correct", async ({
	page,
}) => {
	await page.goto("/ui/tests/platform-ui/usage-chart.html");
	const ranking = page.locator(".ranking");
	const chart = ranking.locator(".usage-chart");
	const bars = ranking.locator(".echarts svg path");
	await expect(bars).toHaveCount(2);
	for (const width of [452.671875, 453.328125, 320.671875]) {
		await ranking.evaluate((element, value) => {
			element.style.width = value + "px";
		}, width);
		await expect.poll(async () => chart.evaluate((root) => root.clientWidth)).toBe(Math.round(width));
		await expect
			.poll(async () =>
				chart.evaluate((root) => {
					const bar = root.querySelector<SVGGraphicsElement>(".echarts svg path");
					const axes = root.querySelector<SVGSVGElement>(".usage-native-bar-axes");
					if (!bar || !axes) return 1;
					const namespace = "http://www.w3.org/2000/svg";
					const reference = document.createElementNS(namespace, "svg");
					reference.setAttribute("viewBox", "0 0 " + root.clientWidth + " 80");
					Object.assign(reference.style, {
						position: "absolute",
						inset: "0",
						width: "100%",
						height: "100%",
						visibility: "hidden",
						pointerEvents: "none",
					});
					const shape = document.createElementNS(namespace, "rect");
					const box = bar.getBBox();
					for (const key of ["x", "y", "width", "height"] as const) shape.setAttribute(key, String(box[key]));
					reference.append(shape);
					root.append(reference);
					const expected = shape.getBoundingClientRect(),
						actual = bar.getBoundingClientRect();
					reference.remove();
					return Math.max(
						Math.abs(expected.x - actual.x),
						Math.abs(expected.y - actual.y),
						Math.abs(expected.width - actual.width),
						Math.abs(expected.height - actual.height),
					);
				}),
			)
			.toBeLessThan(0.001);
		await expect(bars.nth(1)).toBeVisible();
		const graphic = await ranking.locator(".echarts svg").elementHandle();
		const bar = (await bars.nth(1).boundingBox())!;
		await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2);
		await expect(page.locator(".usage-chart-tooltip")).toContainText("claude-sonnet-4");
		await expect(bars.nth(1)).toHaveCSS("fill", "rgb(6, 182, 212)");
		await expect(ranking.locator(".usage-chart-cursor rect")).toBeVisible();
		await page.mouse.click(bar.x + bar.width / 2, bar.y + bar.height / 2);
		await expect(page.getByTestId("selection")).toHaveText("claude-sonnet-4");
		expect(await graphic!.evaluate((element) => element.isConnected)).toBe(true);
		const scale = await chart.evaluate((root) => {
			const annotation = root.querySelector<SVGGraphicsElement>(".usage-chart-annotations foreignObject");
			const bar = root.querySelector<SVGGraphicsElement>(".echarts svg path");
			if (!annotation || !bar) throw new Error("Missing ranking layers");
			const source = bar.getBBox(),
				actual = bar.getBoundingClientRect(),
				label = annotation.getBoundingClientRect();
			return { scale: actual.height / source.height, labelHeight: label.height, labelX: label.x, barX: actual.x };
		});
		expect(scale.labelHeight).toBeCloseTo(16 * scale.scale, 3);
		expect(scale.labelX - scale.barX).toBeCloseTo(8 * scale.scale, 3);
		const tooltip = await page.locator(".usage-chart-tooltip").evaluate((element) => {
			const style = getComputedStyle(element),
				transform = new DOMMatrixReadOnly(style.transform);
			return { a: transform.a, d: transform.d, fontSize: style.fontSize, portal: element.parentElement === document.body };
		});
		expect(tooltip).toEqual({ a: 1, d: 1, fontSize: "12px", portal: true });
	}
});

test("ranking viewport changes refresh the drawing and preserve the separate HTML legend", async ({ page }) => {
	await page.goto("/ui/tests/platform-ui/usage-chart.html?rankingLegend");
	const ranking = page.locator(".ranking"),
		chart = ranking.locator(".usage-chart");
	await expect(ranking.locator(".echarts svg path")).toHaveCount(2);
	await ranking.evaluate((element) => {
		element.style.width = "452.671875px";
	});
	await expect.poll(async () => chart.evaluate((root) => root.getBoundingClientRect().width)).toBeCloseTo(452.671875, 3);
	const bar = (await ranking.locator(".echarts svg path").nth(1).boundingBox())!;
	await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2);
	await expect(page.locator(".usage-chart-tooltip")).toContainText("claude-sonnet-4");
	await ranking.evaluate((element) => {
		element.style.width = "453.328125px";
	});
	await expect
		.poll(async () =>
			chart.evaluate((root) => {
				const bounds = root.getBoundingClientRect(),
					legend = root.querySelector<HTMLElement>(".usage-native-legend");
				if (!legend) return 1;
				const box = legend.getBoundingClientRect();
				return Math.max(Math.abs(box.x - bounds.x), Math.abs(box.y - bounds.y - 5), Math.abs(box.width - bounds.width));
			}),
		)
		.toBeLessThan(0.001);
	await expect(page.locator(".usage-chart-tooltip")).toContainText("claude-sonnet-4");
	await page.mouse.move(1, 1);
	await expect(page.locator(".usage-chart-tooltip")).toHaveCount(0);
});
