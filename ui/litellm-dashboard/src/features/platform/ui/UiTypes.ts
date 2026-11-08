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
	ellipsis?: boolean;
}
export type UiTableRow = Record<string, unknown>;
export type UiSortOrder = "asc" | "desc" | null;
export interface UiTableSort {
	key: string;
	order: UiSortOrder;
}
