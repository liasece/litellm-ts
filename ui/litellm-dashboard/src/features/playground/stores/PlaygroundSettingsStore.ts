import { shallowReactive, watch } from "vue";
import { z } from "zod";
import type { CodeInterpreterResult, EndpointType, PlaygroundAuth } from "../support/PlaygroundModels";
import { browserSessionStorage, readStored, readText, storeValue, type PlaygroundStorage } from "../logic/PlaygroundStorageLogic";
const endpoints = z.enum([
	"chat",
	"responses",
	"anthropic_messages",
	"image",
	"embeddings",
	"speech",
	"transcription",
	"realtime",
	"video",
]);
export function createPlaygroundSettingsStore(options: { storage?: PlaygroundStorage; disabledPersonalKeyCreation?: boolean } = {}) {
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
		endpoint: endpoints.safeParse(readText(storage, "endpointType", "chat")).data ?? "chat",
		selectedModel: "",
		customModel: false,
		customModelName: "",
		tags: readStored(storage, "selectedTags", z.array(z.string()), []),
		voice: readText(storage, "selectedVoice", "alloy").replace(/^"|"$/g, ""),
		temperature: 1,
		maxTokens: 2048,
		advancedParams: false,
		mockFallbacks: false,
		codeEnabled: readStored(storage, "codeInterpreterEnabled", z.boolean(), false),
		codeResult: null as CodeInterpreterResult | null,
	});
	const auth = (): PlaygroundAuth =>
		state.apiKeySource === "session" ? { kind: "session" } : { kind: "virtual-key", apiKey: state.apiKey.trim() };
	const hasAuth = () => Boolean(state.apiKeySource === "session" || state.apiKey.trim());
	const stop = watch(
		() => ({ ...state }),
		() => {
			storeValue(storage, "apiKeySource", JSON.stringify(state.apiKeySource));
			storeValue(storage, "apiKey", state.apiKey);
			storeValue(storage, "customProxyBaseUrl", state.customBaseUrl || null);
			storeValue(storage, "endpointType", state.endpoint);
			storeValue(storage, "selectedTags", state.tags);
			storeValue(storage, "selectedVoice", state.voice);
			storeValue(storage, "codeInterpreterEnabled", state.codeEnabled);
			storeValue(storage, "selectedModel", state.selectedModel || null);
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
		state.customModel = false;
		storeValue(storage, "selectedModel", null);
	}
	function dispose() {
		stop();
		if (customTimer) clearTimeout(customTimer);
	}
	return { state, auth, hasAuth, selectModel, customModel, selectEndpoint, dispose, storage };
}
export type PlaygroundSettingsStore = ReturnType<typeof createPlaygroundSettingsStore>;
