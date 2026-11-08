export const yamlDiffKindLabels: Readonly<Record<string, { label: string; color: string }>> = {
	db_missing: { label: "DB 缺失", color: "orange" },
	value_differs: { label: "值不同", color: "red" },
	params_differ: { label: "参数不同", color: "red" },
};
export function formatYamlDiffValue(value: unknown): string {
	if (value === null || value === undefined) return "—";
	let text: string;
	try {
		text = JSON.stringify(value) ?? String(value);
	} catch {
		text = String(value);
	}
	return text.length > 120 ? text.slice(0, 120) + "…" : text;
}
export function yamlDiffRowKey(item: { section: unknown; key: unknown }): string {
	return String(item.section) + ":" + String(item.key);
}
