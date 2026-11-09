import { shallowReactive } from "vue";
import { sendInference } from "../api/PlaygroundInferenceApi";
import { createPlaygroundCatalogStore, type PlaygroundCatalogStore } from "./PlaygroundCatalogStore";
import { createPlaygroundHistoryStore } from "./PlaygroundHistoryStore";
import { createPlaygroundSettingsStore } from "./PlaygroundSettingsStore";
import type { PlaygroundCallbacks, PlaygroundRequest } from "../support/PlaygroundModels";
import { fileDataUrl, type PlaygroundStorage } from "../logic/PlaygroundStorageLogic";
import { notify } from "../logic/PlaygroundValueLogic";
export interface PlaygroundChatOptions {
	storage?: PlaygroundStorage;
	catalog?: PlaygroundCatalogStore;
	disabledPersonalKeyCreation?: boolean;
	send?: typeof sendInference;
	authenticated?: () => boolean;
}
export function createPlaygroundChatStore(options: PlaygroundChatOptions = {}) {
	const settings = createPlaygroundSettingsStore(options),
		catalog = options.catalog ?? createPlaygroundCatalogStore(),
		history = createPlaygroundHistoryStore({ storage: settings.storage }),
		sendRequest = options.send ?? sendInference;
	const state = shallowReactive({
		input: "",
		loading: false,
		singleImage: null as File | null,
		singleImageUrl: "",
		audio: null as File | null,
		error: null as string | null,
	});
	let controller: AbortController | undefined,
		generation = 0;
	function singleImage(file: File | null) {
		if (state.singleImageUrl) URL.revokeObjectURL(state.singleImageUrl);
		state.singleImage = file;
		state.singleImageUrl = file ? URL.createObjectURL(file) : "";
	}
	function clearFiles() {
		singleImage(null);
		state.audio = null;
	}
	function notifyError(message: string) {
		state.error = message;
		notify("error", message);
	}
	function cancel(showNotice = true) {
		generation++;
		controller?.abort();
		controller = undefined;
		state.loading = false;
		if (showNotice) {
			state.input = "";
			notify("info", "Request cancelled");
		}
	}
	function clear() {
		cancel(false);
		history.clear();
		clearFiles();
		settings.state.codeResult = null;
		notify("success", "Chat history cleared.");
	}
	async function send() {
		if (state.loading) return;
		const config = settings.state,
			endpoint = config.endpoint,
			input = state.input;
		if (!input.trim() && endpoint !== "transcription") return;
		if (endpoint === "transcription" && !state.audio) {
			notifyError("Please upload an audio file for transcription");
			return;
		}
		if (!config.selectedModel) {
			notifyError("Please select a model before sending a request");
			return;
		}
		if (options.authenticated && !options.authenticated()) return;
		if (!settings.hasAuth()) {
			notifyError("Please provide a Virtual Key or select Current UI Session");
			return;
		}
		controller = new AbortController();
		const requestController = controller,
			current = ++generation;
		state.loading = true;
		state.error = null;
		const active = () => generation === current && !requestController.signal.aborted;
		const before = history.state.messages
			.filter((message) => !message.isImage && !message.isAudio)
			.map((message) => ({
				role: message.role,
				content: endpoint === "chat" && typeof message.content !== "string" ? "" : message.content,
			}));
		let newMessage: { role: string; content: unknown } = { role: "user", content: input },
			preview = state.singleImageUrl;
		const attached = state.singleImage,
			audio = state.audio;
		try {
			if (["chat", "responses"].includes(endpoint) && attached) {
				const source = await fileDataUrl(attached);
				if (!active()) return;
				newMessage = {
					role: "user",
					content:
						endpoint === "responses"
							? [
									{ type: "input_text", text: input },
									{ type: "input_image", image_url: source },
								]
							: [
									{ type: "text", text: input },
									{ type: "image_url", image_url: { url: source } },
								],
				};
				preview = source;
			}
			const display =
				endpoint === "transcription" && audio
					? "🎵 Audio file: " + audio.name + (input ? "\nPrompt: " + input : "")
					: attached && ["chat", "responses"].includes(endpoint)
						? input + " " + (attached.name.toLowerCase().endsWith(".pdf") ? "[PDF attached]" : "[Image attached]")
						: input;
			history.append({
				role: "user",
				content: display,
				...(attached && ["chat", "responses"].includes(endpoint) ? { imagePreviewUrl: preview } : {}),
			});
			settings.state.codeResult = null;
			if (!history.state.traceId) history.state.traceId = crypto.randomUUID();
			const request: PlaygroundRequest = {
				endpoint,
				auth: settings.auth(),
				model: config.selectedModel,
				input,
				messages:
					endpoint === "responses" && history.state.useApiSession && history.state.responseId
						? [newMessage]
						: [...before, newMessage],
				customBaseUrl: config.customBaseUrl || undefined,
				tags: [...config.tags],
				traceId: history.state.traceId,
				temperature: config.advancedParams ? config.temperature : undefined,
				maxTokens: config.advancedParams ? config.maxTokens : undefined,
				mockFallbacks: config.mockFallbacks,
				previousResponseId: history.state.useApiSession ? history.state.responseId : null,
				codeInterpreter: config.codeEnabled,
				voice: config.voice,
				audio,
				signal: requestController.signal,
			};
			const callbacks: PlaygroundCallbacks = {
				text: (text, model, role) => {
					if (active()) history.callbacks.text(text, model, role);
				},
				reasoning: (text) => {
					if (active()) history.callbacks.reasoning?.(text);
				},
				timing: (time) => {
					if (active()) history.callbacks.timing?.(time);
				},
				latency: (time) => {
					if (active()) history.callbacks.latency?.(time);
				},
				usage: (usage) => {
					if (active()) history.callbacks.usage?.(usage);
				},
				search: (results) => {
					if (active()) history.callbacks.search?.(results);
				},
				responseId: (id) => {
					if (active()) history.callbacks.responseId?.(id);
				},
				code: (result) => {
					if (active()) settings.state.codeResult = result;
				},
				image: (url, model) => {
					if (!active()) return;
					if (endpoint === "chat") history.chatImage(url, model);
					else history.callbacks.image?.(url, model);
				},
				audio: (url, model) => {
					if (active()) history.callbacks.audio?.(url, model);
					else if (url.startsWith("blob:")) URL.revokeObjectURL(url);
				},
				embeddings: (value, model) => {
					if (active()) history.callbacks.embeddings?.(value, model);
				},
			};
			await sendRequest(request, callbacks);
			if (active() && endpoint === "transcription") notify("success", "Audio transcribed successfully");
		} catch (error) {
			if (active()) {
				state.error = error instanceof Error ? error.message : String(error);
				history.callbacks.text("Error fetching response:" + String(error));
			}
		} finally {
			if (generation === current) {
				state.loading = false;
				controller = undefined;
				state.input = "";
				if (["responses", "chat"].includes(endpoint) && attached) singleImage(null);
				if (endpoint === "transcription" && audio) state.audio = null;
			}
		}
	}
	function dispose() {
		cancel(false);
		clearFiles();
		settings.dispose();
		history.dispose();
		if (!options.catalog) catalog.dispose();
	}
	return { state, settings, catalog, history, send, cancel, clear, singleImage, clearFiles, dispose };
}
export type PlaygroundChatStore = ReturnType<typeof createPlaygroundChatStore>;
