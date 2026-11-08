import { dashboardFetch, deriveErrorMessage, getApiBaseUrl } from "../../platform/api/HttpApiClient";
import { enrichmentSchema } from "./PoliciesSchemas";
import type { EnrichmentResult } from "../support/PolicyModels";
export interface EnrichmentCallbacks {
	competitor: (name: string) => void;
	done: (result: EnrichmentResult) => void;
	error?: (message: string) => void;
	status?: (message: string) => void;
}
export async function enrichPolicyStream(
	id: string,
	parameters: Record<string, string>,
	model: string,
	callbacks: EnrichmentCallbacks,
	options?: { instruction?: string; existingCompetitors?: string[] },
	signal?: AbortSignal,
): Promise<void> {
	const response = await dashboardFetch(getApiBaseUrl() + "/policy/templates/enrich/stream", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			template_id: id,
			parameters,
			model,
			instruction: options?.instruction,
			competitors: options?.existingCompetitors,
		}),
		signal,
	});
	if (!response.ok) throw new Error(deriveErrorMessage(await response.json()));
	if (!response.body) throw new Error("No response body");
	const reader = response.body.getReader(),
		decoder = new TextDecoder();
	let buffer = "";
	const abort = () => {
		void reader.cancel().catch(() => {});
	};
	signal?.addEventListener("abort", abort, { once: true });
	try {
		let streaming = true;
		while (streaming) {
			if (signal?.aborted) throw new DOMException("Request aborted", "AbortError");
			const chunk = await reader.read();
			if (chunk.done) {
				streaming = false;
				continue;
			}
			buffer += decoder.decode(chunk.value, { stream: true });
			const lines = buffer.split("\n");
			buffer = lines.pop() || "";
			for (const line of lines) {
				if (!line.startsWith("data: ")) continue;
				let value: unknown;
				try {
					value = JSON.parse(line.slice(6));
				} catch {
					continue;
				}
				if (!value || typeof value !== "object") continue;
				const event = value as Record<string, unknown>;
				if (event.type === "competitor" && typeof event.name === "string") callbacks.competitor(event.name);
				else if (event.type === "status" && typeof event.message === "string") callbacks.status?.(event.message);
				else if (event.type === "done") {
					const result = enrichmentSchema.safeParse(event);
					if (result.success) callbacks.done(result.data);
				} else if (event.type === "error" && typeof event.message === "string") callbacks.error?.(event.message);
			}
		}
	} finally {
		signal?.removeEventListener("abort", abort);
		reader.releaseLock();
	}
}
