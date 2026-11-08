import { requestJson } from "../../../platform/api/HttpApiClient";
export const claudeCodeNudgeApi = {
	enabled: (signal?: AbortSignal) =>
		requestJson("/in_product_nudges", { signal, headers: { "Content-Type": "application/json" } }, (value) => {
			if (!value || typeof value !== "object" || Array.isArray(value)) return false;
			return Boolean((value as Record<string, unknown>).is_claude_code_enabled);
		}),
};
export const claudeCodeFeedbackUrl = "https://forms.gle/LZeJQ3XytBakckYa9";
