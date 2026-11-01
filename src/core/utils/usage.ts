import type { Usage } from "../../types/openai";

type UsageRecord = Record<string, unknown>;

function record(value: unknown): UsageRecord | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as UsageRecord) : undefined;
}

function numberField(value: UsageRecord | undefined, ...keys: string[]): number | undefined {
	for (const key of keys) {
		if (typeof value?.[key] === "number") {
			return value[key] as number;
		}
	}
	return undefined;
}

function isAnthropicUsage(usage: UsageRecord): boolean {
	return (
		typeof usage["prompt_tokens"] !== "number" &&
		typeof usage["input_tokens"] === "number" &&
		record(usage["input_tokens_details"]) === undefined &&
		typeof usage["total_tokens"] !== "number"
	);
}

/**
 * Read token totals once across Chat, Responses and Anthropic usage aliases.
 * Chat/Responses input totals include cache; native Anthropic input does not.
 * @param usage - Provider usage, before or after protocol conversion.
 */
export function normalizeUsageTokens(usage: UsageRecord | undefined):
	| {
			prompt_tokens: number;
			completion_tokens: number;
			total_tokens: number;
			cache_creation_input_tokens: number;
			cache_read_input_tokens: number;
	  }
	| undefined {
	if (!usage) {
		return undefined;
	}
	const promptDetails = record(usage["prompt_tokens_details"]);
	const inputDetails = record(usage["input_tokens_details"]);
	const cacheRead =
		numberField(promptDetails, "cached_tokens") ??
		numberField(inputDetails, "cached_tokens") ??
		numberField(usage, "cache_read_input_tokens") ??
		0;
	const cacheCreation =
		numberField(promptDetails, "cache_creation_tokens") ??
		numberField(inputDetails, "cache_write_tokens") ??
		numberField(usage, "cache_creation_input_tokens") ??
		0;
	const completion = numberField(usage, "completion_tokens", "output_tokens") ?? 0;
	const prompt = (numberField(usage, "prompt_tokens", "input_tokens") ?? 0) + (isAnthropicUsage(usage) ? cacheRead + cacheCreation : 0);
	return {
		prompt_tokens: prompt,
		completion_tokens: completion,
		total_tokens: numberField(usage, "total_tokens") ?? prompt + completion,
		cache_creation_input_tokens: cacheCreation,
		cache_read_input_tokens: cacheRead,
	};
}

/**
 * Preserve token details and provider extensions when adapting usage to Chat.
 * @param usage - Usage for one provider response.
 */
export function toChatUsage(usage: UsageRecord): Usage {
	const normalized = normalizeUsageTokens(usage)!;
	const converted = structuredClone(usage);
	const inputDetails = {
		...record(converted["input_tokens_details"]),
		...record(converted["prompt_tokens_details"]),
	};
	if (typeof inputDetails["cached_tokens"] === "number" || typeof usage["cache_read_input_tokens"] === "number") {
		inputDetails["cached_tokens"] = normalized.cache_read_input_tokens;
	}
	if (
		typeof inputDetails["cache_creation_tokens"] === "number" ||
		typeof inputDetails["cache_write_tokens"] === "number" ||
		typeof usage["cache_creation_input_tokens"] === "number"
	) {
		inputDetails["cache_creation_tokens"] = normalized.cache_creation_input_tokens;
	}
	delete inputDetails["cache_write_tokens"];
	const outputDetails = {
		...record(converted["output_tokens_details"]),
		...record(converted["completion_tokens_details"]),
	};
	for (const key of ["input_tokens", "output_tokens", "input_tokens_details", "output_tokens_details"]) {
		delete converted[key];
	}
	converted["prompt_tokens"] = normalized.prompt_tokens;
	converted["completion_tokens"] = normalized.completion_tokens;
	converted["total_tokens"] = normalized.total_tokens;
	if (Object.keys(inputDetails).length > 0) {
		converted["prompt_tokens_details"] = inputDetails;
	}
	if (Object.keys(outputDetails).length > 0) {
		converted["completion_tokens_details"] = outputDetails;
	}
	return converted as unknown as Usage;
}

function sumDetails(left: unknown, right: unknown): UsageRecord | undefined {
	const leftRecord = record(left);
	const rightRecord = record(right);
	if (!leftRecord && !rightRecord) {
		return undefined;
	}
	const result = structuredClone(leftRecord ?? {});
	for (const [key, value] of Object.entries(rightRecord ?? {})) {
		if (typeof value === "number") {
			result[key] = (numberField(result, key) ?? 0) + value;
		} else if (record(value)) {
			result[key] = sumDetails(result[key], value);
		} else if (result[key] === undefined) {
			result[key] = structuredClone(value);
		}
	}
	return result;
}

/**
 * Include hidden main-model/worker turns in the public result's usage.
 * Preserve the final response's protocol and never mutate a consumed turn.
 * @param target - Final response that receives cumulative usage.
 * @param source - Earlier response consumed inside a capability loop.
 */
export function addResponseUsage(target: UsageRecord, source: UsageRecord): void {
	const sourceUsage = record(source["usage"]);
	if (!sourceUsage) {
		return;
	}
	const targetUsage = record(target["usage"]);
	if (!targetUsage) {
		target["usage"] = structuredClone(sourceUsage);
		return;
	}
	const left = toChatUsage(targetUsage);
	const right = toChatUsage(sourceUsage);
	const totals = normalizeUsageTokens(targetUsage)!;
	const added = normalizeUsageTokens(sourceUsage)!;
	const prompt = totals.prompt_tokens + added.prompt_tokens;
	const completion = totals.completion_tokens + added.completion_tokens;
	const cacheRead = totals.cache_read_input_tokens + added.cache_read_input_tokens;
	const cacheCreation = totals.cache_creation_input_tokens + added.cache_creation_input_tokens;
	const merged: UsageRecord = structuredClone(targetUsage);
	const inputDetails = sumDetails(left.prompt_tokens_details, right.prompt_tokens_details);
	const outputDetails = sumDetails(left.completion_tokens_details, right.completion_tokens_details);
	if (isAnthropicUsage(targetUsage)) {
		merged["input_tokens"] = prompt - cacheRead - cacheCreation;
		merged["output_tokens"] = completion;
	} else if (typeof targetUsage["prompt_tokens"] !== "number" && typeof targetUsage["input_tokens"] === "number") {
		merged["input_tokens"] = prompt;
		merged["output_tokens"] = completion;
		merged["total_tokens"] = totals.total_tokens + added.total_tokens;
		if (inputDetails) {
			merged["input_tokens_details"] = { ...inputDetails };
			if (typeof inputDetails["cache_creation_tokens"] === "number") {
				(merged["input_tokens_details"] as UsageRecord)["cache_write_tokens"] = cacheCreation;
				delete (merged["input_tokens_details"] as UsageRecord)["cache_creation_tokens"];
			}
		}
		if (outputDetails) {
			merged["output_tokens_details"] = outputDetails;
		}
	} else {
		merged["prompt_tokens"] = prompt;
		merged["completion_tokens"] = completion;
		merged["total_tokens"] = totals.total_tokens + added.total_tokens;
		if (inputDetails) {
			merged["prompt_tokens_details"] = inputDetails;
		}
		if (outputDetails) {
			merged["completion_tokens_details"] = outputDetails;
		}
	}
	for (const [key, value] of [
		["cache_read_input_tokens", cacheRead],
		["cache_creation_input_tokens", cacheCreation],
	] as const) {
		if (typeof targetUsage[key] === "number" || typeof sourceUsage[key] === "number" || (isAnthropicUsage(targetUsage) && value > 0)) {
			merged[key] = value;
		}
	}
	const cacheCreationDetails = sumDetails(targetUsage["cache_creation"], sourceUsage["cache_creation"]);
	if (cacheCreationDetails) {
		merged["cache_creation"] = cacheCreationDetails;
	}
	if (typeof targetUsage["cost"] === "number" || typeof sourceUsage["cost"] === "number") {
		merged["cost"] = (numberField(targetUsage, "cost") ?? 0) + (numberField(sourceUsage, "cost") ?? 0);
	}
	target["usage"] = merged;
}
