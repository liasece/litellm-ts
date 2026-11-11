import { createHash } from "node:crypto";
import { canonicalJson } from "../spend/SpendLogBlocks";
import type { ImageCompletionAsset } from "../db/schema/imageCompletions";

/** Protocol of the public downstream transcript. */
export type ImageHistoryProtocol = "anthropic" | "chat" | "responses";
/** One public protocol item. */
export type HistoryMessage = Record<string, unknown>;

type Event = readonly [string, ...unknown[]];

/** Immutable, public boundaries at which a private observation is safe to replay. */
export interface ImageReplyBoundary {
	/** First and last item of the public assistant response. */
	start: number;
	/** Last assistant item, before any client tool results. */
	end: number;
	/** Replay after all paired tool outputs. Undefined while any public call is outstanding. */
	after?: number;
	/** This reply belongs to the uninterrupted final chain of public artifact inspections. */
	continuesWithTools?: boolean;
	/** Authenticated, branch-specific lookup keys. */
	keys: string[];
	/** Local Responses output items in this public reply. */
	images: { index: number; id: string }[];
}

/** @param value - JSON object from a protocol message. */
function record(value: unknown): HistoryMessage | undefined {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as HistoryMessage) : undefined;
}

/** @param value - JSON-compatible values, with explicit boundaries between tuple elements. */
export function historyDigest(value: unknown): string {
	return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

/** @param value - Function arguments may be JSON strings or already parsed objects. */
function argumentsValue(value: unknown): unknown {
	if (typeof value !== "string") {
		return value;
	}
	try {
		return JSON.parse(value) as unknown;
	} catch {
		return value;
	}
}

/** @param content - Representation of a public tool result. */
function resultValue(content: unknown): unknown {
	if (!Array.isArray(content)) {
		return content;
	}
	const parts = content.map(record);
	if (parts.every((part) => part && ["text", "input_text", "output_text"].includes(String(part.type)) && typeof part.text === "string")) {
		return parts.map((part) => part!.text).join("");
	}
	return content;
}

/** @param message - One public message or native Responses item. */
function assistantItem(message: HistoryMessage): boolean {
	return (
		message.role === "assistant" ||
		["function_call", "custom_tool_call", "image_generation_call", "reasoning"].includes(String(message.type))
	);
}

/** @param message - One public message or native Responses item. */
function publicEvents(message: HistoryMessage): Event[] {
	const role = message.role;
	const type = message.type;
	if (type === "reasoning" || type === "image_generation_call") {
		return [];
	}
	if (type === "function_call" || type === "custom_tool_call") {
		return [
			["call", message.call_id ?? message.id, message.namespace, message.name, argumentsValue(message.arguments ?? message.input)],
		];
	}
	if (type === "function_call_output" || type === "custom_tool_call_output") {
		return [["result", message.call_id, resultValue(message.output)]];
	}
	if (type === "input_text" && typeof message.text === "string") {
		return [["text", "user", message.text]];
	}
	if (!role && type !== "message") {
		return [["item", message]];
	}
	if (role === "tool") {
		return [["result", message.tool_call_id, resultValue(message.content)]];
	}
	const events: Event[] = [];
	let text = "";
	const flush = (): void => {
		if (text) {
			events.push(["text", role, text]);
		}
		text = "";
	};
	const content = typeof message.content === "string" ? [{ type: "text", text: message.content }] : message.content;
	for (const value of Array.isArray(content) ? content : []) {
		const part = record(value);
		if (!part || part.type === "thinking" || part.type === "redacted_thinking") {
			continue;
		}
		if (["text", "input_text", "output_text"].includes(String(part.type)) && typeof part.text === "string") {
			text += part.text;
			continue;
		}
		flush();
		if (part.type === "tool_use") {
			events.push(["call", part.id, undefined, part.name, argumentsValue(part.input)]);
		} else if (part.type === "tool_result") {
			events.push(["result", part.tool_use_id, resultValue(part.content), part.is_error === true]);
		} else {
			const { cache_control: _cache, ...body } = part;
			events.push(["part", role, body]);
		}
	}
	flush();
	for (const value of Array.isArray(message.tool_calls) ? message.tool_calls : []) {
		const call = record(value);
		const fn = record(call?.function);
		if (fn) {
			events.push(["call", call?.id, undefined, fn.name, argumentsValue(fn.arguments)]);
		}
	}
	return events;
}

// User work can arrive inside a delegated tool result. Check only for explicit
// work/user envelopes; e.g. a filename containing "task" does not introduce work.
const WORK_INPUT =
	/["'](?:workItem|work[_-]?id|task[_-]?id|user[_-]?input|new[_-]?(?:task|work)|work_current|work_next)["']\s*:|["']role["']\s*:\s*["']user["']|(?:^|\n)\s*(?:new (?:task|work item|user message)|user input|新任务|新工单|用户输入)\s*[:：]/iu;
const EXTERNAL_SOURCE =
	/:\/\/|\b(?:curl|wget|ssh|scp|work_current|work_next|next[_-]?(?:ticket|task)|eval|source)\b|(?:^|[\s/._-])(?:inbox|work[_-]?items?|tasks?|tickets?|jobs?|instructions?)(?:$|[\s/._-])/iu;
const FILE_QUERY = /^(?:ls|pwd|find|stat|file|shasum|sha256sum|cat|grep|rg)$/u;
const SHELL_HELPER = /^(?:cd|head|tail|date|echo|printf|wc|sort|awk|for|do|then|if|fi|done|\[)$/u;

/** @param call - A model-issued public call, normalized in all three protocols. */
function isArtifactInspection(call: Event): boolean {
	const name = String(call[3]).toLowerCase();
	const args = record(call[4]);
	if (!args || (call[2] && call[2] !== "functions")) {
		return false;
	}
	if (["read", "read_file"].includes(name)) {
		const path = args.file_path ?? args.path ?? args.filePath;
		return typeof path === "string" && !!path && !EXTERNAL_SOURCE.test(path);
	}
	const command = args.command ?? args.cmd;
	if (
		!["bash", "exec_command", "shell"].includes(name) ||
		typeof command !== "string" ||
		EXTERNAL_SOURCE.test(command) ||
		/[`]|(?:^|[;&|<>])\s*\(|\b(?:system|eval)\s*\(|-exec(?:dir)?\s+(?!file\b|ls\b|stat\b|echo\b)|-(?:delete|ok|okdir)\b/u.test(command)
	) {
		return false;
	}
	// Recognize local filesystem queries. Unknown executables (including scripts
	// reached after cd, a pipe or command substitution) open a new scope.
	const heads = command.matchAll(/(?:^|[;&|\n]|\$\()(?=\s*(?:do\s+|then\s+)?([^\s;&|()]+))/gu);
	let inspected = false;
	for (const [, head] of heads) {
		if (!head) {
			continue;
		}
		if (/^[a-zA-Z_]\w*=(?:\$|["'][^"']*["'])$/u.test(head)) {
			continue;
		}
		if (FILE_QUERY.test(head)) {
			inspected = true;
		} else if (!SHELL_HELPER.test(head)) {
			return false;
		}
	}
	return inspected;
}

interface ActiveWorkItem {
	/** Canonical identity, version and request content supplied by the work source. */
	identity: string;
	/** Seen user instructions, including edits to a message retaining the same ID. */
	instructions: Set<string>;
}

function readWorkItem(result: unknown): ActiveWorkItem | undefined {
	const output = record(argumentsValue(result));
	const item = record(output?.workItem);
	if (
		!item ||
		typeof item.id !== "string" ||
		!item.id ||
		(typeof item.inputVersion !== "number" && typeof item.inputVersion !== "string") ||
		!Array.isArray(output?.messages)
	) {
		return undefined;
	}
	const instructions = new Set<string>();
	for (const raw of output.messages) {
		const msg = record(raw);
		if (!msg || msg.workId !== item.id || !["user", "assistant", "tool"].includes(String(msg.role))) {
			return undefined;
		}
		if (msg.role === "user") {
			if (typeof msg.id !== "string" || !msg.id || msg.content === undefined) {
				return undefined;
			}
			instructions.add(historyDigest([msg.id, msg.content]));
		}
	}
	return { identity: historyDigest([item.id, item.inputVersion, item.title, item.prompt]), instructions: instructions };
}

function readsWork(call: Event): boolean {
	const name = String(call[3]);
	return /^(?:mcp__[\w.-]+__)?work[._](?:current|next)$/iu.test(name) || (call[2] === "work" && /^(?:current|next)$/iu.test(name));
}

/**
 * Associate historical slots only across consecutive, completely paired public checks.
 * A new user, unknown tool, unpaired result or new work source ends the previous
 * task. A queue may repeat the identical work item after an acknowledgement.
 * @param boundaries - Public assistant turns.
 * @param events - Normalized events of the untouched client transcript.
 */
function markContinuingInspections(boundaries: ImageReplyBoundary[], events: Event[][]): void {
	let work: ActiveWorkItem | undefined;
	let previousEnd = -1;
	let eligible: ImageReplyBoundary[] = [];
	for (const boundary of boundaries) {
		if (boundary.start !== previousEnd + 1) {
			work = undefined;
			eligible = [];
		}
		previousEnd = boundary.after ?? boundary.end;
		if (boundary.after === undefined || boundary.after === boundary.end) {
			work = undefined;
			eligible = [];
			continue;
		}
		const calls = events
			.slice(boundary.start, boundary.end + 1)
			.flat()
			.filter((event) => event[0] === "call");
		const pending = new Map(calls.map((call) => [call[1], call]));
		let sameTask = true;
		let valid = pending.size === calls.length;
		for (const [kind, id, value] of events.slice(boundary.end + 1, boundary.after + 1).flat()) {
			const call = pending.get(id);
			if (kind !== "result" || !call) {
				valid = false;
				break;
			}
			pending.delete(id);
			if (readsWork(call)) {
				const item = readWorkItem(value);
				if (!item) {
					valid = false;
					break;
				}
				const same =
					item.identity === work?.identity && [...item.instructions].every((instruction) => work!.instructions.has(instruction));
				if (!same) {
					sameTask = false;
					work = item;
				}
			} else if (!isArtifactInspection(call) || WORK_INPUT.test(typeof value === "string" ? value : (JSON.stringify(value) ?? ""))) {
				valid = false;
				break;
			}
		}
		if (!valid || pending.size) {
			work = undefined;
		}
		if (valid && !pending.size && sameTask) {
			eligible.push(boundary);
		} else {
			eligible = [];
		}
	}
	if (previousEnd === events.length - 1) {
		for (const boundary of eligible) {
			boundary.continuesWithTools = true;
		}
	}
}

/** @param id - Public image ID issued by this gateway. */
export function imageItemKey(id: string): string {
	return `image:${id}`;
}

/**
 * Hash the public branch incrementally. Transport-only thinking and streamed chunk boundaries
 * may change on replay. No private provider transcript, image bytes or user text is persisted.
 * @param messages - Unmodified downstream history.
 * @param allowTextKey - An authenticated session is required for text-only lookup.
 * @param inspectContinuation - Identify the active public tool chain when restoring paid work.
 */
export function describeImageTranscript(
	messages: readonly HistoryMessage[],
	allowTextKey: boolean,
	inspectContinuation = false,
): ImageReplyBoundary[] {
	const branch = createHash("sha256");
	const boundaries: ImageReplyBoundary[] = [];
	const events = messages.map(publicEvents);
	const add = (parts: Event[]): void => {
		for (const part of parts) {
			branch.update(canonicalJson(part)).update("\0");
		}
	};
	for (let i = 0; i < messages.length; ) {
		if (!assistantItem(messages[i]!)) {
			add(events[i]!);
			i++;
			continue;
		}
		const start = i;
		const parent = branch.copy().digest("hex");
		const keys: string[] = [];
		const images: ImageReplyBoundary["images"] = [];
		const pending = new Set<string>();
		let hasContent = false;
		while (i < messages.length && assistantItem(messages[i]!)) {
			const msg = messages[i]!;
			for (const part of events[i]!) {
				hasContent = true;
				if (part[0] === "call" && typeof part[1] === "string" && part[1]) {
					pending.add(part[1]);
					keys.push(`call:${historyDigest([parent, part])}`);
				}
			}
			if (
				msg.type === "image_generation_call" &&
				typeof msg.id === "string" &&
				/^imggen_[a-f0-9]{32}$/u.test(msg.id) &&
				msg.status === "completed"
			) {
				keys.push(imageItemKey(msg.id));
				images.push({ index: i, id: msg.id });
			}
			add(events[i]!);
			i++;
		}
		if (allowTextKey && hasContent) {
			keys.push(`reply:${branch.copy().digest("hex")}`);
		}
		const end = i - 1;
		let after = end;
		for (let j = i; pending.size && j < messages.length; j++) {
			const results = events[j]!.filter((event) => event[0] === "result");
			if (!results.length) {
				break;
			}
			for (const result of results) {
				pending.delete(String(result[1]));
			}
			after = j;
		}
		boundaries.push({ start: start, end: end, after: pending.size ? undefined : after, keys: keys, images: images });
	}
	if (inspectContinuation) {
		markContinuingInspections(boundaries, events);
	}
	return boundaries;
}

/**
 * A model-only observation is inserted at the first new, safe boundary. It never migrates to the
 * beginning or the moving end of the conversation as later turns or additional images arrive.
 * @param protocol - Upstream projection protocol.
 * @param assets - Only verified, immutable assets of the current branch.
 */
export function imageCompletionMessage(protocol: ImageHistoryProtocol, assets: readonly ImageCompletionAsset[]): HistoryMessage {
	const description = assets
		.map(
			({ action, id, ref, target }) =>
				`${action} completed: ${id} (${ref})${target ? ` [output ${target.index}/${target.count}]` : ""}`,
		)
		.join("\n");
	const text = `[LiteLLM image operation record]\n${description}\nLiteLLM uses API response attachments for generated images. It does not create files in the client workspace. Reuse these artifacts when continuing delivery or verification. Delivery or read status comes from the client tool result.`;
	if (protocol === "responses") {
		return { type: "message", role: "user", content: [{ type: "input_text", text: text }] };
	}
	if (protocol === "anthropic") {
		return { role: "user", content: [{ type: "text", text: text }] };
	}
	return { role: "user", content: text };
}
