import { z } from "zod";
import { requestJson } from "../../platform/api/HttpApiClient";
import type { GuardrailSubmission, GuardrailSubmissionSummary } from "../support/GuardrailSubmissionModels";
const nullable = z.string().nullish(),
	record = z.record(z.string(), z.unknown()),
	submission = z
		.object({
			guardrail_id: z.string(),
			guardrail_name: z.string(),
			status: z.string(),
			team_id: nullable,
			litellm_params: record.nullish(),
			guardrail_info: record.nullish(),
			submitted_by_user_id: nullable,
			submitted_by_email: nullable,
			submitted_at: nullable,
		})
		.passthrough(),
	summary = z.object({ total: z.number(), pending_review: z.number(), active: z.number(), rejected: z.number() });
export const guardrailSubmissionsApi = {
	list: (options: { status?: string; search?: string }, signal?: AbortSignal) => {
		const query = new URLSearchParams();
		if (options.status) query.set("status", options.status);
		if (options.search) query.set("search", options.search);
		return requestJson(
			"/guardrails/submissions" + (query.size ? "?" + query : ""),
			{ signal },
			(value) =>
				z.object({ submissions: z.array(submission), summary }).parse(value) as {
					submissions: GuardrailSubmission[];
					summary: GuardrailSubmissionSummary;
				},
		);
	},
	review: (id: string, action: "approve" | "reject") =>
		requestJson(
			"/guardrails/submissions/" + encodeURIComponent(id) + "/" + action,
			{ method: "POST", headers: { "Content-Type": "application/json" } },
			(value) => z.object({ guardrail_id: z.string(), status: z.string(), message: z.string() }).passthrough().parse(value),
		),
};
