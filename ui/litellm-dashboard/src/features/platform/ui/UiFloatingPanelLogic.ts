export interface FloatingAnchorRect {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

export interface FloatingPanelSize {
	width: number;
	height: number;
}

export interface FloatingViewportSize {
	width: number;
	height: number;
}

export interface FloatingPanelOptions {
	/** 触发器与面板之间的间距。 */
	gap?: number;
	/** 面板与视口之间保留的安全距离。 */
	margin?: number;
	/** 面板优先对齐触发器的左边缘还是右边缘。 */
	align?: "start" | "end";
}

export interface FloatingPanelPosition {
	top: number;
	left: number;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), Math.max(min, max));
}

/**
 * 计算浮层的视口坐标：默认贴住触发器下方，向下放不下时翻到上方，并始终把面板夹在视口内。
 *
 * 浮层需要渲染到页面容器之外（Teleport）才不会被祖先的 overflow 裁切，此时它只能使用视口坐标，
 * 不能沿用相对触发器的 absolute 定位，所以左右位置必须在这里夹紧，否则贴边触发器会把面板推到视口外。
 */
export function computeFloatingPanelPosition(
	anchor: FloatingAnchorRect,
	panel: FloatingPanelSize,
	viewport: FloatingViewportSize,
	options: FloatingPanelOptions = {},
): FloatingPanelPosition {
	const gap = options.gap ?? 8;
	const margin = options.margin ?? 8;
	const left = clamp(options.align === "end" ? anchor.right - panel.width : anchor.left, margin, viewport.width - panel.width - margin);
	const below = anchor.bottom + gap;
	const fitsBelow = below + panel.height <= viewport.height - margin;
	return {
		top: clamp(fitsBelow ? below : anchor.top - panel.height - gap, margin, viewport.height - panel.height - margin),
		left,
	};
}
