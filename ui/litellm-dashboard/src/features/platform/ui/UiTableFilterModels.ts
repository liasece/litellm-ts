/** 列筛选的匹配方式：fuzzy 为不区分大小写的包含，exact 为不区分大小写的等值。 */
export type UiTableFilterMatch = "fuzzy" | "exact";

/** 筛选面板中的一个候选值。 */
export interface UiTableFilterChoice {
	value: string;
	label: string;
	description?: string;
}

/** 文本筛选：输入框加包含/等于切换。 */
export interface UiTableFilterTextControl {
	kind: "text";
	placeholder?: string;
	match?: UiTableFilterMatch;
}

/** 枚举筛选：面板直接列出候选值，允许输入自定义值时提交输入文本。 */
export interface UiTableFilterSelectControl {
	kind: "select";
	options: readonly UiTableFilterChoice[];
	searchable?: boolean;
	creatable?: boolean;
}

/** 远程筛选：输入关键字后向调用方请求候选值。 */
export interface UiTableFilterRemoteControl {
	kind: "remote";
	placeholder?: string;
	search: (term: string) => Promise<readonly UiTableFilterChoice[]>;
	initialOptions?: readonly UiTableFilterChoice[];
}

export type UiTableFilterControl = UiTableFilterTextControl | UiTableFilterSelectControl | UiTableFilterRemoteControl;

/** 表头某列可声明一个或多个筛选字段，同一列共用同一个筛选面板。 */
export interface UiTableFilterField {
	/** 筛选键；服务端列表用它映射查询参数，前端列表用它读取行字段。 */
	key: string;
	/** 面板字段名，也是筛选标签的前缀。 */
	label: string;
	control: UiTableFilterControl;
}

/** 已生效的筛选条件，用于表头激活态、筛选标签与查询参数。 */
export interface UiTableActiveFilter {
	key: string;
	label: string;
	value: string;
	/** 标签中展示的文本；枚举显示友好名称，ID 显示原值。 */
	text: string;
	match: UiTableFilterMatch;
	/** 筛选值本身是模型名时用于显示模型图标。 */
	iconModel?: string;
	/** 筛选值本身是供应商时用于显示供应商图标。 */
	iconProvider?: string;
}

/** 读取字段声明的默认匹配方式：文本默认包含，枚举和远程候选项默认等值。 */
export function defaultFilterMatch(field: UiTableFilterField): UiTableFilterMatch {
	return field.control.kind === "text" ? (field.control.match ?? "fuzzy") : "exact";
}

/** 把筛选字段转换成已生效条件；空值表示清除该字段。 */
export function toActiveFilter(field: UiTableFilterField, value: string, text = ""): UiTableActiveFilter {
	const trimmed = value.trim();
	return {
		key: field.key,
		label: field.label,
		value: trimmed,
		text: trimmed ? text || trimmed : "",
		match: defaultFilterMatch(field),
	};
}
