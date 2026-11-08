const AUTH_MATCH = [
	"invalid api key",
	"invalid authorization header format",
	"authentication error",
	"invalid proxy server token",
	"invalid jwt token",
	"invalid jwt submitted",
	"unauthorized access to metrics endpoint",
];

const FORBIDDEN_MATCH = [
	"admin-only endpoint",
	"not allowed to access model",
	"user does not have permission",
	"access forbidden",
	"invalid credentials used to access ui",
	"user not allowed to access proxy",
];

const DB_MATCH = ["db not connected", "database not initialized", "no db connected", "prisma client not initialized", "service unhealthy"];

const ROUTER_MATCH = [
	"no models configured on proxy",
	"llm router not initialized",
	"no deployments available",
	"no healthy deployment available",
	"not allowed to access model due to tags configuration",
	"invalid model name passed in",
];

const RATE_LIMIT_EXTRA = [
	"deployment over user-defined ratelimit",
	"crossed tpm / rpm / max parallel request limit",
	"max parallel request limit",
];

const BUDGET_MATCH = ["budget exceeded", "crossed budget", "provider budget"];

const ENTERPRISE_MATCH = [
	"must be a litellm enterprise user",
	"only be available for liteLLM enterprise users",
	"missing litellm-enterprise package",
	"only available on the docker image",
	"enterprise feature",
	"premium user",
];

const VALIDATION_MATCH = [
	"invalid json payload",
	"invalid request type",
	"invalid key format",
	"invalid hash key",
	"invalid sort column",
	"invalid sort order",
	"invalid limit",
	"invalid file type",
	"invalid field",
	"invalid date format",
];

const NOT_FOUND_MATCH = [
	"model not found",
	"model with id",
	"credential not found",
	"user not found",
	"team not found",
	"organization not found",
	"mcp server with id",
	"tool '", // will combine with “not found” in message
];

const EXISTS_MATCH = ["already exists", "team member is already in team", "user already exists"];

const GUARDRAIL_MATCH = [
	"violated openai moderation policy",
	"violated jailbreak threshold",
	"violated prompt_injection threshold",
	"violated content safety policy",
	"violated lasso guardrail policy",
	"blocked by pillar security guardrail",
	"violated azure prompt shield guardrail policy",
	"content blocked by model armor",
	"response blocked by model armor",
	"streaming response blocked by model armor",
	"guardrail",
	"moderation",
];

const FILE_UPLOAD_MATCH = ["invalid purpose", "service must be specified", "invalid response - response.response is none"];

const CLOUDZERO_MATCH = ["cloudzero settings not configured", "failed to decrypt cloudzero api key", "cloudzero settings not found"];

export function titleFor(status?: number, desc?: string): string {
	const d = (desc || "").toLowerCase();

	if (AUTH_MATCH.some((s) => d.includes(s))) return "Authentication Error";
	if (FORBIDDEN_MATCH.some((s) => d.includes(s))) return "Access Denied";
	if (DB_MATCH?.some?.((s: string) => d.includes(s)) || status === 503) return "Service Unavailable";
	if (BUDGET_MATCH?.some?.((s: string) => d.includes(s))) return "Budget Exceeded";
	if (ENTERPRISE_MATCH?.some?.((s: string) => d.includes(s))) return "Feature Unavailable";
	if (ROUTER_MATCH?.some?.((s: string) => d.includes(s))) return "Routing Error";

	if (EXISTS_MATCH.some((s) => d.includes(s))) return "Already Exists";
	if (GUARDRAIL_MATCH.some((s) => d.includes(s))) return "Content Blocked";

	if (FILE_UPLOAD_MATCH.some((s) => d.includes(s))) return "Validation Error";
	if (CLOUDZERO_MATCH.some((s) => d.includes(s))) return "Integration Error";

	if (VALIDATION_MATCH.some((s) => d.includes(s))) return "Validation Error";
	if (status === 404 || d.includes("not found") || NOT_FOUND_MATCH.some((s) => d.includes(s))) return "Not Found";
	if (
		status === 429 ||
		d.includes("rate limit") ||
		d.includes("tpm") ||
		d.includes("rpm") ||
		RATE_LIMIT_EXTRA?.some?.((s: string) => d.includes(s))
	)
		return "Rate Limit Exceeded";
	if (status && status >= 500) return "Server Error";
	if (status === 401) return "Authentication Error";
	if (status === 403) return "Access Denied";
	if (d.includes("enterprise") || d.includes("premium")) return "Info";
	if (status && status >= 400) return "Request Error";
	return "Error";
}

const SUCCESS_MATCH = [
	"created successfully",
	"updated successfully",
	"deleted successfully",
	"credential created successfully",
	"model added successfully",
	"team created successfully",
	"user created successfully",
	"organization created successfully",
	"cloudzero settings initialized successfully",
	"cloudzero settings updated successfully",
	"cloudzero export completed successfully",
	"mock llm request made",
	"mock slack alert sent",
	"mock email alert sent",
	"spend for all api keys and teams reset successfully",
	"monthlyglobalspend view refreshed",
	"cache cleared successfully",
	"cache set successfully",
	"ip ",
	"deleted successfully",
];

const INFO_MATCH = ["rate limit reached for deployment", "deployment cooldown period active"];

const DEPRECATION_FEATURE_WARN_MATCH = [
	"this feature is only available for litellm enterprise users",
	"enterprise features are not available",
	"regenerating virtual keys is an enterprise feature",
	"trying to set allowed_routes. this is an enterprise feature",
];

const CONFIG_WARN_MATCH = [
	"invalid maximum_spend_logs_retention_interval value",
	"error has invalid or non-convertible code",
	"failed to save health check to database",
];

export function classifyGeneralMessage(desc?: string): { kind: "success" | "info" | "warning"; title: string } | null {
	const d = (desc || "").toLowerCase();

	if (SUCCESS_MATCH.some((s) => d.includes(s))) return { kind: "success", title: "Success" };
	if (DEPRECATION_FEATURE_WARN_MATCH.some((s) => d.includes(s))) return { kind: "warning", title: "Feature Notice" };
	if (CONFIG_WARN_MATCH.some((s) => d.includes(s))) return { kind: "warning", title: "Configuration Warning" };
	if (INFO_MATCH.some((s) => d.includes(s))) return { kind: "warning", title: "Rate Limit" }; // show as warning for visibility

	return null;
}
