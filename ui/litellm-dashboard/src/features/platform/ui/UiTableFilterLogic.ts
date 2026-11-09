import type { UiTableActiveFilter } from "./UiTableFilterModels";

/** 把行值规范成可比较文本；数组以空格连接，对象退化为 JSON 便于诊断。 */
function normalizedValue(value: unknown): string {
	if (value == null) return "";
	if (Array.isArray(value)) return value.map((item) => normalizedValue(item)).join(" ");
	if (typeof value === "object") return JSON.stringify(value);
	return String(value);
}

/** 判断行值是否满足筛选条件；空筛选值表示不过滤。 */
export function matchesTableFilter(value: unknown, filter: Pick<UiTableActiveFilter, "value" | "match">): boolean {
	const target = filter.value.trim().toLocaleLowerCase();
	if (!target) return true;
	const text = normalizedValue(value).toLocaleLowerCase();
	return filter.match === "exact" ? text === target : text.includes(target);
}

/** 按显式字段读取行值并过滤；读取函数由调用方提供，避免把列定义耦合到具体行结构。 */
export function filterRowsByFields<T>(
	rows: readonly T[],
	filters: readonly UiTableActiveFilter[],
	read: (row: T, key: string) => unknown,
): readonly T[] {
	const applicable = filters.filter((filter) => filter.value.trim());
	if (!applicable.length) return rows;
	return rows.filter((row) => applicable.every((filter) => matchesTableFilter(read(row, filter.key), filter)));
}

/** 按点分路径读取字段；仅用于同一行内的显式字段，不展开业务对象。 */
export function readFilterPathValue(row: Record<string, unknown>, key: string): unknown {
	return key.split(".").reduce<unknown>((value, segment) => {
		if (value === null || typeof value !== "object") return undefined;
		return (value as Record<string, unknown>)[segment];
	}, row);
}
