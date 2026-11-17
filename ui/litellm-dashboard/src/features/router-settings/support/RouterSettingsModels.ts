export type RouterValues = Record<string, unknown>;
export type RouterField = Record<string, unknown>;

/** One fallback entry as the UI edits it: ordered targets plus the recursion switch. */
export interface FallbackEntryTargets {
	/** Targets tried in order; the primary is attempted first, the rest after it fails. */
	targets: string[];
	/** Whether a failed target may continue along its own fallback entry. */
	recurse: boolean;
}

/** Model name → its fallback entry, normalized from either wire form. */
export type FallbackEntry = Record<string, FallbackEntryTargets>;

/** Editor state for one fallback group in the add/edit dialog. */
export interface FallbackGroup {
	id: string;
	primary: string;
	models: string[];
	recurse: boolean;
}

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

/**
 * Normalize one stored fallback value.
 *
 * 后端接受 `["a","b"]` 与 `{ targets: ["a","b"], recurse: false }` 两种写法，缺省允许递归；
 * 界面统一按 objects 编辑，写回时再压回紧凑形态（只写目标数组）或带开关的对象。
 * @param value - 存储值
 */
export function fallbackTargets(value: unknown): FallbackEntryTargets {
	if (Array.isArray(value)) {
		return { targets: routerStrings(value), recurse: true };
	}
	const record = routerRecord(value);
	if (Array.isArray(record["targets"])) {
		return { targets: routerStrings(record["targets"]), recurse: record["recurse"] !== false };
	}
	return { targets: [], recurse: true };
}

export function fallbackEntries(value: unknown): FallbackEntry[] {
	if (!Array.isArray(value)) return [];
	return value.map(routerRecord).map((entry) => {
		const normalized: FallbackEntry = {};
		for (const [name, targets] of Object.entries(entry)) {
			normalized[name] = fallbackTargets(targets);
		}
		return normalized;
	});
}

/**
 * Serialize normalized entries back to the router_settings wire shape.
 *
 * 允许递归的条目沿用数组写法，保持既有配置形态；只有需要关闭递归时才写成对象。
 * @param entries - 规范化条目
 */
export function fallbackEntriesWire(
	entries: readonly FallbackEntry[],
): Array<Record<string, string[] | { targets: string[]; recurse: boolean }>> {
	return entries.map((entry) =>
		Object.fromEntries(
			Object.entries(entry).map(([name, config]) => [
				name,
				config.recurse ? [...config.targets] : { targets: [...config.targets], recurse: false },
			]),
		),
	);
}
