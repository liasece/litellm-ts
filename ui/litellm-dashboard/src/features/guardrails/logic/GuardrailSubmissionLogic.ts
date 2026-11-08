import { guardrailRecord, guardrailStrings } from "../support/GuardrailClipboardSupport";
import type { GuardrailSubmission, SubmittedGuardrail } from "../support/GuardrailSubmissionModels";
export function formatSubmissionDate(value: string | null | undefined) {
	if (!value) return "—";
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? value : date.toISOString().slice(0, 10);
}
export function submissionToGuardrail(item: GuardrailSubmission): SubmittedGuardrail {
	const params = item.litellm_params ?? {},
		info = item.guardrail_info ?? {},
		headers = params.headers,
		customHeaders = Array.isArray(headers)
			? headers.map((value) => {
					const h = guardrailRecord(value);
					return { key: String(h.key ?? h.name ?? ""), value: String(h.value ?? "") };
				})
			: Object.entries(guardrailRecord(headers)).map(([key, value]) => ({ key, value: String(value ?? "") }));
	return {
		id: item.guardrail_id,
		team: item.team_id ?? "—",
		name: item.guardrail_name,
		endpoint: String(params.api_base ?? params.url ?? ""),
		status: item.status === "pending_review" ? "pending" : item.status === "rejected" ? "rejected" : "active",
		model: String(info.model ?? params.model ?? "—"),
		forwardKey: typeof params.forward_api_key === "boolean" ? params.forward_api_key : true,
		description: String(info.description ?? ""),
		method: String(params.method ?? "POST"),
		customHeaders,
		extraHeaders: guardrailStrings(params.extra_headers),
		submittedAt: formatSubmissionDate(item.submitted_at),
		submittedBy: item.submitted_by_email ?? item.submitted_by_user_id ?? "—",
		mode: typeof params.mode === "string" || Array.isArray(params.mode) ? (params.mode as string | string[]) : undefined,
		unreachable_fallback: typeof params.unreachable_fallback === "string" ? params.unreachable_fallback : undefined,
		additionalProviderParams: params.additional_provider_specific_params
			? guardrailRecord(params.additional_provider_specific_params)
			: undefined,
		guardrailType: typeof params.guardrail === "string" ? params.guardrail : undefined,
	};
}
export const submissionStatusLabel = { active: "Active", pending: "Pending Review", rejected: "Rejected" };
export const submissionTeamClass = (name: string) =>
	({ "ML Platform": "purple", "Data Science": "blue", Security: "red", "Customer Success": "orange", Legal: "gray", Finance: "green" })[
		name
	] ?? "gray";
export function addStaticHeader(existing: { key: string; value: string }[], key: string, value: string) {
	const name = key.trim();
	return name && !existing.some((header) => header.key.toLowerCase() === name.toLowerCase())
		? [...existing, { key: name, value: value.trim() }]
		: null;
}
export function addForwardHeader(existing: string[], value: string) {
	const name = value.trim().toLowerCase();
	return name && !existing.some((header) => header.toLowerCase() === name) ? [...existing, name] : null;
}
