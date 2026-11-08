import { shallowReactive, watch } from "vue";
import { z } from "zod";
import type { PlaygroundCallbacks, PlaygroundEvent, PlaygroundMessage } from "../support/PlaygroundModels";
import { readStored, readText, storeValue, type PlaygroundStorage } from "../logic/PlaygroundStorageLogic";
const message = z
	.object({ role: z.string(), content: z.union([z.string(), z.array(z.record(z.string(), z.unknown()))]), id: z.string().optional() })
	.passthrough();
export function createPlaygroundHistoryStore(options: { storage?: PlaygroundStorage; simplified?: boolean } = {}) {
	const storage = options.storage,
		simplified = options.simplified ?? false;
	const persisted = simplified ? [] : readStored(storage, "chatHistory", z.array(message), []);
	const state = shallowReactive({
		messages: persisted.map((item) => ({ ...item, id: item.id ?? crypto.randomUUID() })) as PlaygroundMessage[],
		events: [] as PlaygroundEvent[],
		traceId: simplified ? null : readText(storage, "messageTraceId") || null,
		responseId: simplified ? null : readText(storage, "responsesSessionId") || null,
		useApiSession: simplified ? true : readStored(storage, "useApiSessionManagement", z.boolean(), true),
	});
	let timer: ReturnType<typeof setTimeout> | null = null;
	const cancelTimer = () => {
		if (timer !== null) clearTimeout(timer);
		timer = null;
	};
	const persist = () => {
		cancelTimer();
		if (!simplified && state.messages.length) storeValue(storage, "chatHistory", state.messages);
	};
	const stops = [
		watch(
			() => state.messages,
			() => {
				cancelTimer();
				if (!simplified && state.messages.length) timer = setTimeout(persist, 500);
			},
		),
		watch(
			[() => state.traceId, () => state.responseId, () => state.useApiSession],
			() => {
				if (simplified) return;
				storeValue(storage, "messageTraceId", state.traceId);
				storeValue(storage, "responsesSessionId", state.responseId);
				storeValue(storage, "useApiSessionManagement", state.useApiSession);
			},
			{ immediate: true },
		),
	];
	function append(value: Omit<PlaygroundMessage, "id">) {
		state.messages = [...state.messages, { ...value, id: crypto.randomUUID() }];
	}
	function updateAssistant(value: Partial<PlaygroundMessage>, create = false) {
		const last = state.messages.at(-1);
		if (last?.role === "assistant" && !last.isImage && !last.isAudio)
			state.messages = [...state.messages.slice(0, -1), { ...last, ...value }];
		else if (create && last?.role === "user") append({ role: "assistant", content: "", ...value });
	}
	const callbacks: PlaygroundCallbacks = {
		text(text, model, role = "assistant") {
			const last = state.messages.at(-1);
			if (last?.role === role && !last.isImage && !last.isAudio)
				state.messages = [
					...state.messages.slice(0, -1),
					{ ...last, content: String(last.content) + text, model: last.model ?? model },
				];
			else append({ role, content: text, model });
		},
		reasoning(text) {
			const last = state.messages.at(-1);
			updateAssistant({ reasoningContent: (last?.role === "assistant" ? (last.reasoningContent ?? "") : "") + text }, true);
		},
		timing(timeToFirstToken) {
			updateAssistant({ timeToFirstToken }, true);
		},
		latency(totalLatency) {
			updateAssistant({ totalLatency });
		},
		usage(usage, toolName) {
			updateAssistant({ usage, toolName });
		},
		search(searchResults) {
			updateAssistant({ searchResults });
		},
		a2a(a2aMetadata) {
			updateAssistant({ a2aMetadata });
		},
		image(url, model) {
			append({ role: "assistant", content: url, model, isImage: true });
		},
		audio(url, model) {
			append({ role: "assistant", content: url, model, isAudio: true });
		},
		embeddings(value, model) {
			append({ role: "assistant", content: value.length > 100 ? value.slice(0, 100) + "..." : value, model, isEmbeddings: true });
		},
		responseId(id) {
			if (state.useApiSession) state.responseId = id;
		},
		mcp(event) {
			if (
				event.item_id &&
				state.events.some(
					(previous) =>
						previous.item_id === event.item_id &&
						previous.type === event.type &&
						previous.sequence_number === event.sequence_number,
				)
			)
				return;
			state.events = [...state.events, event];
		},
	};
	function chatImage(url: string, model?: string) {
		const last = state.messages.at(-1);
		if (last?.role === "assistant" && !last.isImage && !last.isAudio)
			updateAssistant({ image: { url, detail: "auto" }, model: last.model ?? model });
		else append({ role: "assistant", content: "", model, image: { url, detail: "auto" } });
	}
	function clear() {
		cancelTimer();
		for (const entry of state.messages)
			if (entry.isAudio && typeof entry.content === "string" && entry.content.startsWith("blob:")) URL.revokeObjectURL(entry.content);
		state.messages = [];
		state.events = [];
		state.traceId = null;
		state.responseId = null;
		if (!simplified) for (const key of ["chatHistory", "messageTraceId", "responsesSessionId"]) storeValue(storage, key, null);
	}
	function toggleSession(value: boolean) {
		state.useApiSession = value;
		if (!value) state.responseId = null;
	}
	function dispose() {
		persist();
		stops.forEach((stop) => stop());
	}
	return { state, callbacks, append, chatImage, clear, toggleSession, dispose };
}
export type PlaygroundHistoryStore = ReturnType<typeof createPlaygroundHistoryStore>;
