import { z } from "zod";
import { requestJson } from "../../platform/api/HttpApiClient";
import type { LogEntry } from "../support/LogsModels";
const responseSchema = z.object({
	compliant: z.boolean(),
	regulation: z.string(),
	checks: z.array(z.object({ check_name: z.string(), article: z.string(), passed: z.boolean(), detail: z.string() })),
});
export type ComplianceResult = z.infer<typeof responseSchema>;
export async function checkLogCompliance(regulation: "eu-ai-act" | "gdpr", log: LogEntry, signal?: AbortSignal): Promise<ComplianceResult> {
	return requestJson(
		"/compliance/" + regulation,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			signal,
			body: JSON.stringify({
				request_id: log.request_id,
				user_id: log.user ?? undefined,
				model: log.model ?? undefined,
				timestamp: log.startTime,
				guardrail_information: log.metadata?.guardrail_information,
			}),
		},
		(value) => responseSchema.parse(value),
	);
}
