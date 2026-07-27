/* @vitest-environment jsdom */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import SidePanel, { SIDE_PANEL_WIDTH } from "./SidePanel";

describe("SidePanel", () => {
	it("applies the shared placement and responsive width", () => {
		render(
			<SidePanel open onClose={() => undefined}>
				<div>Panel content</div>
			</SidePanel>,
		);

		expect(document.querySelector(".ant-drawer-right")).toBeInTheDocument();
		expect(document.querySelector(".ant-drawer-content-wrapper")).toHaveStyle({
			width: SIDE_PANEL_WIDTH,
		});
	});

	it("allows a feature-specific responsive width", () => {
		const width = "min(1800px, calc(100vw - 32px))";

		render(
			<SidePanel open onClose={() => undefined} width={width}>
				<div>Wide panel content</div>
			</SidePanel>,
		);

		expect(document.querySelector(".ant-drawer-content-wrapper")).toHaveStyle({ width });
	});
});
