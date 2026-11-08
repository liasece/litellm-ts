import examples from "../data/ModelHubCodeExamplesData.json";
import { getApiBaseUrl } from "../../platform/api/HttpApiClient";
import { generateCodeSnippet } from "../../playground/logic/PlaygroundCodeLogic";
import { endpointForMode } from "../../playground/data/PlaygroundEndpointData";
import type { HubModel } from "../support/ModelHubModels";
export function adminModelCode(model: HubModel) {
	return examples.adminModel.replaceAll("__BASE__", getApiBaseUrl()).replaceAll("__MODEL__", model.model_group);
}
export function adminMcpCode(name: string) {
	return examples.adminMcp.replaceAll("__BASE__", getApiBaseUrl()).replaceAll("__SERVER__", name);
}
export function publicMcpCode(name: string) {
	return examples.publicMcp.replaceAll("__SERVER__", name);
}
export function agentResolverCode(url: string) {
	return examples.publicAgentResolver.replaceAll("__URL__", url);
}
export const agentCallCode = examples.publicAgentCall;
export function publicModelCode(model: HubModel) {
	return generateCodeSnippet({
		apiKeySource: "custom",
		accessToken: null,
		apiKey: "your_api_key",
		inputMessage: "Hello, how are you?",
		chatHistory: [{ id: "hub-example", role: "user", content: "Hello, how are you?", isImage: false }],
		selectedTags: [],
		selectedVectorStores: [],
		selectedGuardrails: [],
		selectedPolicies: [],
		selectedMCPServers: [],
		endpointType: endpointForMode(model.mode ?? "chat"),
		selectedModel: model.model_group,
		selectedSdk: "openai",
	});
}
