import { inferenceHeaders, inferenceRequest } from "./PlaygroundTransportApi";
import { asRecord, records, string, json } from "../logic/PlaygroundValueLogic";
import type { PlaygroundRequest, PlaygroundCallbacks } from "../support/PlaygroundModels";
export function extractA2AMetadata(result: Record<string, unknown>): Record<string, unknown> | undefined {
	const metadata: Record<string, unknown> = {},
		status = asRecord(result.status);
	if (typeof result.id === "string") metadata.taskId = result.id;
	if (typeof result.contextId === "string") metadata.contextId = result.contextId;
	if (status) {
		const text = records(asRecord(status.message)?.parts)
			.filter((part) => part.kind === "text" && typeof part.text === "string")
			.map((part) => part.text)
			.join(" ");
		metadata.status = { state: status.state, timestamp: status.timestamp, ...(text ? { message: text } : {}) };
	}
	if (asRecord(result.metadata)) metadata.metadata = result.metadata;
	return Object.keys(metadata).length ? metadata : undefined;
}
export function a2aText(result: Record<string, unknown>): string {
	const parts = Array.isArray(result.artifacts)
		? records(result.artifacts).flatMap((artifact) => records(artifact.parts))
		: Array.isArray(result.parts)
			? records(result.parts)
			: records(asRecord(asRecord(result.status)?.message)?.parts);
	return parts
		.filter((part) => part.kind === "text" && typeof part.text === "string")
		.map((part) => part.text)
		.join("");
}
export async function sendA2AMessage(request: PlaygroundRequest, callbacks: PlaygroundCallbacks): Promise<void> {
	const started = performance.now(),
		body = {
			jsonrpc: "2.0",
			id: crypto.randomUUID(),
			method: "message/send",
			params: {
				message: {
					kind: "message",
					messageId: crypto.randomUUID().replace(/-/g, ""),
					role: "user",
					parts: [{ kind: "text", text: request.input }],
				},
				...(request.guardrails.length ? { metadata: { guardrails: request.guardrails } } : {}),
			},
		};
	const response = await inferenceRequest(
		"/a2a/" + encodeURIComponent(request.agent) + "/message/send",
		request.auth,
		"openai",
		{ method: "POST", headers: inferenceHeaders([]), body: JSON.stringify(body), signal: request.signal },
		request.customBaseUrl,
	);
	callbacks.timing?.(performance.now() - started);
	const payload = asRecord(await response.json());
	callbacks.latency?.(performance.now() - started);
	if (payload?.error) throw new Error(string(asRecord(payload.error)?.message) ?? "Unknown A2A error");
	const result = asRecord(payload?.result);
	if (!result) return;
	const metadata = extractA2AMetadata(result);
	if (metadata) callbacks.a2a?.(metadata);
	callbacks.text(a2aText(result) || json(result, true), "a2a_agent/" + request.agent);
}
