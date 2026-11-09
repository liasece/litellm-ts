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
}
export type UiTableRow = Record<string, unknown>;
export type UiSortOrder = "asc" | "desc" | null;
export interface UiTableSort {
	key: string;
	order: UiSortOrder;
}
