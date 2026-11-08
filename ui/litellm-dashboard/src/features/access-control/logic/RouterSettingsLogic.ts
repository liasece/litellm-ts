import type { AccessRecord } from "../support/AccessModels";
const numberKeys = new Set(["allowed_fails", "cooldown_time", "num_retries", "timeout", "retry_after"]);
const jsonKeys = new Set(["model_group_alias", "retry_policy", "context_window_fallbacks"]);
export function parseRouterInput(key: string, raw: string, fallback: unknown): unknown {
	const value = raw.trim();
	if (value === "" || value.toLowerCase() === "null") return null;
	if (numberKeys.has(key)) {
		const number = Number(value);
		return Number.isNaN(number) ? fallback : number;
	}
	if (jsonKeys.has(key)) {
		try {
			return JSON.parse(value);
		} catch {
			return fallback;
		}
	}
	if (value.toLowerCase() === "true") return true;
	if (value.toLowerCase() === "false") return false;
	return value;
}
export function normalizeRouterSettings(value: AccessRecord): AccessRecord {
	const result = { ...value };
	for (const key of [
		"routing_strategy",
		"allowed_fails",
		"cooldown_time",
		"num_retries",
		"timeout",
		"retry_after",
		"fallbacks",
		"context_window_fallbacks",
		"retry_policy",
		"model_group_alias",
		"routing_strategy_args",
	]) {
		const field = result[key];
		result[key] =
			field == null || (typeof field === "object" && !Array.isArray(field) && Object.keys(field as object).length === 0)
				? null
				: field;
	}
	result.enable_tag_filtering = Boolean(value.enable_tag_filtering);
	return result;
}
export interface FallbackDraft {
	id: number;
	primary: string;
	models: string[];
}
export function fallbackDraft(value: unknown): FallbackDraft[] {
	if (!Array.isArray(value) || !value.length) return [{ id: 1, primary: "", models: [] }];
	return value.map((item, index) => {
		const [primary, models] = Object.entries(item as Record<string, unknown>)[0] ?? ["", []];
		return { id: index + 1, primary, models: Array.isArray(models) ? models.filter((v): v is string => typeof v === "string") : [] };
	});
}
export function fallbackPayload(groups: FallbackDraft[]): Record<string, string[]>[] | null {
	const result = groups.filter((group) => group.primary && group.models.length).map((group) => ({ [group.primary]: group.models }));
	return result.length ? result : null;
}
