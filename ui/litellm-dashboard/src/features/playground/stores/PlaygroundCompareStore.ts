import { shallowReactive } from "vue";
import type { ComparisonEndpoint, ComparisonInstance, ComparisonSettings } from "../support/PlaygroundCompareModels";
import type { PlaygroundAuth, PlaygroundCallbacks, PlaygroundRequest } from "../support/PlaygroundModels";
import { createPlaygroundCatalogStore } from "./PlaygroundCatalogStore";
import { createPlaygroundHistoryStore } from "./PlaygroundHistoryStore";
import { sendInference } from "../api/PlaygroundInferenceApi";
import { streamAgent } from "../api/PlaygroundAgentStreamApi";
import { browserSessionStorage, fileDataUrl, readText } from "../logic/PlaygroundStorageLogic";
import { notify } from "../logic/PlaygroundValueLogic";
export function createPlaygroundCompareStore(disabledPersonalKeyCreation = false) {
	const catalog = createPlaygroundCatalogStore(),
		state = shallowReactive({
			comparisons: [] as ComparisonInstance[],
			endpoint: "/v1/chat/completions" as ComparisonEndpoint,
			source: disabledPersonalKeyCreation ? "custom" : "session",
			apiKey: "",
			input: "",
			file: null as File | null,
			preview: "",
		}),
		controllers = new Map<string, AbortController>(),
		base = readText(browserSessionStorage(), "customProxyBaseUrl");
	let generation = 0;
	function create(id: string = crypto.randomUUID()): ComparisonInstance {
		const index = state.comparisons.length;
		return {
			id,
			model: catalog.state.models[index % Math.max(catalog.state.models.length, 1)]?.model_group ?? "",
			agent: catalog.state.agents[index % Math.max(catalog.state.agents.length, 1)]?.agent_name ?? "",
			history: createPlaygroundHistoryStore({ simplified: true }),
			loading: false,
			tags: [],
			vectorStores: [],
			guardrails: [],
			temperature: 1,
			maxTokens: 2048,
			useAdvancedParams: false,
			applyAcrossModels: false,
		};
	}
	state.comparisons = [create("1"), create("2")];
	function touch() {
		state.comparisons = [...state.comparisons];
	}
	function update(id: string, patch: Partial<ComparisonInstance>, shared: (keyof ComparisonSettings)[] = []) {
		state.comparisons = state.comparisons.map((item) => {
			if (item.id === id) return { ...item, ...patch };
			if (shared.length) {
				const next = { ...item };
				for (const key of shared) {
					if (key === "tags" || key === "vectorStores" || key === "guardrails") {
						const value = patch[key];
						if (value) next[key] = [...value];
					} else if (key === "useAdvancedParams") {
						if (patch.useAdvancedParams !== undefined) next.useAdvancedParams = patch.useAdvancedParams;
					} else if (key === "temperature" && patch.temperature !== undefined) next.temperature = patch.temperature;
					else if (key === "maxTokens" && patch.maxTokens !== undefined) next.maxTokens = patch.maxTokens;
				}
				return next;
			}
			return item;
		});
	}
	function settings<K extends keyof ComparisonSettings>(id: string, key: K, value: ComparisonSettings[K]) {
		const item = state.comparisons.find((item) => item.id === id);
		if (!item) return;
		update(id, { [key]: value }, item.applyAcrossModels ? [key] : []);
	}
	function sync(id: string, enabled: boolean) {
		const item = state.comparisons.find((item) => item.id === id);
		if (!item) return;
		update(
			id,
			{
				applyAcrossModels: enabled,
				temperature: item.temperature,
				maxTokens: item.maxTokens,
				tags: [...item.tags],
				vectorStores: [...item.vectorStores],
				guardrails: [...item.guardrails],
				useAdvancedParams: item.useAdvancedParams,
			},
			enabled ? ["temperature", "maxTokens", "tags", "vectorStores", "guardrails", "useAdvancedParams"] : [],
		);
	}
	function add() {
		if (state.comparisons.length < 3) state.comparisons = [...state.comparisons, create()];
	}
	function remove(id: string) {
		if (state.comparisons.length <= 1) return;
		controllers.get(id)?.abort();
		controllers.delete(id);
		state.comparisons.find((item) => item.id === id)?.history.dispose();
		state.comparisons = state.comparisons.filter((item) => item.id !== id);
	}
	function file(value: File | null) {
		if (state.preview) URL.revokeObjectURL(state.preview);
		state.file = value;
		state.preview = value ? URL.createObjectURL(value) : "";
	}
	function clear() {
		generation++;
		controllers.forEach((controller) => controller.abort());
		controllers.clear();
		for (const item of state.comparisons) item.history.clear();
		state.comparisons = state.comparisons.map((item) => ({ ...item, loading: false, traceId: undefined }));
		state.input = "";
		file(null);
	}
	const auth = (): PlaygroundAuth =>
		state.source === "session" ? { kind: "session" } : { kind: "virtual-key", apiKey: state.apiKey.trim() };
	async function load() {
		await catalog.load();
		state.comparisons = state.comparisons.map((item, index) => ({
			...item,
			model: item.model || catalog.state.models[index % Math.max(catalog.state.models.length, 1)]?.model_group || "",
		}));
	}
	async function loadAgents() {
		if (state.source === "custom" && !state.apiKey.trim()) return;
		await catalog.loadAgents(auth(), base || undefined);
	}
	async function send() {
		const input = state.input.trim(),
			attachment = state.file;
		if (!input && !attachment) return;
		if (state.source === "custom" && !state.apiKey.trim()) {
			notify("error", "Please provide a Virtual Key or select Current UI Session");
			return;
		}
		const agentMode = state.endpoint === "/a2a";
		if (state.comparisons.some((item) => !(agentMode ? item.agent : item.model))) {
			notify("error", agentMode ? "Select an agent before sending a message." : "Select a model before sending a message.");
			return;
		}
		const current = generation,
			source = attachment ? await fileDataUrl(attachment) : undefined;
		if (current !== generation) return;
		const apiMessage = {
				role: "user",
				content: source
					? [
							{ type: "text", text: input },
							{ type: "image_url", image_url: { url: source } },
						]
					: input,
			},
			display =
				input + (attachment ? " " + (attachment.name.toLowerCase().endsWith(".pdf") ? "[PDF attached]" : "[Image attached]") : "");
		state.input = "";
		file(null);
		const work = state.comparisons.map(async (original) => {
			controllers.get(original.id)?.abort();
			const controller = new AbortController();
			controllers.set(original.id, controller);
			const history = original.history,
				before = history.state.messages.map(({ role, content }) => ({ role, content })),
				traceId = original.traceId ?? crypto.randomUUID();
			history.append({ role: "user", content: display, ...(source ? { imagePreviewUrl: source } : {}) });
			update(original.id, { loading: true, traceId });
			const active = () => generation === current && controllers.get(original.id) === controller && !controller.signal.aborted;
			const callbacks: PlaygroundCallbacks = {
				text: (...args) => {
					if (active()) history.callbacks.text(...args);
				},
				reasoning: (value) => {
					if (active()) history.callbacks.reasoning?.(value);
				},
				timing: (value) => {
					if (active()) history.callbacks.timing?.(value);
				},
				latency: (value) => {
					if (active()) history.callbacks.latency?.(value);
				},
				usage: (value) => {
					if (active()) history.callbacks.usage?.(value);
				},
				search: (value) => {
					if (active()) history.callbacks.search?.(value);
				},
			};
			const request: PlaygroundRequest = {
				endpoint: agentMode ? "a2a_agents" : "chat",
				auth: auth(),
				model: original.model,
				agent: original.agent,
				input,
				messages: [...before, apiMessage],
				tags: [...original.tags],
				guardrails: [...original.guardrails],
				policies: [],
				vectorStores: [...original.vectorStores],
				mcpServers: [],
				selectedMcpServers: [],
				mcpRestrictions: {},
				traceId,
				temperature: original.useAdvancedParams ? original.temperature : undefined,
				maxTokens: original.useAdvancedParams ? original.maxTokens : undefined,
				voice: "alloy",
				images: [],
				audio: null,
				customBaseUrl: base || undefined,
				signal: controller.signal,
			};
			try {
				await (agentMode ? streamAgent(request, callbacks) : sendInference(request, callbacks));
			} catch (error) {
				if (active()) {
					const message = error instanceof Error ? error.message : String(error);
					notify("error", message);
					history.callbacks.text(
						(history.state.messages.at(-1)?.role === "assistant" ? "\n" : "") + "Error fetching response: " + message,
					);
				}
			} finally {
				if (active()) {
					controllers.delete(original.id);
					update(original.id, { loading: false });
				}
			}
		});
		await Promise.allSettled(work);
		touch();
	}
	function dispose() {
		clear();
		state.comparisons.forEach((item) => item.history.dispose());
		catalog.dispose();
	}
	return { state, catalog, auth, load, loadAgents, add, remove, update, settings, sync, file, clear, send, dispose };
}
export type PlaygroundCompareStore = ReturnType<typeof createPlaygroundCompareStore>;
