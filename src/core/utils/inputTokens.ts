import { get_encoding } from "tiktoken";

function textPayload(value: unknown): unknown {
	if (Array.isArray(value)) {return value.map(textPayload);}
	if (value && typeof value === "object") {
		const row = value as Record<string, unknown>;
		if (["image", "image_url", "input_image", "input_audio", "audio", "input_file", "file", "document"].includes(String(row["type"])))
			{return { type: row["type"] };}
		return Object.fromEntries(Object.entries(row).map(([key, item]) => [key, textPayload(item)]));
	}
	return value;
}

let encoding: ReturnType<typeof get_encoding> | undefined;

/**
 * Local cl100k text/tool estimate excludes binary attachments and provider-specific image/audio/document token costs.
 * @param messages
 * @param tools
 */
export function countInputTokens(messages: unknown[], tools?: unknown): number {
	encoding ??= get_encoding("cl100k_base");
	let count = 3;
	for (const message of messages) {
		const row = message as Record<string, unknown>;
		count += 3;
		for (const [key, value] of Object.entries(row)) {
			if (value === null || value === undefined) {
				continue;
			}
			count += encoding.encode(typeof value === "string" ? value : JSON.stringify(textPayload(value)), "all").length;
			if (key === "name") {
				count += 1;
			}
		}
	}
	if (tools !== undefined) {
		count += encoding.encode(JSON.stringify(tools), "all").length;
	}
	return count;
}
