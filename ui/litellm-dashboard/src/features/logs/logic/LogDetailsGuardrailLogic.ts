import { asRecord } from "./PrettyMessagesBlocksLogic";
import { maskedEntityCount } from "./LogDetailsDisplayLogic";
export function guardrailMode(value: unknown): string | null {
	if (typeof value === "string") return value;
	if (Array.isArray(value)) return typeof value[0] === "string" ? value[0] : null;
	const record = asRecord(value);
	return record && "default" in record ? guardrailMode(record.default) : null;
}
export function guardrailModeMatches(value: unknown, target: string): boolean {
	if (typeof value === "string") return value === target;
	if (Array.isArray(value)) return value.includes(target);
	const record = asRecord(value);
	return record && "default" in record ? guardrailModeMatches(record.default, target) : false;
}
export const guardrailPassed = (entry: Record<string, unknown>): boolean =>
	String(entry.guardrail_status ?? "").toLowerCase() === "success";
export const guardrailName = (entry: Record<string, unknown>): string => String(entry.policy_template || entry.guardrail_name || "");
export function guardrailRisk(entry: Record<string, unknown>): number | null {
	if (!guardrailPassed(entry)) return null;
	if (typeof entry.risk_score === "number") return entry.risk_score;
	const total = maskedEntityCount([entry]),
		patterns = Number(entry.patterns_checked ?? 0),
		confidence = Number(entry.confidence_score ?? 0);
	if (patterns === 0 && confidence === 0) return 0;
	let score = (patterns > 0 ? total / patterns : 0) * 7 + confidence * 3;
	if (total > 0 && score < 2) score = 2;
	return Math.min(10, Math.round(score * 10) / 10);
}
export interface GuardrailLifecycleItem {
	type: "request" | "guardrail" | "llm" | "response";
	label: string;
	offsetMs: number;
	success?: boolean;
}
export function guardrailLifecycle(entries: Record<string, unknown>[]): GuardrailLifecycleItem[] {
	const sorted = [...entries].sort((a, b) => Number(a.start_time ?? 0) - Number(b.start_time ?? 0));
	if (!sorted.length) return [];
	const base = Number(sorted[0].start_time ?? 0),
		items: GuardrailLifecycleItem[] = [{ type: "request", label: "Request received", offsetMs: 0 }];
	const pre = sorted.filter((entry) => guardrailModeMatches(entry.guardrail_mode, "pre_call"));
	const post = sorted.filter(
		(entry) => guardrailModeMatches(entry.guardrail_mode, "post_call") || guardrailModeMatches(entry.guardrail_mode, "logging_only"),
	);
	const during = sorted.filter((entry) => guardrailModeMatches(entry.guardrail_mode, "during_call"));
	const append = (values: Record<string, unknown>[], label: string) => {
		for (const entry of values)
			items.push({
				type: "guardrail",
				label: label + ": " + guardrailName(entry),
				offsetMs: Math.round((Number(entry.end_time) - base) * 1000),
				success: guardrailPassed(entry),
			});
	};
	append(pre, "Pre-call guardrail");
	const lastPre = pre.length ? Math.max(...pre.map((entry) => Number(entry.end_time))) : base,
		firstPost = post.length ? Math.min(...post.map((entry) => Number(entry.start_time))) : undefined;
	items.push({ type: "llm", label: "LLM call", offsetMs: Math.round(((firstPost ?? lastPre + 1) - base) * 1000) });
	append(during, "During-call guardrail");
	append(post, "Post-call guardrail");
	items.push({
		type: "response",
		label: "Response returned",
		offsetMs: Math.round((Math.max(...sorted.map((entry) => Number(entry.end_time))) - base) * 1000) + 1,
	});
	return items;
}
