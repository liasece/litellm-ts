import type { SessionTimelineItem, SessionTimelinePart, SessionTimelineResponse, SessionTimelineSourceRow } from "./sessionTimeline";
import { SessionTimelineBuilder } from "./sessionTimeline";

/** Exact provenance required to associate a client-local output with a logged Images API call. */
export interface SessionImageLookup {
	/** The originating request's stored key identity; never match by display alias. */
	readonly apiKey: string;
	/** Literal prompt recorded in the generator command. */
	readonly prompt: string;
	/** Earliest generation start, immediately after the tool call was issued. */
	readonly from: Date;
	/** Latest generation completion, before the assistant referenced the output. */
	readonly to: Date;
}

/** A visible Images API response that may supply the missing image bytes. */
export interface SessionImageCandidate {
	/** Request identity for the recorded generation. */
	readonly requestId: string;
	/** Original response, including any retained image payload. */
	readonly response: unknown;
}

interface GenerationCommand {
	readonly apiKey: string;
	readonly path: string;
	readonly prompt: string;
	readonly timestamp: number;
}

const MAX_GENERATION_WINDOW_MS = 30 * 60 * 1000;
const LOCAL_IMAGE_PATH = /^(?:\/(?:Users|home|root|mnt|tmp|var)\/|[a-z]:[\\/]|file:\/|sandbox:\/)/i;

/**
 * Tokenize literal shell arguments without executing commands or expanding client variables.
 * @param command - Literal command recorded in a tool call
 */
function literalShellWords(command: string): string[] | null {
	const words: string[] = [];
	let word = "";
	let started = false;
	let quote = "";
	for (let index = 0; index < command.length; index += 1) {
		const char = command[index]!;
		if (char === quote) {
			quote = "";
			continue;
		}
		if (char === "\\" && quote !== "'") {
			const next = command[++index];
			if (next === undefined) {
				return null;
			}
			word += next;
			started = true;
			continue;
		}
		if (quote === "'") {
			word += char;
			continue;
		}
		if (/[\x24\x60]/.test(char) || (!quote && /[;|&<>\n]/.test(char))) {
			return null;
		}
		if (quote) {
			word += char;
		} else if (char === "'" || char === '"') {
			quote = char;
			started = true;
		} else if (/\s/.test(char)) {
			if (started) {
				words.push(word);
				word = "";
				started = false;
			}
		} else {
			word += char;
			started = true;
		}
	}
	if (quote) {
		return null;
	}
	if (started) {
		words.push(word);
	}
	return words;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function toolCommands(part: SessionTimelinePart): string[] {
	const commands = (part.parts ?? []).flatMap((nested) => toolCommands(nested));
	if (part.kind !== "tool_call") {
		return commands;
	}
	const data = asRecord(part.data);
	if (typeof data?.cmd === "string") {
		commands.push(data.cmd);
	}
	if (typeof data?.raw === "string") {
		// Codex's exec wrapper contains JSON string literals for nested exec_command calls.
		for (const match of data.raw.matchAll(/\bcmd"?\s*:\s*("(?:[^"\\]|\\.)*")/g)) {
			try {
				commands.push(JSON.parse(match[1]!) as string);
			} catch {
				// Nonliteral JavaScript cannot establish the prompt/path relationship.
			}
		}
	}
	return commands;
}

function imageReferences(event: SessionTimelineItem): Array<{ source: string; path: string }> {
	const references: Array<{ source: string; path: string }> = [];
	const collect = (text: string): void => {
		for (const match of text.matchAll(/!\[[^\]\n]*\]\(\s*(?:<([^>\n]+)>|([^\s)]+))\s*\)/g)) {
			const source = match[1] ?? match[2]!;
			let path: string;
			try {
				path = decodeURIComponent(source).replace(/^(?:file:\/\/|sandbox:)/i, "");
			} catch {
				continue;
			}
			if (LOCAL_IMAGE_PATH.test(path)) {
				references.push({ source: source, path: path });
			}
		}
	};
	const visit = (part: SessionTimelinePart): void => {
		if (part.kind === "text" && part.text) {
			collect(part.text);
		}
		part.parts?.forEach(visit);
	};
	if (event.parts?.length) {
		event.parts.forEach(visit);
	} else {
		collect(event.content);
	}
	return references;
}

function generationCommands(events: readonly SessionTimelineItem[], keys: ReadonlyMap<string, string>): GenerationCommand[] {
	const commands: GenerationCommand[] = [];
	for (const event of events) {
		const apiKey = keys.get(event.request_id);
		const timestamp = Date.parse(event.timestamp);
		if (!apiKey || !Number.isFinite(timestamp) || event.role !== "assistant") {
			continue;
		}
		for (const command of (event.parts ?? []).flatMap((part) => toolCommands(part))) {
			const words = literalShellWords(command);
			if (
				!words ||
				words.includes("--dry-run") ||
				!/(?:^|\/)node(?:js)?$/.test(words[0] ?? "") ||
				!/(?:^|\/)(?:run-generate|generate-image)\.mjs$/.test(words[1] ?? "")
			) {
				continue;
			}
			const promptIndex = words.indexOf("--prompt");
			const pathIndex = words.indexOf("--out");
			const prompt = promptIndex >= 0 ? words[promptIndex + 1] : undefined;
			const path = pathIndex >= 0 ? words[pathIndex + 1] : undefined;
			if (prompt && path && LOCAL_IMAGE_PATH.test(path)) {
				commands.push({ apiKey: apiKey, path: path, prompt: prompt, timestamp: timestamp });
			}
		}
	}
	return commands.sort((left, right) => right.timestamp - left.timestamp);
}

function candidateImage(candidate: SessionImageCandidate, prompt: string): string | undefined {
	const builder = new SessionTimelineBuilder();
	builder.add({
		request_id: candidate.requestId,
		call_type: "aimage_generation",
		spend: 0,
		total_tokens: 0,
		startTime: new Date(0),
		endTime: new Date(0),
		model: "",
		status: "success",
		metadata_status: null,
		error_information: null,
		request_payload: prompt,
		response_payload: candidate.response,
	});
	const images = builder
		.build()
		.data.flatMap((event) => event.parts ?? [])
		.filter((part) => part.kind === "image");
	if (images.length !== 1) {
		return undefined;
	}
	const source = asRecord(images[0]?.data)?.src;
	return typeof source === "string" && !source.includes("litellm_truncated") ? source : undefined;
}

/**
 * Restore local Markdown images from uniquely attributable, visible generation logs.
 * Keeps the original transcript and spend aggregates unchanged; only adds rendering sources.
 * @param timeline - Normalized session events
 * @param rows - Original request identities used to scope every association to its key
 * @param findImages - Visibility-scoped lookup of the exact prompt within the tool execution window
 */
export async function hydrateSessionTimelineImages(
	timeline: SessionTimelineResponse,
	rows: readonly Pick<SessionTimelineSourceRow, "request_id" | "api_key">[],
	findImages: (lookup: SessionImageLookup) => Promise<readonly SessionImageCandidate[]>,
): Promise<SessionTimelineResponse> {
	const keys = new Map(rows.flatMap((row) => (row.api_key ? [[row.request_id, row.api_key] as const] : [])));
	const commands = generationCommands(timeline.data, keys);
	const data = await Promise.all(
		timeline.data.map(async (event): Promise<SessionTimelineItem> => {
			if (event.role !== "assistant") {
				return event;
			}
			const apiKey = keys.get(event.request_id);
			const timestamp = Date.parse(event.timestamp);
			if (!apiKey || !Number.isFinite(timestamp)) {
				return event;
			}
			const sources: Record<string, string> = {};
			for (const reference of imageReferences(event)) {
				const command = commands.find(
					(item) =>
						item.apiKey === apiKey &&
						item.path === reference.path &&
						item.timestamp <= timestamp &&
						timestamp - item.timestamp <= MAX_GENERATION_WINDOW_MS,
				);
				if (!command) {
					continue;
				}
				const candidates = await findImages({
					apiKey: apiKey,
					prompt: command.prompt,
					from: new Date(command.timestamp),
					to: new Date(timestamp),
				});
				if (candidates.length === 1) {
					const source = candidateImage(candidates[0]!, command.prompt);
					if (source) {
						sources[reference.source] = source;
					}
				}
			}
			return Object.keys(sources).length ? { ...event, image_sources: sources } : event;
		}),
	);
	return { ...timeline, data: data };
}
