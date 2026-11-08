import type { LogEntry } from "../support/LogsModels";
import { asRecord } from "./PrettyMessagesBlocksLogic";
export function formatData(input: unknown): unknown {
	if (typeof input === "string") {
		try {
			return JSON.parse(input) as unknown;
		} catch {
			return input;
		}
	}
	return input;
}
export function hasMessages(value: unknown): boolean {
	return Boolean(value && (Array.isArray(value) ? value.length : typeof value === "object" ? Object.keys(value).length : 0));
}
export function hasResponse(value: unknown): boolean {
	const parsed = formatData(value);
	return Boolean(parsed && Object.keys(Object(parsed)).length);
}
export const guardrailEntries = (value: unknown): Record<string, unknown>[] =>
	(Array.isArray(value) ? value : value ? [value] : []).flatMap((item) => {
		const record = asRecord(item);
		return record ? [record] : [];
	});
export const maskedEntityCount = (entries: Record<string, unknown>[]): number =>
	entries.reduce(
		(sum, entry) =>
			sum +
			Object.values(asRecord(entry.masked_entity_count) ?? {}).reduce<number>(
				(total, count) => total + (typeof count === "number" ? count : 0),
				0,
			),
		0,
	);
export const guardrailLabel = (entries: Record<string, unknown>[]): string =>
	!entries.length ? "-" : entries.length === 1 ? String(entries[0].guardrail_name ?? "-") : entries.length + " guardrails";
export function downstreamRequest(proxy: unknown, messages: unknown, restoreImages = true): unknown {
	const parsed = formatData(proxy || messages),
		record = asRecord(parsed);
	if (!record) return parsed;
	const result = Object.fromEntries(Object.entries(record).filter(([key]) => key !== "upstream_request" && key !== "upstream_response"));
	const body = asRecord(result.body);
	if (restoreImages && body && Array.isArray(messages) && messages.length) {
		if (Array.isArray(body.messages)) return { ...result, body: { ...body, messages } };
		if (Array.isArray(body.input)) return { ...result, body: { ...body, input: messages } };
	}
	return result;
}
const pad = (value: number, length = 2) => String(value).padStart(length, "0");
export function detailDate(value: unknown, iso = false): string {
	if (typeof value !== "string" && !(value instanceof Date)) return "Invalid date";
	const date = new Date(value);
	if (!Number.isFinite(date.getTime())) return "Invalid date";
	if (iso)
		return (
			date.getFullYear() +
			"-" +
			pad(date.getMonth() + 1) +
			"-" +
			pad(date.getDate()) +
			"T" +
			pad(date.getHours()) +
			":" +
			pad(date.getMinutes()) +
			":" +
			pad(date.getSeconds()) +
			"." +
			pad(date.getMilliseconds(), 3) +
			"Z"
		);
	const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
	return (
		months[date.getMonth()] +
		" " +
		date.getDate() +
		", " +
		date.getFullYear() +
		" " +
		(date.getHours() % 12 || 12) +
		":" +
		pad(date.getMinutes()) +
		":" +
		pad(date.getSeconds()) +
		" " +
		(date.getHours() < 12 ? "AM" : "PM")
	);
}
export function relativeDetailDate(value: string, now = Date.now()): string {
	const seconds = Math.round(Math.abs(now - new Date(value).getTime()) / 1000);
	if (!Number.isFinite(seconds)) return "Invalid date";
	const phrase =
		seconds < 45
			? "a few seconds"
			: seconds < 90
				? "a minute"
				: seconds < 2700
					? Math.round(seconds / 60) + " minutes"
					: seconds < 5400
						? "an hour"
						: seconds < 79200
							? Math.round(seconds / 3600) + " hours"
							: seconds < 129600
								? "a day"
								: seconds < 2246400
									? Math.round(seconds / 86400) + " days"
									: seconds < 3888000
										? "a month"
										: seconds < 29808000
											? Math.round(seconds / 2592000) + " months"
											: seconds < 47088000
												? "a year"
												: Math.round(seconds / 31536000) + " years";
	return new Date(value).getTime() > now ? "in " + phrase : phrase + " ago";
}
export function sessionStats(logs: LogEntry[]) {
	const starts = logs.map((log) => new Date(log.startTime).getTime()).filter(Number.isFinite),
		ends = logs.map((log) => new Date(log.endTime ?? log.startTime).getTime()).filter(Number.isFinite);
	return {
		count: logs.length,
		spend: logs.reduce((sum, log) => sum + (log.spend ?? 0), 0),
		duration: starts.length && ends.length ? (Math.max(...ends) - Math.min(...starts)) / 1000 : 0,
		llm: logs.filter((log) => !isAgent(log) && !isMcp(log)).length,
		agent: logs.filter(isAgent).length,
		mcp: logs.filter(isMcp).length,
	};
}
export const isMcp = (log: LogEntry): boolean => log.call_type === "call_mcp_tool" || log.call_type === "list_mcp_tools";
export const isAgent = (log: LogEntry): boolean => log.call_type === "asend_message";
export function eventDisplayName(log: LogEntry): string {
	if (log.metadata?.internal_call_type === "builtin_capability")
		return "Built-in · " + String(log.metadata.builtin_capability ?? "unknown");
	const raw = (log.model || "").trim();
	if (isMcp(log))
		return (
			raw
				.replace(/^mcp:\s*/i, "")
				.split("/")
				.pop() ||
			raw ||
			"mcp_tool"
		);
	const segment = (raw.split("/").pop() || raw).replace(/-20\d{6}.*$/i, "").replace(/:.*$/, "");
	return segment.match(/claude-[a-z0-9-]+/i)?.[0] || segment || "llm_call";
}
export async function copyDetail(value: string, message = "Copied!") {
	await navigator.clipboard.writeText(value);
	window.dispatchEvent(new CustomEvent("litellm-notification", { detail: { type: "success", message } }));
}
