export async function copyGuardrailText(text: string | null | undefined): Promise<boolean> {
	if (!text) return false;
	try {
		if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
		else {
			const element = document.createElement("textarea");
			element.value = text;
			element.style.position = "fixed";
			element.style.opacity = "0";
			document.body.appendChild(element);
			element.focus();
			element.select();
			const copied = document.execCommand("copy");
			element.remove();
			if (!copied) return false;
		}
		return true;
	} catch {
		return false;
	}
}
export const guardrailRecord = (value: unknown): Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
export const guardrailStrings = (value: unknown): string[] =>
	Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
export const legacyGuardrailText = (value: unknown): string =>
	Array.isArray(value)
		? value.map(legacyGuardrailText).join("")
		: value == null
			? ""
			: typeof value === "object"
				? JSON.stringify(value)
				: String(value);
