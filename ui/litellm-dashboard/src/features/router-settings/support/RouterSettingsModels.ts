export type RouterValues = Record<string, unknown>;
export type RouterField = Record<string, unknown>;
export interface FallbackGroup {
	id: string;
	primary: string;
	models: string[];
}
export type FallbackEntry = Record<string, string[]>;
export function routerRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
export function routerString(value: unknown): string {
	return typeof value === "string" ? value : value == null ? "" : String(value);
}
export function routerStrings(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
export function inputText(value: unknown): string {
	return value == null || value === "null" ? "" : typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
}
export function routerSettingsOnly(payload: Record<string, unknown>): RouterValues {
	const values = { ...routerRecord(payload.router_settings) };
	delete values.model_group_retry_policy;
	return values;
}
export function fallbackEntries(value: unknown): FallbackEntry[] {
	if (!Array.isArray(value)) return [];
	return value
		.map(routerRecord)
		.map((entry) => Object.fromEntries(Object.entries(entry).map(([key, value]) => [key, routerStrings(value)])));
}
