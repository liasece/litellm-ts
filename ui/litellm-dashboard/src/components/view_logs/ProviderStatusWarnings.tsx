import { Alert, Button } from "antd";
import type { LogEntry } from "./columns";

const RECENT_PROVIDER_ERROR_WINDOW_MS = 15 * 60 * 1_000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1_000;

const PROVIDER_DETAILS: Record<string, { displayName: string; statusPageUrl?: string }> = {
	anthropic: { displayName: "Anthropic" },
	deepseek: { displayName: "DeepSeek", statusPageUrl: "https://status.deepseek.com/" },
	minimax: { displayName: "MiniMax" },
	openai: { displayName: "OpenAI" },
};

const PROVIDER_MODEL_PATTERNS: Array<{ provider: string; pattern: RegExp }> = [
	{ provider: "deepseek", pattern: /^deepseek(?:[-_.:/]|$)/ },
	{ provider: "minimax", pattern: /^minimax(?:[-_.:/]|$)/ },
	{ provider: "anthropic", pattern: /^claude(?:[-_.:/]|$)/ },
	{ provider: "openai", pattern: /^(?:chatgpt|gpt|o1|o3|o4)(?:[-_.:/]|$)/ },
];

export interface ProviderStatusWarning {
	provider: string;
	displayName: string;
	errorCount: number;
	errorCodes: number[];
	latestErrorAt: Date;
	statusPageUrl?: string;
}

function providerFromModelName(model: unknown): string | null {
	if (typeof model !== "string") return null;
	const normalizedModel = model.trim().toLowerCase();
	if (!normalizedModel) return null;
	const modelPrefix = normalizedModel.split("/", 1)[0];
	if (normalizedModel.includes("/") && modelPrefix) return modelPrefix;

	return PROVIDER_MODEL_PATTERNS.find(({ pattern }) => pattern.test(normalizedModel))?.provider ?? null;
}

function normalizeProvider(log: LogEntry): string | null {
	const explicitProvider = log.custom_llm_provider?.trim().toLowerCase();
	if (explicitProvider) return explicitProvider;

	const fallbackModels = Array.isArray(log.metadata?.fallback_models) ? log.metadata.fallback_models : [];
	const modelCandidates = [...fallbackModels.slice().reverse(), log.model];
	for (const model of modelCandidates) {
		const provider = providerFromModelName(model);
		if (provider) return provider;
	}

	return null;
}

function readHttpStatus(log: LogEntry): number | null {
	const errorInformation = log.metadata?.error_information;
	const candidates = [errorInformation?.error_code, errorInformation?.status_code, log.metadata?.status_code];

	for (const candidate of candidates) {
		const numericStatus =
			typeof candidate === "number"
				? candidate
				: typeof candidate === "string" && /^\d{3}$/.test(candidate.trim())
					? Number(candidate.trim())
					: Number.NaN;
		if (Number.isInteger(numericStatus) && numericStatus >= 100 && numericStatus <= 599) {
			return numericStatus;
		}
	}

	return null;
}

function isFailedLog(log: LogEntry): boolean {
	const status = String(log.status ?? log.metadata?.status ?? "").toLowerCase();
	return status === "" || status === "failure" || status === "error" || status === "failed";
}

function formatProviderName(provider: string): string {
	const knownProvider = PROVIDER_DETAILS[provider];
	if (knownProvider) return knownProvider.displayName;

	return provider
		.split(/[_-]+/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

export function collectProviderStatusWarnings(logs: LogEntry[], now = new Date()): ProviderStatusWarning[] {
	const cutoff = now.getTime() - RECENT_PROVIDER_ERROR_WINDOW_MS;
	const latestAllowedTimestamp = now.getTime() + MAX_CLOCK_SKEW_MS;
	const warnings = new Map<string, { requestIds: Set<string>; errorCodes: Set<number>; latestErrorAt: Date }>();

	for (const log of logs) {
		if (!isFailedLog(log)) continue;

		const httpStatus = readHttpStatus(log);
		if (httpStatus === null || httpStatus < 500) continue;

		const occurredAt = new Date(log.startTime);
		const timestamp = occurredAt.getTime();
		if (!Number.isFinite(timestamp) || timestamp < cutoff || timestamp > latestAllowedTimestamp) continue;

		const provider = normalizeProvider(log);
		if (!provider) continue;

		const existing = warnings.get(provider);
		if (existing) {
			existing.requestIds.add(log.request_id);
			existing.errorCodes.add(httpStatus);
			if (timestamp > existing.latestErrorAt.getTime()) {
				existing.latestErrorAt = occurredAt;
			}
			continue;
		}

		warnings.set(provider, {
			requestIds: new Set([log.request_id]),
			errorCodes: new Set([httpStatus]),
			latestErrorAt: occurredAt,
		});
	}

	return Array.from(warnings.entries())
		.map(([provider, warning]) => ({
			provider,
			displayName: formatProviderName(provider),
			errorCount: warning.requestIds.size,
			errorCodes: Array.from(warning.errorCodes).sort((left, right) => left - right),
			latestErrorAt: warning.latestErrorAt,
			statusPageUrl: PROVIDER_DETAILS[provider]?.statusPageUrl,
		}))
		.sort((left, right) => right.latestErrorAt.getTime() - left.latestErrorAt.getTime());
}

function formatLatestErrorTime(date: Date): string {
	return new Intl.DateTimeFormat(undefined, {
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	}).format(date);
}

export default function ProviderStatusWarnings({ logs, now = new Date() }: { logs: LogEntry[]; now?: Date }) {
	const warnings = collectProviderStatusWarnings(logs, now);
	if (warnings.length === 0) return null;

	return (
		<div className="mb-4 space-y-2" aria-label="Provider service warnings">
			{warnings.map((warning) => (
				<Alert
					key={warning.provider}
					data-testid={`provider-status-warning-${warning.provider}`}
					type="warning"
					showIcon
					message={`${warning.displayName} may be experiencing a service issue`}
					description={`${warning.errorCount} recent request${warning.errorCount === 1 ? "" : "s"} returned server errors (${warning.errorCodes.join(", ")}). Latest at ${formatLatestErrorTime(warning.latestErrorAt)}.`}
					action={
						warning.statusPageUrl ? (
							<Button type="link" size="small" href={warning.statusPageUrl} target="_blank" rel="noopener noreferrer">
								View {warning.displayName} status
							</Button>
						) : undefined
					}
				/>
			))}
		</div>
	);
}
