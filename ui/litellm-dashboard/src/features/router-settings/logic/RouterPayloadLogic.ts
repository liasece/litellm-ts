import { inputText, routerRecord, type RouterValues } from "../support/RouterSettingsModels";
const numbers = new Set(["allowed_fails", "cooldown_time", "num_retries", "timeout", "retry_after"]);
export function parseRouterInput(name: string, raw: string | undefined, fallback: unknown): unknown {
	if (raw === undefined) return fallback;
	const value = raw.trim();
	if (value.toLowerCase() === "null") return null;
	if (numbers.has(name)) {
		const number = Number(value);
		return Number.isNaN(number) ? fallback : number;
	}
	if (["model_group_alias", "retry_policy"].includes(name)) {
		if (value === "") return null;
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
export function routerPayload(
	original: RouterValues,
	inputs: Record<string, string>,
	strategy: string | null,
	tagFiltering: boolean,
): { router_settings: RouterValues } {
	const settings: RouterValues = {};
	for (const [name, value] of Object.entries({ ...original, enable_tag_filtering: tagFiltering })) {
		if (name === "routing_strategy") settings[name] = strategy;
		else if (name === "enable_tag_filtering") settings[name] = tagFiltering;
		else if (name === "routing_strategy_args") {
			if (strategy === "latency-based-routing") {
				const args: RouterValues = {};
				for (const key of ["lowest_latency_buffer", "ttl"]) {
					const raw = inputs[key] ?? inputText(routerRecord(value)[key]);
					if (raw) args[key] = Number(raw);
				}
				settings[name] = args;
			}
		} else settings[name] = parseRouterInput(name, inputs[name], value);
	}
	return { router_settings: settings };
}
