import type { PlaygroundRequest, PlaygroundCallbacks } from "../support/PlaygroundModels";
import { inferenceRequest, inferenceHeaders } from "./PlaygroundTransportApi";
import { asRecord, records, json } from "../logic/PlaygroundValueLogic";
export async function streamAgent(request: PlaygroundRequest, callbacks: PlaygroundCallbacks) {
	const started = performance.now(),
		response = await inferenceRequest(
			"/a2a/" + encodeURIComponent(request.agent),
			request.auth,
			"openai",
			{
				method: "POST",
				headers: inferenceHeaders(request.tags),
				body: json({
					jsonrpc: "2.0",
					id: crypto.randomUUID(),
					method: "message/stream",
					params: {
						message: {
							kind: "message",
							messageId: crypto.randomUUID().replace(/-/g, ""),
							role: "user",
							parts: [{ kind: "text", text: request.input }],
						},
					},
				}),
				signal: request.signal,
			},
			request.customBaseUrl,
		);
	if (!response.body) throw new Error("No response body");
	const reader = response.body.getReader(),
		decoder = new TextDecoder();
	let buffer = "",
		first = true;
	const metadata: Record<string, unknown> = {};
	const cancel = () => void reader.cancel();
	request.signal?.addEventListener("abort", cancel, { once: true });
	function apply(line: string) {
		if (!line.trim()) return;
		let chunk: Record<string, unknown> | null;
		try {
			chunk = asRecord(JSON.parse(line));
		} catch {
			return;
		}
		if (!chunk) return;
		if (first) {
			first = false;
			callbacks.timing?.(performance.now() - started);
		}
		if (chunk.error) throw new Error(String(asRecord(chunk.error)?.message || "Unknown A2A error"));
		const result = asRecord(chunk.result);
		if (!result) return;
		if (result.id || result.taskId) metadata.taskId = result.id || result.taskId;
		if (result.contextId) metadata.contextId = result.contextId;
		if (result.status) metadata.status = result.status;
		if (result.metadata) metadata.metadata = result.metadata;
		let parts: Record<string, unknown>[] = [];
		if (result.kind === "artifact-update") parts = records(asRecord(result.artifact)?.parts);
		else if (Array.isArray(result.artifacts)) parts = records(result.artifacts).flatMap((item) => records(item.parts));
		else if (result.kind !== "status-update") parts = records(result.parts);
		for (const part of parts)
			if (part.kind === "text" && typeof part.text === "string") callbacks.text(part.text, "a2a_agent/" + request.agent);
	}
	try {
		let done = false;
		while (!done) {
			if (request.signal?.aborted) throw new DOMException("Aborted", "AbortError");
			const chunk = await reader.read();
			if (chunk.done) {
				buffer += decoder.decode();
				if (buffer.trim()) apply(buffer);
				done = true;
				continue;
			}
			buffer += decoder.decode(chunk.value, { stream: true });
			let newline: number;
			while ((newline = buffer.indexOf("\n")) >= 0) {
				apply(buffer.slice(0, newline).replace(/\r$/, ""));
				buffer = buffer.slice(newline + 1);
			}
		}
		callbacks.latency?.(performance.now() - started);
		if (Object.keys(metadata).length) callbacks.a2a?.(metadata);
	} finally {
		request.signal?.removeEventListener("abort", cancel);
		void reader.cancel();
		reader.releaseLock();
	}
}
