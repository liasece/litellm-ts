import type { SubmittedGuardrail } from "../support/GuardrailSubmissionModels";
export function buildEquivalentConfigYaml(g: SubmittedGuardrail): string {
	const lines: string[] = [
		"litellm_settings:",
		"  guardrails:",
		`    - guardrail_name: "${g.name.replace(/"/g, '\\"')}"`,
		"      litellm_params:",
		`        guardrail: ${g.guardrailType ?? "generic_guardrail_api"}`,
		`        mode: ${g.mode ?? "pre_call"}  # or post_call, during_call`,
		`        api_base: ${g.endpoint || "https://your-guardrail-api.com"}`,
		"        api_key: os.environ/YOUR_GUARDRAIL_API_KEY  # optional",
		`        unreachable_fallback: ${g.unreachable_fallback ?? "fail_closed"}  # default: fail_closed. Set to fail_open to proceed if the guardrail endpoint is unreachable.`,
		`        forward_api_key: ${g.forwardKey}`,
	];
	if (g.model && g.model !== "—") {
		lines.push(`        model: "${g.model}"  # LLM model name sent to the guardrail for context`);
	}
	if (g.customHeaders.length > 0) {
		lines.push("        headers:  # static headers (sent with every request)");
		for (const h of g.customHeaders) {
			lines.push(`          ${h.key}: "${String(h.value).replace(/"/g, '\\"')}"`);
		}
	}
	if (g.extraHeaders.length > 0) {
		lines.push("        extra_headers:  # forward these client request headers to the guardrail");
		for (const name of g.extraHeaders) {
			lines.push(`          - ${name}`);
		}
	}
	if (g.additionalProviderParams && Object.keys(g.additionalProviderParams).length > 0) {
		lines.push("        additional_provider_specific_params:");
		for (const [k, v] of Object.entries(g.additionalProviderParams)) {
			const val = typeof v === "string" ? `"${v}"` : String(v);
			lines.push(`          ${k}: ${val}`);
		}
	}
	return lines.join("\n");
}
