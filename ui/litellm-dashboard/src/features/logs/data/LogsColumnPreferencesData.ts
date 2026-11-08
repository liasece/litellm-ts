import { LOGS_OPTIONAL_COLUMNS, type LogsOptionalColumnId } from "../support/LogsModels";

const STORAGE_KEY = "logsVisibleOptionalColumns";

const KNOWN_COLUMN_IDS = new Set<string>(LOGS_OPTIONAL_COLUMNS.map((column) => column.id));

/** 默认隐藏全部可选列：列表只保留核心列。 */
export const DEFAULT_LOGS_OPTIONAL_COLUMNS: readonly LogsOptionalColumnId[] = [];

/**
 * 解析本地保存的可选列设置。
 * 损坏的 JSON、非数组或未知列名都会被忽略，回退到默认（全部隐藏）。
 */
export function parseLogsColumnPreferences(raw: string | null): LogsOptionalColumnId[] {
	if (!raw) return [...DEFAULT_LOGS_OPTIONAL_COLUMNS];
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return [...DEFAULT_LOGS_OPTIONAL_COLUMNS];
	}
	if (!Array.isArray(parsed)) return [...DEFAULT_LOGS_OPTIONAL_COLUMNS];
	const known = parsed.filter((value): value is LogsOptionalColumnId => typeof value === "string" && KNOWN_COLUMN_IDS.has(value));
	return [...new Set(known)];
}

/** 读取当前浏览器的列显示设置；无存储环境时返回默认值。 */
export function readLogsColumnPreferences(): LogsOptionalColumnId[] {
	if (typeof window === "undefined") return [...DEFAULT_LOGS_OPTIONAL_COLUMNS];
	return parseLogsColumnPreferences(window.localStorage.getItem(STORAGE_KEY));
}

/** 写入当前浏览器的列显示设置。 */
export function writeLogsColumnPreferences(columns: readonly LogsOptionalColumnId[]): void {
	if (typeof window === "undefined") return;
	window.localStorage.setItem(STORAGE_KEY, JSON.stringify(columns));
}
