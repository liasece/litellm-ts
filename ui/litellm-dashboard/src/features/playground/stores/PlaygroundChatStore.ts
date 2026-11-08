import { shallowReactive } from "vue";
import { sendInference } from "../api/PlaygroundInferenceApi";
import { playgroundCatalogApi } from "../api/PlaygroundCatalogApi";
import { createPlaygroundCatalogStore, type PlaygroundCatalogStore } from "./PlaygroundCatalogStore";
import { createPlaygroundHistoryStore } from "./PlaygroundHistoryStore";
import { createPlaygroundSettingsStore } from "./PlaygroundSettingsStore";
import type { PlaygroundCallbacks, PlaygroundRequest, PlaygroundAuth } from "../support/PlaygroundModels";
import { fileDataUrl, type PlaygroundStorage } from "../logic/PlaygroundStorageLogic";
import { asRecord, records, json, notify } from "../logic/PlaygroundValueLogic";
export interface PlaygroundChatOptions {
	storage?: PlaygroundStorage;
	catalog?: PlaygroundCatalogStore;
	simplified?: boolean;
	fixedModel?: string;
	disabledPersonalKeyCreation?: boolean;
	inferenceAuth?: () => PlaygroundAuth | undefined;
	send?: typeof sendInference;
	authenticated?: () => boolean;
}
export function createPlaygroundChatStore(options: PlaygroundChatOptions = {}) {
	const settings = createPlaygroundSettingsStore(options),
		catalog = options.catalog ?? createPlaygroundCatalogStore(),
		history = createPlaygroundHistoryStore({ storage: settings.storage, simplified: options.simplified }),
		sendRequest = options.send ?? sendInference;
	const state = shallowReactive({
		input: "",
		loading: false,
		images: [] as File[],
		imageUrls: [] as string[],
		singleImage: null as File | null,
		singleImageUrl: "",
		audio: null as File | null,
		error: null as string | null,
		toolArguments: {} as Record<string, unknown>,
		byokServer: null as string | null,
	});
	let controller: AbortController | undefined,
		generation = 0;
	function addImages(files: File[]) {
		state.images = [...state.images, ...files];
		state.imageUrls = [...state.imageUrls, ...files.map((file) => URL.createObjectURL(file))];
	}
	function removeImage(index: number) {
		const url = state.imageUrls[index];
		if (url) URL.revokeObjectURL(url);
		state.images = state.images.filter((_, i) => i !== index);
		state.imageUrls = state.imageUrls.filter((_, i) => i !== index);
	}
	function singleImage(file: File | null) {
		if (state.singleImageUrl) URL.revokeObjectURL(state.singleImageUrl);
		state.singleImage = file;
		state.singleImageUrl = file ? URL.createObjectURL(file) : "";
	}
	function clearFiles() {
		state.imageUrls.forEach((url) => URL.revokeObjectURL(url));
		state.images = [];
		state.imageUrls = [];
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
		if (!input.trim() && !["transcription", "mcp"].includes(endpoint)) return;
		if (endpoint === "image_edits" && !state.images.length) {
			notifyError("Please upload at least one image for editing");
			return;
		}
		if (endpoint === "transcription" && !state.audio) {
			notifyError("Please upload an audio file for transcription");
			return;
		}
		if (endpoint === "a2a_agents" && !config.selectedAgent) {
			notifyError("Please select an agent to send a message");
			return;
		}
		const server = config.mcpServers.length === 1 && config.mcpServers[0] !== "__all__" ? config.mcpServers[0] : null;
		if (endpoint === "mcp") {
			if (!server) {
				notifyError("Please select an MCP server to test");
				return;
			}
			if (!config.directTool) {
				notifyError("Please select an MCP tool to call");
				return;
			}
			if (!catalog.state.tools[server]?.some((tool) => tool.name === config.directTool)) {
				notifyError("Please wait for tool schema to load");
				return;
			}
		}
		if (!["mcp", "a2a_agents"].includes(endpoint) && !config.selectedModel) {
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
			images = [...state.images],
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
					: endpoint === "mcp"
						? "🔧 MCP Tool: " + config.directTool + "\nArguments: " + json(state.toolArguments, true)
						: attached && ["chat", "responses"].includes(endpoint)
							? input + " " + (attached.name.toLowerCase().endsWith(".pdf") ? "[PDF attached]" : "[Image attached]")
							: input;
			history.append({
				role: "user",
				content: display,
				...(attached && ["chat", "responses"].includes(endpoint) ? { imagePreviewUrl: preview } : {}),
			});
			history.state.events = [];
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
				guardrails: [...config.guardrails],
				policies: [...config.policies],
				vectorStores: [...config.vectors],
				mcpServers: catalog.state.servers,
				selectedMcpServers: [...config.mcpServers],
				mcpRestrictions: { ...config.mcpRestrictions },
				traceId: history.state.traceId,
				temperature: config.advancedParams ? config.temperature : undefined,
				maxTokens: config.advancedParams ? config.maxTokens : undefined,
				mockFallbacks: config.mockFallbacks,
				previousResponseId: history.state.useApiSession ? history.state.responseId : null,
				codeInterpreter: config.codeEnabled,
				voice: config.voice,
				images,
				audio,
				agent: config.selectedAgent,
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
				usage: (usage, tool) => {
					if (active()) history.callbacks.usage?.(usage, tool);
				},
				search: (results) => {
					if (active()) history.callbacks.search?.(results);
				},
				a2a: (metadata) => {
					if (active()) history.callbacks.a2a?.(metadata);
				},
				mcp: (event) => {
					if (active()) history.callbacks.mcp?.(event);
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
			if (endpoint === "mcp" && server) {
				const result = await playgroundCatalogApi.callTool(server, config.directTool, state.toolArguments, {
					guardrails: config.guardrails,
					signal: requestController.signal,
				});
				if (!active()) return;
				const content = records(asRecord(result)?.content),
					text = content.length
						? json(content.map((item) => (item.type === "text" ? item.text : item)).filter(Boolean), true)
						: json(result, true);
				callbacks.text(text || "Tool executed successfully.");
			} else await sendRequest(request, callbacks);
			if (active() && endpoint === "transcription") notify("success", "Audio transcribed successfully");
			if (active() && endpoint === "image_edits" && images.length > 1)
				notify("success", "Successfully processed " + images.length + " images");
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
				if (endpoint === "image_edits") {
					state.imageUrls.forEach((url) => URL.revokeObjectURL(url));
					state.images = [];
					state.imageUrls = [];
				}
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
	return { state, settings, catalog, history, send, cancel, clear, addImages, removeImage, singleImage, clearFiles, dispose };
}
export type PlaygroundChatStore = ReturnType<typeof createPlaygroundChatStore>;
