import type { LogsColumn } from "../support/LogsColumnModels";

export interface LogsColumnWidthLayout {
	/** 每列最终像素宽度；固定列保持原值，弹性列分到剩余空间。 */
	widths: Record<string, number>;
	/** 表格需要的总宽度；容器不足时作为横向滚动的 min-width。 */
	totalWidth: number;
}

/**
 * 计算 Logs 列宽。
 *
 * Time / Status / Session ID / Request ID 的内容长度稳定，固定宽度可避免窗口变宽时
 * 它们跟着膨胀，把空间从 Model / Tokens / TPS 手里拿走。其余列只声明最小宽度，
 * 容器有富余时平均分配；容器不足时保留最小宽度并让外层横向滚动。
 */
export function computeLogsColumnWidths(columns: readonly LogsColumn[], availableWidth: number): LogsColumnWidthLayout {
	const widths: Record<string, number> = {};
	let totalWidth = 0;
	const flexible: LogsColumn[] = [];
	for (const column of columns) {
		const width = column.fixedWidth ?? column.minWidth;
		widths[column.id] = width;
		totalWidth += width;
		if (column.fixedWidth == null) flexible.push(column);
	}
	const available = Math.max(0, Math.floor(availableWidth));
	if (available <= totalWidth || flexible.length === 0) return { widths, totalWidth };

	const extra = available - totalWidth;
	const each = Math.floor(extra / flexible.length);
	let remainder = extra - each * flexible.length;
	for (const column of flexible) {
		const width = column.minWidth + each + (remainder > 0 ? 1 : 0);
		widths[column.id] = width;
		remainder = Math.max(0, remainder - 1);
	}
	return { widths, totalWidth: available };
}
