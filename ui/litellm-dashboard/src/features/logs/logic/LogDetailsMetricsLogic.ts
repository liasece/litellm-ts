import { asRecord } from "./PrettyMessagesBlocksLogic";
import { readFieldPath } from "./PrettyMessagesFieldRules";
export function cacheTokens(metadata: unknown, kind: "read" | "creation"): number {
	const fields =
		kind === "read"
			? ["cache_read_input_tokens", "prompt_tokens_details.cached_tokens", "input_tokens_details.cached_tokens"]
			: ["cache_creation_input_tokens", "prompt_tokens_details.cache_creation_tokens", "input_tokens_details.cache_write_tokens"];
	const record = asRecord(metadata),
		usage = [record?.additional_usage_values, record?.usage_object];
	for (const entry of usage)
		for (const field of fields) {
			const value = readFieldPath(entry, field);
			if (typeof value === "number" && Number.isFinite(value)) return Math.max(value, 0);
		}
	return 0;
}
export function costView(value: unknown, spend: number, prompt?: number | null, completion?: number | null, cached?: unknown) {
	const breakdown = asRecord(value) ?? {},
		isCached = String(cached ?? "").toLowerCase() === "true";
	const number = (key: string) => (typeof breakdown[key] === "number" ? breakdown[key] : undefined);
	const additional = Object.entries(asRecord(breakdown.additional_costs) ?? {}).filter(
		(item): item is [string, number] => typeof item[1] === "number" && item[1] !== 0,
	);
	const discount = Boolean(number("discount_percent") || number("discount_amount")),
		margin = Boolean(number("margin_percent") || number("margin_fixed_amount") || number("margin_total_amount"));
	return {
		breakdown,
		additional,
		discount,
		margin,
		isCached,
		input: isCached ? 0 : number("input_cost"),
		output: isCached ? 0 : number("output_cost"),
		original: isCached ? 0 : number("original_cost"),
		total: isCached ? 0 : (number("total_cost") ?? spend),
		visible:
			number("input_cost") !== undefined ||
			number("output_cost") !== undefined ||
			prompt !== undefined ||
			completion !== undefined ||
			additional.length > 0 ||
			discount ||
			margin,
		number,
	};
}
