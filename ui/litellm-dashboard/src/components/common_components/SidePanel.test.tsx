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
});
