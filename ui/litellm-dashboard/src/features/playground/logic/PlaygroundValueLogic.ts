export const asRecord = (value: unknown): Record<string, unknown> | null =>
	value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
export const records = (value: unknown): Record<string, unknown>[] =>
	Array.isArray(value)
		? value.flatMap((item) => {
				const record = asRecord(item);
				return record ? [record] : [];
			})
		: [];
export const string = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);
export const number = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
export function json(value: unknown, pretty = false): string {
	try {
		return JSON.stringify(value, null, pretty ? 2 : undefined) ?? String(value);
	} catch {
		return "[Unserializable content]";
	}
}
export function notify(type: "error" | "success" | "info", message: string) {
	window.dispatchEvent(new CustomEvent("litellm-notification", { detail: { type, message } }));
}
