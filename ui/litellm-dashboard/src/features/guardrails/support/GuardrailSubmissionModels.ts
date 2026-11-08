export interface GuardrailSubmission extends Record<string, unknown> {
	guardrail_id: string;
	guardrail_name: string;
	status: string;
	team_id?: string | null;
	team_guardrail?: boolean;
	litellm_params?: Record<string, unknown> | null;
	guardrail_info?: Record<string, unknown> | null;
	submitted_by_user_id?: string | null;
	submitted_by_email?: string | null;
	submitted_at?: string | null;
	reviewed_at?: string | null;
	created_at?: string | null;
	updated_at?: string | null;
}
export interface GuardrailSubmissionSummary {
	total: number;
	pending_review: number;
	active: number;
	rejected: number;
}
export type GuardrailSubmissionStatus = "active" | "pending" | "rejected";
export interface SubmittedGuardrail {
	id: string;
	team: string;
	name: string;
	endpoint: string;
	status: GuardrailSubmissionStatus;
	model: string;
	forwardKey: boolean;
	description: string;
	method: string;
	customHeaders: { key: string; value: string }[];
	extraHeaders: string[];
	submittedAt: string;
	submittedBy: string;
	mode?: string | string[];
	unreachable_fallback?: string;
	additionalProviderParams?: Record<string, unknown>;
	guardrailType?: string;
}
