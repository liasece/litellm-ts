export interface UiTableVirtualWindow {
	start: number;
	end: number;
	top: number;
	bottom: number;
}

export interface UiTableVirtualInput {
	total: number;
	rowHeight: number;
	overscan: number;
	bodyTop: number;
	viewportHeight: number;
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

/**
 * 计算窗口化表格需要挂载的行区间和上下占位高度。
 *
 * 表格由最近的纵向滚动容器（没有则页面）滚动，bodyTop 是 tbody 相对该容器
 * 可视区顶部的位置；向下滚动时 bodyTop 变为负数，以此换算第一行可见索引。
 * overscan 只影响渲染范围，不改变滚动高度。
 */
export function computeUiTableVirtualWindow(input: UiTableVirtualInput): UiTableVirtualWindow {
	const total = Math.max(0, Math.floor(input.total) || 0);
	const rowHeight = Math.max(1, input.rowHeight || 1);
	const overscan = Math.max(0, Math.floor(input.overscan) || 0);
	if (total === 0) return { start: 0, end: 0, top: 0, bottom: 0 };
	if (!Number.isFinite(input.bodyTop) || !Number.isFinite(input.viewportHeight)) {
		return { start: 0, end: Math.min(total, overscan), top: 0, bottom: (total - Math.min(total, overscan)) * rowHeight };
	}

	const viewportHeight = Math.max(0, input.viewportHeight);
	const firstVisible = clamp(Math.floor(-input.bodyTop / rowHeight), 0, total);
	const lastVisible = clamp(Math.ceil((viewportHeight - input.bodyTop) / rowHeight), 0, total);
	const start = Math.max(0, firstVisible - overscan);
	const end = Math.min(total, Math.max(start, lastVisible + overscan));

	return {
		start,
		end,
		top: start * rowHeight,
		bottom: (total - end) * rowHeight,
	};
}
