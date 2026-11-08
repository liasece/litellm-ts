import { asRecord } from "./PrettyMessagesBlocksLogic";
export function recordArray(value: unknown): Record<string, unknown>[] {
	return Array.isArray(value)
		? value.flatMap((item) => {
				const record = asRecord(item);
				return record ? [record] : [];
			})
		: [];
}
export function isRealtimeResponse(response: unknown): boolean {
	return recordArray(asRecord(response)?.results).some((event) =>
		["session.created", "session.updated", "response.done"].includes(String(event.type)),
	);
}
export const realtimeTranscripts = (responses: Record<string, unknown>[]): string =>
	responses
		.flatMap((response) =>
			recordArray(response.output).flatMap((output) =>
				recordArray(output.content).map((content) => String(output.role) + ": " + String(content.transcript || content.text || "")),
			),
		)
		.join("\n");
export const tokenLabel = (key: string): string => key.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
