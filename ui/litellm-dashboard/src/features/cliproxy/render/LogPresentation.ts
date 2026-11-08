import type { CliProxyLogEntry } from "../support/CliProxyModels";

export type LogLevel = "info" | "debug" | "warn" | "error";

export interface PresentedLog {
	entry: CliProxyLogEntry;
	level: LogLevel;
	message: string;
	method?: string;
	path?: string;
	status?: number;
	latency?: string;
}

const ANSI_PATTERN = new RegExp(String.fromCharCode(0x1b) + "\\[[0-9;]*m", "g");
const HTTP_PATTERN = /\b(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+([^\s|]+)/i;
const STATUS_PATTERN = /(?:^|[\s|])([1-5]\d{2})(?=$|[\s|])/;
const LATENCY_PATTERN = /\b\d+(?:\.\d+)?(?:µs|us|ms|s)\b/i;

export function presentLog(entry: CliProxyLogEntry): PresentedLog {
	const message = entry.message.replace(ANSI_PATTERN, "");
	const lowered = message.toLowerCase();
	const level: LogLevel =
		entry.stream === "stderr" || /\b(error|fatal|panic|failed|failure)\b/.test(lowered)
			? "error"
			: /\b(warn|warning|degraded|retry)\b/.test(lowered)
				? "warn"
				: /\b(debug|trace)\b/.test(lowered)
					? "debug"
					: "info";
	const http = message.match(HTTP_PATTERN);
	const statusMatch = message.match(STATUS_PATTERN);
	const status = statusMatch ? Number(statusMatch[1]) : undefined;
	return {
		entry,
		level,
		message,
		method: http?.[1]?.toUpperCase(),
		path: http?.[2],
		status: status && status >= 100 && status <= 599 ? status : undefined,
		latency: message.match(LATENCY_PATTERN)?.[0],
	};
}

export function levelColor(level: LogLevel): string {
	if (level === "error") return "red";
	if (level === "warn") return "orange";
	if (level === "debug") return "purple";
	return "blue";
}

export function streamColor(stream: CliProxyLogEntry["stream"]): string {
	if (stream === "stderr") return "red";
	if (stream === "system") return "cyan";
	if (stream === "oauth") return "purple";
	return "default";
}

export function statusColor(status: number): string {
	if (status >= 500) return "red";
	if (status >= 400) return "orange";
	if (status >= 300) return "blue";
	return "green";
}

export function formatRawLogs(entries: CliProxyLogEntry[]): string {
	return entries
		.map((entry) => `${new Date(entry.timestamp).toLocaleString()} [${entry.stream}] ${entry.message.replace(ANSI_PATTERN, "")}`)
		.join("\n");
}
