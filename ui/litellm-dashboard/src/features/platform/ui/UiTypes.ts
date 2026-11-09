import type { UiTableFilterField } from "./UiTableFilterModels";

export type UiAppearance = "antd" | "tremor";
export type UiControlSize = "small" | "middle" | "large";
export type UiValue = string | number;
export interface UiSelectOption {
	value: UiValue;
	label: string;
	disabled?: boolean;
	description?: string;
	group?: string;
}
export interface UiTabItem {
	key: string;
	label: string;
	disabled?: boolean;
	count?: number;
}
export interface UiTableColumn {
	key: string;
	label: string;
	dataIndex?: string | readonly string[];
	width?: number | string;
	align?: "left" | "center" | "right";
	sortable?: boolean;
	/** 首次点击表头时的排序方向；再次点击切换方向，第三次取消排序。 */
	initialSortOrder?: "asc" | "desc";
	/** 该列的表头筛选字段；为空表示不提供筛选入口。 */
	filters?: readonly UiTableFilterField[];
	ellipsis?: boolean;
	/** 表头标题后的说明图标；用于需要解释口径的列。 */
	tooltip?: string;
	/** 拖拽调整列宽时的上限像素值。 */
	maxWidth?: number;
	/** 固定操作列：滚动时贴住容器右侧。 */
	sticky?: "left" | "right";
	/** 单元格附加类名，供列表保留多行内容等专用排版。 */
	cellClass?: string;
}
export type UiTableRow = Record<string, unknown>;
export type UiSortOrder = "asc" | "desc" | null;
export interface UiTableSort {
	key: string;
	order: UiSortOrder;
}
