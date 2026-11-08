export interface ErrorPattern {
	pattern: RegExp;
	replacement: string;
}

// Centralised list of common error patterns.
// Add new patterns here without touching component files.
export const errorPatterns: ErrorPattern[] = [
	// Generic missing API key (covers OpenAI, Anthropic, etc.)
	{
		pattern: /Missing .* API Key/i,
		replacement: "Missing API Key",
	},
	// Network / connectivity issues
	{
		pattern: /Connection timeout/i,
		replacement: "Connection timeout",
	},
	{
		pattern: /Network.*not.*ok/i,
		replacement: "Network connection failed",
	},
	// HTTP status based errors
	{
		pattern: /403.*Forbidden/i,
		replacement: "Access forbidden - check API key permissions",
	},
	{
		pattern: /401.*Unauthorized/i,
		replacement: "Unauthorized - invalid API key",
	},
	{
		pattern: /429.*rate limit/i,
		replacement: "Rate limit exceeded",
	},
	{
		pattern: /500.*Internal Server Error/i,
		replacement: "Provider internal server error",
	},
	// LiteLLM specific wrapped errors
	{
		pattern: /litellm\.AuthenticationError/i,
		replacement: "Authentication failed",
	},
	{
		pattern: /litellm\.RateLimitError/i,
		replacement: "Rate limit exceeded",
	},
	{
		pattern: /litellm\.APIError/i,
		replacement: "API error",
	},
];

export const normalizeHealthErrorPayload = (error: unknown): string => {
	if (error === null || error === undefined) return "Health check failed";
	if (typeof error === "string") return error || "Health check failed";
	if (error instanceof Error) return error.stack || `${error.name}: ${error.message}`;

	try {
		const serialized = JSON.stringify(error, (_key, value: unknown) => (typeof value === "bigint" ? value.toString() : value));
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
		return errorToStatus[errorTypeMatch[1]] ? `${errorTypeMatch[1]}: ${errorToStatus[errorTypeMatch[1]]}` : errorTypeMatch[1];
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
