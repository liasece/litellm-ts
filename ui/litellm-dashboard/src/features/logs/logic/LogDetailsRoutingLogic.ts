import { z } from "zod";
import type { LogEntry } from "../support/LogsModels";
const resolutionSchema = z.object({
	fallback_index: z.number().int().nonnegative(),
	input_model: z.string(),
	resolved_model: z.string(),
	resolution_path: z.array(z.string()).min(2),
});
const traceSchema = z.object({
	fallback_index: z.number().int().min(1),
	from_model: z.string(),
	to_model: z.string(),
	to_resolved_model: z.string(),
	resolution_path: z.array(z.string()),
	routing_type: z.enum(["general_fallback", "context_window_fallback", "content_policy_fallback"]),
	reason: z.enum(["no_available_deployment", "rate_limit", "context_window_exceeded", "content_policy_violation", "upstream_error"]),
	attempted_deployment: z.string().optional(),
	error_information: z.object({
		error_type: z.string(),
		error_code: z.union([z.string(), z.number(), z.null()]),
		error_message: z.string(),
	}),
});
export const routingTypeLabels = {
	general_fallback: "General fallback",
	context_window_fallback: "Context window fallback",
	content_policy_fallback: "Content policy fallback",
};
export const routingReasonLabels = {
	no_available_deployment: "No available deployment",
	rate_limit: "Rate limit",
	context_window_exceeded: "Context window exceeded",
	content_policy_violation: "Content policy violation",
	upstream_error: "Upstream error",
};
export function routingView(log: LogEntry) {
	const metadata = log.metadata ?? {},
		fallbackModels = Array.isArray(metadata.fallback_models)
			? metadata.fallback_models.filter((model): model is string => typeof model === "string" && model.length > 0)
			: [];
	const resolutions = (Array.isArray(metadata.model_resolution_chain) ? metadata.model_resolution_chain : []).flatMap((raw) => {
		const parsed = resolutionSchema.safeParse(raw);
		return parsed.success ? [parsed.data] : [];
	});
	const traces = (Array.isArray(metadata.routing_trace) ? metadata.routing_trace : [])
		.flatMap((raw) => {
			const parsed = traceSchema.safeParse(raw);
			return parsed.success ? [parsed.data] : [];
		})
		.sort((a, b) => a.fallback_index - b.fallback_index);
	const original = resolutions.find((entry) => entry.fallback_index === 0),
		count = Math.max(fallbackModels.length - 1, ...traces.map((entry) => entry.fallback_index), 0);
	const hops = Array.from({ length: count }, (_, offset) => {
		const index = offset + 1,
			trace = traces.find((entry) => entry.fallback_index === index),
			resolution = resolutions.find((entry) => entry.fallback_index === index);
		const target = trace?.to_model ?? resolution?.input_model ?? fallbackModels[index] ?? "Unknown";
		return {
			index,
			trace,
			from: trace?.from_model ?? fallbackModels[index - 1] ?? "Unknown",
			to: trace?.to_resolved_model ?? resolution?.resolved_model ?? fallbackModels[index] ?? target,
			path: trace?.resolution_path ?? resolution?.resolution_path ?? [target],
		};
	});
	return {
		visible: count > 0 || resolutions.length > 0,
		count,
		hops,
		original: original?.resolution_path ?? [],
		originalModel: fallbackModels[0] ?? original?.input_model ?? log.model,
	};
}
