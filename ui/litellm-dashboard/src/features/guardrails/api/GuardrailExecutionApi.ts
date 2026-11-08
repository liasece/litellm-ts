import { z } from "zod";
import { dashboardFetch, getApiBaseUrl } from "../../platform/api/HttpApiClient";
import { guardrailRecord } from "../support/GuardrailClipboardSupport";
async function execute(path: string, body: Record<string, unknown>, fallback: string) {
	const response = await dashboardFetch(getApiBaseUrl() + path, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	if (!response.ok) {
		const text = await response.text();
		let message = fallback;
		try {
			const object = guardrailRecord(JSON.parse(text) as unknown),
				nested = guardrailRecord(object.error);
			message = String(nested.message || object.detail || object.message || message);
		} catch {
			message = text || message;
		}
		throw new Error(message);
	}
	return guardrailRecord(await response.json());
}
export const guardrailExecutionApi = {
	apply: async (name: string, text: string) => {
		const value = await execute("/guardrails/apply_guardrail", { guardrail_name: name, text }, "Failed to apply guardrail");
		return z.object({ response_text: z.string() }).passthrough().parse(value);
	},
	custom: (body: Record<string, unknown>) => execute("/guardrails/test_custom_code", body, "Failed to test custom code guardrail"),
};
