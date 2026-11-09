import { describe, expect, it } from "vitest";
import { computeFloatingPanelPosition } from "./UiFloatingPanelLogic";

const viewport = { width: 1440, height: 900 };
const panel = { width: 256, height: 260 };

function anchorAt(left: number, top: number, width = 140, height = 38) {
	return { left, top, right: left + width, bottom: top + height };
}

describe("floating panel placement", () => {
	it("opens below the trigger, aligned with its left edge", () => {
		expect(computeFloatingPanelPosition(anchorAt(48, 132), panel, viewport, { gap: 8, margin: 8 })).toEqual({
			top: 178,
			left: 48,
		});
	});

	it("pulls the panel back inside the viewport when the trigger sits near an edge", () => {
		// 工具栏最左侧的时间范围按钮：面板比右侧可用空间宽，必须整体夹进视口而不是被裁掉。
		expect(computeFloatingPanelPosition(anchorAt(24, 132), panel, viewport).left).toBe(24);
		expect(computeFloatingPanelPosition(anchorAt(1360, 132), panel, viewport).left).toBe(1440 - 256 - 8);
		expect(computeFloatingPanelPosition(anchorAt(600, 132), panel, viewport, { align: "end" }).left).toBe(600 + 140 - 256);
	});

	it("keeps a narrow viewport usable instead of producing negative coordinates", () => {
		const narrow = { width: 260, height: 480 };
		const position = computeFloatingPanelPosition(anchorAt(0, 60), panel, narrow);
		expect(position.left).toBe(8);
		expect(position.top).toBeGreaterThanOrEqual(8);
	});

	it("flips above the trigger when there is not enough room below", () => {
		const shortViewport = { width: 1440, height: 640 };
		expect(computeFloatingPanelPosition(anchorAt(48, 520), panel, shortViewport).top).toBe(520 - 260 - 8);
		// 上下都放不下时贴住上边界，剩余高度交给面板自身的 max-height 与滚动。
		expect(computeFloatingPanelPosition(anchorAt(48, 60), panel, { width: 1440, height: 300 }).top).toBe(8);
	});
});
