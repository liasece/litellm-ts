import type { PlaygroundResponseUsage } from "../../playground/support/PlaygroundResponseMetricsModels";
function object(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}
export function promptFrameContent(frame: Record<string, unknown>): string | undefined {
	const choices = Array.isArray(frame.choices) ? frame.choices : [],
		delta = object(object(choices[0])?.delta);
	return typeof delta?.content === "string" ? delta.content : undefined;
}
export function promptFrameUsage(frame: Record<string, unknown>): PlaygroundResponseUsage | undefined {
	const source = object(frame.usage);
	if (!source) return undefined;
	const result: PlaygroundResponseUsage = {};
	for (const key of [
		"prompt_tokens",
		"completion_tokens",
		"total_tokens",
		"reasoning_tokens",
		"promptTokens",
		"completionTokens",
		"totalTokens",
		"reasoningTokens",
		"cost",
	] as const) {
		const value = source[key];
		if (typeof value === "number") result[key] = value;
	}
	return result;
}
