import { computed, shallowReactive } from "vue";
import { z } from "zod";
import { createChatHistoryStore } from "./ChatHistoryStore";
import { fetchModelGroupIcons, type ModelGroupIcons } from "../../providers/api/ModelGroupIconsApi";
import { sendInference } from "../api/PlaygroundInferenceApi";
import type { ChatComparisonExchange } from "../support/ChatModels";
import type { PlaygroundRequest } from "../support/PlaygroundModels";
import { messageManager } from "../../notifications/logic/MessageManager";
const modelKey = "litellm_chat_selected_models";
export function createChatInferenceStore(navigate: (id: string | null, replace?: boolean) => void) {
	const history = createChatHistoryStore(),
		state = shallowReactive({
			models: [] as string[],
			modelIcons: new Map() as ModelGroupIcons,
			selected: [] as string[],
			loadingModels: true,
			input: "",
			streaming: false,
			responseId: null as string | null,
			exchanges: [] as ChatComparisonExchange[],
			streamingModels: new Set<string>(),
		}),
		comparison = computed(() => state.selected.length > 1),
		loading = computed(() => state.streaming || state.streamingModels.size > 0);
	let modelController: AbortController | undefined,
		singleController: AbortController | undefined,
		generation = 0;
	const comparisonControllers = new Map<string, AbortController>();
	function persistModels() {
		try {
			localStorage.setItem(modelKey, JSON.stringify(state.selected));
		} catch {
			/* Model selection remains available in this session. */
		}
	}
	async function load() {
		modelController = new AbortController();
		try {
			const icons = await fetchModelGroupIcons(modelController.signal);
			const models = [...icons.keys()].sort((a, b) => a.localeCompare(b));
			state.modelIcons = icons;
			state.models = models;
			let saved: string[] = [];
			try {
				saved = z
					.array(z.string())
					.parse(JSON.parse(localStorage.getItem(modelKey) || "[]"))
					.filter((model) => models.includes(model));
			} catch {
				/* Ignore invalid preferences. */
			}
			state.selected = saved.length ? saved : models.slice(0, 1);
			persistModels();
		} catch {
			if (!modelController.signal.aborted) messageManager.error("Could not load models");
		} finally {
			state.loadingModels = false;
		}
	}
	function toggleModel(model: string) {
		if (state.selected.includes(model)) state.selected = state.selected.filter((item) => item !== model);
		else if (state.selected.length < 3) state.selected = [...state.selected, model];
		persistModels();
	}
	function stop() {
		singleController?.abort();
		comparisonControllers.forEach((controller) => controller.abort());
	}
	function select(id: string | null) {
		if (id !== history.state.activeId) {
			stop();
			state.responseId = null;
		}
		const valid = history.select(id);
		if (!valid) navigate(null, true);
	}
	function newChat() {
		select(null);
		navigate(null);
	}
	function request(
		model: string,
		input: string,
		messages: { role: string; content: unknown }[],
		signal: AbortSignal,
		endpoint: "chat" | "responses",
	): PlaygroundRequest {
		return {
			endpoint,
			auth: { kind: "session" },
			model,
			input,
			messages,
			customBaseUrl: undefined,
			tags: [],
			traceId: "",
			voice: "alloy",
			audio: null,
			signal,
		};
	}
	async function sendSingle(text: string, override?: { role: string; content: string }[]) {
		const input = text.trim();
		if (!input || !state.selected.length || state.streaming) return;
		const model = state.selected[0];
		state.input = "";
		let id = history.state.activeId;
		if (!id) {
			id = history.create(model);
			state.responseId = null;
			navigate(id);
		}
		const conversation = history.active.value,
			previous = override ? null : state.responseId,
			messages = override
				? [...override, { role: "user", content: input }]
				: previous
					? [{ role: "user", content: input }]
					: [
							...(conversation?.messages ?? [])
								.filter((message) => ["user", "assistant"].includes(message.role))
								.map(({ role, content }) => ({ role, content })),
							{ role: "user", content: input },
						];
		if (override) state.responseId = null;
		history.append(id, { role: "user", content: input });
		history.append(id, { role: "assistant", content: "" });
		state.streaming = true;
		const current = generation,
			controller = new AbortController();
		singleController = controller;
		let content = "",
			reasoning = "";
		const conversationId = id;
		const currentConversation = () => generation === current && history.state.activeId === conversationId;
		try {
			await sendInference(
				{ ...request(model, input, messages, controller.signal, "responses"), previousResponseId: previous },
				{
					text: (chunk) => {
						content += chunk;
						if (generation === current) history.assistant(conversationId, { content });
					},
					reasoning: (chunk) => {
						reasoning += chunk;
						if (generation === current) history.assistant(conversationId, { reasoningContent: reasoning });
					},
					responseId: (value) => {
						if (currentConversation()) state.responseId = value;
					},
				},
			);
		} catch {
			if (generation === current)
				history.assistant(conversationId, {
					content: controller.signal.aborted
						? content + " [stopped]"
						: "[Something went wrong. The partial response has been saved.]",
				});
		} finally {
			if (generation === current) {
				state.streaming = false;
				if (singleController === controller) singleController = undefined;
			}
		}
	}
	async function sendComparison(text: string) {
		const input = text.trim();
		if (!input || !state.selected.length || loading.value) return;
		state.input = "";
		const before = [...state.exchanges],
			index = before.length,
			current = generation;
		state.exchanges = [...before, { userMessage: input, responses: {} }];
		state.streamingModels = new Set(state.selected);
		const tasks = state.selected.map(async (model) => {
			const controller = new AbortController();
			comparisonControllers.set(model, controller);
			const messages = before.flatMap((exchange) => [
				{ role: "user", content: exchange.userMessage },
				{ role: "assistant", content: exchange.responses[model] ?? "" },
			]);
			messages.push({ role: "user", content: input });
			function chunk(value: string) {
				if (generation !== current) return;
				state.exchanges = state.exchanges.map((exchange, number) =>
					number === index
						? { ...exchange, responses: { ...exchange.responses, [model]: (exchange.responses[model] ?? "") + value } }
						: exchange,
				);
			}
			try {
				await sendInference(request(model, input, messages, controller.signal, "chat"), { text: chunk });
			} catch (error) {
				if (!controller.signal.aborted) chunk("\n\n_Error: " + (error instanceof Error ? error.message : String(error)) + "_");
			} finally {
				if (generation === current) {
					comparisonControllers.delete(model);
					const next = new Set(state.streamingModels);
					next.delete(model);
					state.streamingModels = next;
				}
			}
		});
		await Promise.allSettled(tasks);
	}
	function submit(text = state.input) {
		return comparison.value ? sendComparison(text) : sendSingle(text);
	}
	function edit(messageId: string, text: string) {
		const id = history.state.activeId;
		if (!id || state.streaming) return;
		const messages = history.active.value?.messages ?? [],
			index = messages.findIndex((message) => message.id === messageId),
			prior = (index < 0 ? messages : messages.slice(0, index))
				.filter((message) => ["user", "assistant"].includes(message.role))
				.map(({ role, content }) => ({ role, content }));
		history.truncate(id, messageId);
		return sendSingle(text, prior);
	}
	function remove(id: string) {
		const active = history.state.activeId === id;
		if (active) stop();
		history.remove(id);
		if (active) {
			state.responseId = null;
			navigate(null);
		}
	}
	function dispose() {
		generation++;
		stop();
		modelController?.abort();
		history.dispose();
	}
	return { state, history, comparison, loading, load, toggleModel, stop, select, newChat, submit, edit, remove, dispose };
}
export type ChatInferenceStore = ReturnType<typeof createChatInferenceStore>;
