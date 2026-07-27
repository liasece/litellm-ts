import { useCallback, useEffect, useMemo, useState } from "react";
import { allDeploymentHealthCheckCall, individualModelHealthCheckCall, latestHealthChecksCall } from "../networking";
import { errorPatterns } from "@/utils/errorPatterns";

export interface DeploymentHealthStatus {
	status: "healthy" | "unhealthy" | "checking" | "none" | "unknown";
	lastCheck: string;
	lastSuccess?: string;
	loading: boolean;
	error?: string;
	fullError?: string;
	successResponse?: unknown;
}

interface HealthCheckResponse {
	healthy_count: number;
	unhealthy_count: number;
	healthy_endpoints?: Array<{ model_id: string; [key: string]: unknown }>;
	unhealthy_endpoints?: Array<{ model_id: string; error?: unknown; [key: string]: unknown }>;
}

const defaultStatus = (): DeploymentHealthStatus => ({
	status: "none",
	lastCheck: "None",
	lastSuccess: "None",
	loading: false,
});

const normalizeHealthErrorPayload = (error: unknown): string => {
	if (error === null || error === undefined) return "Health check failed";
	if (typeof error === "string") return error || "Health check failed";
	if (error instanceof Error) return error.stack || `${error.name}: ${error.message}`;

	try {
		const serialized = JSON.stringify(error, (_key, value: unknown) =>
			typeof value === "bigint" ? value.toString() : value,
		);
		if (serialized) return serialized;
	} catch {
		// Fall through to String for non-serializable payloads.
	}

	try {
		return String(error);
	} catch {
		return "Health check failed";
	}
};

export const extractMeaningfulHealthError = (error: unknown): string => {
	const errorStr = normalizeHealthErrorPayload(error);
	const directPatternMatch = errorStr.match(/(\w+Error):\s*(\d{3})/i);
	if (directPatternMatch) return `${directPatternMatch[1]}: ${directPatternMatch[2]}`;

	const errorTypeMatch = errorStr.match(
		/(AuthenticationError|RateLimitError|BadRequestError|InternalServerError|TimeoutError|NotFoundError|ForbiddenError|ServiceUnavailableError|BadGatewayError|ContentPolicyViolationError|\w+Error)/i,
	);
	const statusCodeMatch = errorStr.match(/\b(400|401|403|404|408|429|500|502|503|504)\b/);
	if (errorTypeMatch && statusCodeMatch) return `${errorTypeMatch[1]}: ${statusCodeMatch[1]}`;

	if (statusCodeMatch) {
		const statusToError: Record<string, string> = {
			"400": "BadRequestError",
			"401": "AuthenticationError",
			"403": "ForbiddenError",
			"404": "NotFoundError",
			"408": "TimeoutError",
			"429": "RateLimitError",
			"500": "InternalServerError",
			"502": "BadGatewayError",
			"503": "ServiceUnavailableError",
			"504": "GatewayTimeoutError",
		};
		return `${statusToError[statusCodeMatch[1]]}: ${statusCodeMatch[1]}`;
	}

	if (errorTypeMatch) {
		const errorToStatus: Record<string, string> = {
			AuthenticationError: "401",
			RateLimitError: "429",
			BadRequestError: "400",
			InternalServerError: "500",
			TimeoutError: "408",
			NotFoundError: "404",
			ForbiddenError: "403",
			ServiceUnavailableError: "503",
			BadGatewayError: "502",
			GatewayTimeoutError: "504",
			ContentPolicyViolationError: "400",
		};
		return errorToStatus[errorTypeMatch[1]]
			? `${errorTypeMatch[1]}: ${errorToStatus[errorTypeMatch[1]]}`
			: errorTypeMatch[1];
	}

	for (const { pattern, replacement } of errorPatterns) {
		if (pattern.test(errorStr)) return replacement;
	}
	if (/missing.*api.*key|invalid.*key|unauthorized/i.test(errorStr)) return "AuthenticationError: 401";
	if (/rate.*limit|too.*many.*requests/i.test(errorStr)) return "RateLimitError: 429";
	if (/timeout|timed.*out/i.test(errorStr)) return "TimeoutError: 408";
	if (/not.*found/i.test(errorStr)) return "NotFoundError: 404";
	if (/forbidden|access.*denied/i.test(errorStr)) return "ForbiddenError: 403";
	if (/internal.*server.*error/i.test(errorStr)) return "InternalServerError: 500";

	const firstSentence = errorStr
		.replace(/[\n\r]+/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.split(/[.!?]/)[0]
		?.trim();
	return firstSentence && firstSentence.length > 0
		? firstSentence.length > 100
			? `${firstSentence.substring(0, 97)}...`
			: firstSentence
		: errorStr.length > 100
			? `${errorStr.substring(0, 97)}...`
			: errorStr;
};

const classify = (response: HealthCheckResponse): "healthy" | "unhealthy" => {
	if (response.unhealthy_count > 0) return "unhealthy";
	if (response.healthy_count > 0) return "healthy";
	throw new Error("Health check returned no results");
};

export const useDeploymentHealth = (accessToken: string | null, deploymentIds: string[]) => {
	const deploymentIdKey = deploymentIds.join("|");
	const knownIds = useMemo(() => [...new Set(deploymentIdKey.split("|").filter(Boolean))], [deploymentIdKey]);
	const knownIdSet = useMemo(() => new Set(knownIds), [knownIds]);
	const [statuses, setStatuses] = useState<Record<string, DeploymentHealthStatus>>({});
	const [error, setError] = useState<Error | null>(null);

	const initializeStatuses = useCallback(() => {
		setStatuses((previous) => Object.fromEntries(knownIds.map((id) => [id, previous[id] ?? defaultStatus()])));
	}, [knownIds]);

	const hydrateLatest = useCallback(async () => {
		if (!accessToken) return;
		initializeStatuses();
		try {
			const latest = await latestHealthChecksCall(accessToken);
			const checks = latest?.latest_health_checks;
			if (!checks || typeof checks !== "object") return;
			setStatuses((previous) => {
				const next = Object.fromEntries(knownIds.map((id) => [id, previous[id] ?? defaultStatus()]));
				Object.entries(checks).forEach(([id, value]) => {
					if (!knownIdSet.has(id) || typeof value !== "object" || value === null) return;
					const healthCheck = value as Record<string, unknown>;
					const status =
						healthCheck.status === "healthy" || healthCheck.status === "unhealthy" ? healthCheck.status : "unknown";
					const checkedAt = typeof healthCheck.checked_at === "string" ? healthCheck.checked_at : undefined;
					const fullError =
						healthCheck.error_message === null || healthCheck.error_message === undefined
							? undefined
							: normalizeHealthErrorPayload(healthCheck.error_message);
					next[id] = {
						status,
						lastCheck: checkedAt ? new Date(checkedAt).toLocaleString() : "None",
						lastSuccess:
							status === "healthy" && checkedAt
								? new Date(checkedAt).toLocaleString()
								: previous[id]?.lastSuccess || "None",
						loading: false,
						error: fullError ? extractMeaningfulHealthError(fullError) : undefined,
						fullError,
						successResponse: status === "healthy" ? healthCheck : undefined,
					};
				});
				return next;
			});
		} catch (cause) {
			console.warn("Failed to load health check history (using default states):", cause);
		}
	}, [accessToken, initializeStatuses, knownIds, knownIdSet]);

	useEffect(() => {
		if (accessToken) void hydrateLatest();
	}, [accessToken, hydrateLatest]);

	const applyResponse = useCallback((response: HealthCheckResponse, ids: Set<string>) => {
		const now = new Date().toLocaleString();
		setStatuses((previous) => {
			const next = { ...previous };
			for (const id of ids) next[id] = { ...(next[id] ?? defaultStatus()), loading: false, status: "none" };
			for (const endpoint of response.healthy_endpoints ?? []) {
				if (!ids.has(endpoint.model_id)) continue;
				next[endpoint.model_id] = {
					status: "healthy",
					lastCheck: now,
					lastSuccess: now,
					loading: false,
					successResponse: endpoint,
				};
			}
			for (const endpoint of response.unhealthy_endpoints ?? []) {
				if (!ids.has(endpoint.model_id)) continue;
				const fullError = normalizeHealthErrorPayload(endpoint.error);
				next[endpoint.model_id] = {
					...(next[endpoint.model_id] ?? defaultStatus()),
					status: "unhealthy",
					lastCheck: now,
					loading: false,
					error: extractMeaningfulHealthError(fullError),
					fullError,
				};
			}
			return next;
		});
	}, []);

	const runOne = useCallback(
		async (id: string) => {
			if (!accessToken || !knownIdSet.has(id)) return;
			setError(null);
			setStatuses((previous) => ({
				...previous,
				[id]: { ...(previous[id] ?? defaultStatus()), loading: true, status: "checking" },
			}));
			try {
				const response = await individualModelHealthCheckCall(accessToken, id);
				classify(response);
				applyResponse(response, new Set([id]));
			} catch (cause) {
				const fullError = normalizeHealthErrorPayload(cause);
				setStatuses((previous) => ({
					...previous,
					[id]: {
						...(previous[id] ?? defaultStatus()),
						status: "unhealthy",
						lastCheck: new Date().toLocaleString(),
						loading: false,
						error: extractMeaningfulHealthError(fullError),
						fullError,
					},
				}));
				setError(cause instanceof Error ? cause : new Error(fullError));
			}
		},
		[accessToken, applyResponse, knownIdSet],
	);

	const runSelected = useCallback(
		async (ids: string[]) => {
			const selected = ids.filter((id) => knownIdSet.has(id));
			await Promise.all(selected.map(runOne));
		},
		[knownIdSet, runOne],
	);

	const runAll = useCallback(async () => {
		if (!accessToken || knownIds.length === 0) return false;
		setError(null);
		setStatuses((previous) => ({
			...previous,
			...Object.fromEntries(knownIds.map((id) => [id, { ...(previous[id] ?? defaultStatus()), loading: true }])),
		}));
		try {
			const response = await allDeploymentHealthCheckCall(accessToken);
			applyResponse(response, knownIdSet);
			return true;
		} catch (cause) {
			setStatuses((previous) =>
				Object.fromEntries(knownIds.map((id) => [id, { ...(previous[id] ?? defaultStatus()), loading: false }])),
			);
			setError(cause instanceof Error ? cause : new Error(normalizeHealthErrorPayload(cause)));
			return false;
		}
	}, [accessToken, applyResponse, knownIds, knownIdSet]);

	return { statuses, error, hydrateLatest, runOne, runSelected, runAll };
};
