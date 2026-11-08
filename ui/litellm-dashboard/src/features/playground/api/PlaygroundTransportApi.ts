import {
	createPlaygroundFetch,
	deriveErrorMessage,
	getApiBaseUrl,
	type PlaygroundAuth,
	type PlaygroundProtocol,
} from "../../platform/api/HttpApiClient";
export function inferenceUrl(path: string, customBaseUrl?: string): string {
	const base = (customBaseUrl || getApiBaseUrl() || (typeof window !== "undefined" ? window.location.origin : "")).replace(/\/+$/, "");
	return base + "/" + path.replace(/^\/+/, "");
}
export async function inferenceRequest(
	path: string,
	auth: PlaygroundAuth,
	protocol: PlaygroundProtocol,
	init: RequestInit = {},
	customBaseUrl?: string,
): Promise<Response> {
	const response = await createPlaygroundFetch(auth, protocol)(inferenceUrl(path, customBaseUrl), init);
	if (!response.ok) {
		const text = await response.text();
		let message = text || "Request failed with status " + response.status;
		try {
			message = deriveErrorMessage(JSON.parse(text) as unknown);
		} catch {
			/* The upstream can return plain text errors. */
		}
		throw new Error(message);
	}
	return response;
}
export function inferenceHeaders(tags: readonly string[], json = true): Headers {
	const headers = new Headers();
	if (json) headers.set("Content-Type", "application/json");
	if (tags.length) headers.set("x-litellm-tags", tags.join(","));
	return headers;
}
export async function* readServerSentEvents(
	response: Response,
	signal?: AbortSignal,
	options: { skipMalformed?: boolean } = {},
): AsyncGenerator<Record<string, unknown>> {
	if (!response.body) throw new Error("The response has no readable stream");
	const reader = response.body.getReader(),
		decoder = new TextDecoder();
	let buffer = "",
		data: string[] = [],
		eventType = "",
		finished = false,
		endedNaturally = false;
	const onAbort = () => {
		void reader.cancel().catch(() => {});
	};
	signal?.addEventListener("abort", onAbort, { once: true });

	function parse(): Record<string, unknown> | null {
		if (!data.length) {
			eventType = "";
			return null;
		}
		const text = data.join("\n");
		data = [];
		if (text === "[DONE]") {
			finished = true;
			eventType = "";
			return null;
		}
		let value: unknown;
		try {
			value = JSON.parse(text);
		} catch {
			eventType = "";
			if (options.skipMalformed) return null;
			throw new Error("Invalid streamed response");
		}
		if (!value || typeof value !== "object" || Array.isArray(value)) {
			eventType = "";
			return null;
		}
		const record = value as Record<string, unknown>;
		if (eventType && record.type === undefined) record.type = eventType;
		eventType = "";
		return record;
	}
	try {
		while (!finished) {
			if (signal?.aborted) throw new DOMException("Request aborted", "AbortError");
			const result = await reader.read();
			if (signal?.aborted) throw new DOMException("Request aborted", "AbortError");
			buffer += decoder.decode(result.value, { stream: !result.done });
			let newline = buffer.indexOf("\n");
			while (newline >= 0 && !finished) {
				const line = buffer.slice(0, newline).replace(/\r$/, "");
				buffer = buffer.slice(newline + 1);
				if (!line) {
					const frame = parse();
					if (frame) yield frame;
				} else if (!line.startsWith(":")) {
					const colon = line.indexOf(":"),
						field = colon < 0 ? line : line.slice(0, colon),
						value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
					if (field === "data") data.push(value);
					else if (field === "event") eventType = value;
				}
				newline = buffer.indexOf("\n");
			}
			if (result.done) {
				endedNaturally = true;
				if (buffer.startsWith("data:")) data.push(buffer.slice(5).replace(/^ /, "").replace(/\r$/, ""));
				const frame = parse();
				if (frame) yield frame;
				finished = true;
			}
		}
	} finally {
		if (!endedNaturally || signal?.aborted) await reader.cancel().catch(() => {});
		signal?.removeEventListener("abort", onAbort);
		reader.releaseLock();
	}
}
