/**
 * 自适应列宽：每列只声明一个下限，容器比下限之和大时按各列下限等比放大。
 *
 * 下限是"最窄也要放得下"的宽度：表头文字（单行）与常规内容取大。放大按比例做，
 * 宽列自然拿到更多余量，不需要再为每列手调权重——就像普通表格把 width: 100% 摊给各列。
 */
export interface UiTableWidthColumn {
	key: string;
	/** 列宽下限；表头单行放得下、常规内容不截断即可。 */
	minWidth?: number;
	/** 没有 minWidth 时回退到的固定宽度；字符串宽度（如 "30%"）不参与像素计算。 */
	width?: number | string;
}

export interface UiTableWidthInput {
	columns: readonly UiTableWidthColumn[];
	/** 表格可用宽度（滚动容器内容宽度）。尚未测量时传 0，此时只返回下限。 */
	frameWidth: number;
}

/** 没有声明宽度的列至少保留这个宽度，避免被算成 0 而挤成一条线。 */
const fallbackMinWidth = 120;

export function uiTableColumnMinWidth(column: UiTableWidthColumn): number {
	if (typeof column.minWidth === "number") return Math.max(0, column.minWidth);
	if (typeof column.width === "number") return Math.max(0, column.width);
	return fallbackMinWidth;
}

/**
 * 计算固定布局表格的列宽。
 *
 * 容器装得下时按各列下限等比放大，总和正好等于容器宽度；装不下时返回各列下限，
 * 由表格自身横向滚动，而不是把每列压到内容放不下。
 * @param input - 列定义与容器宽度
 */
export function computeUiTableColumnWidths({ columns, frameWidth }: UiTableWidthInput): Record<string, number> {
	const minimums = columns.map(uiTableColumnMinWidth);
	const totalMinimum = minimums.reduce((sum, value) => sum + value, 0);
	const frame = Math.floor(frameWidth);
	const widths: Record<string, number> = {};
	if (totalMinimum <= 0 || frame <= totalMinimum) {
		columns.forEach((column, index) => {
			widths[column.key] = minimums[index] as number;
		});
		return widths;
	}
	columns.forEach((column, index) => {
		widths[column.key] = Math.round(((minimums[index] as number) * frame) / totalMinimum);
	});
	// 取整会在总和上留下几像素，补到最宽的一列，避免表格比容器窄一条缝。
	const remainder = frame - columns.reduce((sum, column) => sum + widths[column.key], 0);
	if (remainder !== 0) {
		let widest = 0;
		minimums.forEach((value, index) => {
			if (value > (minimums[widest] as number)) widest = index;
		});
		const key = columns[widest].key;
		widths[key] = (widths[key] as number) + remainder;
	}
	return widths;
}
