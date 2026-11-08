import { shallowReactive, watch } from "vue";
import { z } from "zod";
import type { CodeInterpreterResult, EndpointType, PlaygroundAuth } from "../support/PlaygroundModels";
import { browserSessionStorage, readStored, readText, storeValue, type PlaygroundStorage } from "../logic/PlaygroundStorageLogic";
const endpoints = z.enum([
	"chat",
	"responses",
	"anthropic_messages",
	"image",
	"image_edits",
	"embeddings",
	"speech",
	"transcription",
	"a2a_agents",
	"mcp",
	"realtime",
	"video",
]);
export function createPlaygroundSettingsStore(
	options: {
		storage?: PlaygroundStorage;
		disabledPersonalKeyCreation?: boolean;
		fixedModel?: string;
		simplified?: boolean;
		inferenceAuth?: () => PlaygroundAuth | undefined;
	} = {},
) {
	const storage = options.storage ?? browserSessionStorage();
	const state = shallowReactive({
		apiKeySource: readStored(
			storage,
			"apiKeySource",
			z.enum(["session", "custom"]),
			options.disabledPersonalKeyCreation ? "custom" : "session",
		),
		apiKey: readText(storage, "apiKey"),
		customBaseUrl: readText(storage, "customProxyBaseUrl"),
		endpoint: options.simplified
			? ("chat" as EndpointType)
			: (endpoints.safeParse(readText(storage, "endpointType", "chat")).data ?? "chat"),
		selectedModel: options.simplified ? (options.fixedModel ?? "") : "",
		selectedAgent: "",
		customModel: false,
		customModelName: "",
		tags: readStored(storage, "selectedTags", z.array(z.string()), []),
		vectors: readStored(storage, "selectedVectorStores", z.array(z.string()), []),
		guardrails: readStored(storage, "selectedGuardrails", z.array(z.string()), []),
		policies: readStored(storage, "selectedPolicies", z.array(z.string()), []),
		mcpServers: readStored(storage, "selectedMCPServers", z.array(z.string()), []),
		mcpRestrictions: readStored(storage, "mcpServerToolRestrictions", z.record(z.string(), z.array(z.string())), {}),
		voice: readText(storage, "selectedVoice", "alloy").replace(/^"|"$/g, ""),
		directTool: "",
		temperature: 1,
		maxTokens: 2048,
		advancedParams: false,
		mockFallbacks: false,
		codeEnabled: readStored(storage, "codeInterpreterEnabled", z.boolean(), false),
		codeResult: null as CodeInterpreterResult | null,
	});
	const auth = (): PlaygroundAuth =>
		options.inferenceAuth?.() ??
		(state.apiKeySource === "session" ? { kind: "session" } : { kind: "virtual-key", apiKey: state.apiKey.trim() });
	const hasAuth = () => Boolean(options.inferenceAuth?.() || state.apiKeySource === "session" || state.apiKey.trim());
	const stop = watch(
		() => ({ ...state }),
		() => {
			storeValue(storage, "apiKeySource", JSON.stringify(state.apiKeySource));
			storeValue(storage, "apiKey", state.apiKey);
			storeValue(storage, "customProxyBaseUrl", state.customBaseUrl || null);
			storeValue(storage, "endpointType", state.endpoint);
			storeValue(storage, "selectedTags", state.tags);
			storeValue(storage, "selectedVectorStores", state.vectors);
			storeValue(storage, "selectedGuardrails", state.guardrails);
			storeValue(storage, "selectedPolicies", state.policies);
			storeValue(storage, "selectedMCPServers", state.mcpServers);
			storeValue(storage, "mcpServerToolRestrictions", state.mcpRestrictions);
			storeValue(storage, "selectedVoice", state.voice);
			storeValue(storage, "codeInterpreterEnabled", state.codeEnabled);
			if (!options.simplified) storeValue(storage, "selectedModel", state.selectedModel || null);
		},
		{ immediate: true },
	);
	let customTimer: ReturnType<typeof setTimeout> | undefined;
	function selectModel(value: string) {
		if (customTimer) clearTimeout(customTimer);
		state.selectedModel = value;
		state.customModel = value === "custom";
	}
	function customModel(value: string) {
		state.customModelName = value;
		if (customTimer) clearTimeout(customTimer);
		customTimer = setTimeout(() => {
			state.selectedModel = value;
			customTimer = undefined;
		}, 500);
	}
	function selectEndpoint(value: EndpointType) {
		state.endpoint = value;
		state.selectedModel = "";
		state.selectedAgent = "";
		state.customModel = false;
		state.directTool = "";
		if (value === "mcp" && (state.mcpServers.length !== 1 || state.mcpServers[0] === "__all__")) state.mcpServers = [];
		storeValue(storage, "selectedModel", null);
		storeValue(storage, "selectedAgent", null);
	}
	function selectServers(ids: string[]) {
		state.directTool = "";
		if (ids.includes("__all__")) {
			state.mcpServers = ["__all__"];
			state.mcpRestrictions = {};
		} else {
			state.mcpServers = state.endpoint === "mcp" ? ids.slice(0, 1) : ids;
			state.mcpRestrictions = Object.fromEntries(Object.entries(state.mcpRestrictions).filter(([id]) => ids.includes(id)));
		}
	}
	function restrictTools(id: string, tools: string[]) {
		state.mcpRestrictions = { ...state.mcpRestrictions, [id]: tools };
	}
	function dispose() {
		stop();
		if (customTimer) clearTimeout(customTimer);
	}
	return { state, auth, hasAuth, selectModel, customModel, selectEndpoint, selectServers, restrictTools, dispose, storage };
}
export type PlaygroundSettingsStore = ReturnType<typeof createPlaygroundSettingsStore>;
