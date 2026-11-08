import { shallowReactive } from "vue";
import { modelHubApi } from "../api/ModelHubApi";
import type { HubAgent, HubMcp, HubModel, UsefulLinks } from "../support/ModelHubModels";
export function createPublicModelHubStore() {
	const state = shallowReactive({
		models: [] as HubModel[],
		agents: [] as HubAgent[],
		mcp: [] as HubMcp[],
		modelLoading: true,
		agentLoading: true,
		mcpLoading: true,
		description: null as string | null,
		version: "",
		links: {} as UsefulLinks,
		serviceStatus: "I'm alive! ✓",
		model: null as HubModel | null,
		agent: null as HubAgent | null,
		server: null as HubMcp | null,
	});
	const controller = new AbortController();
	let generation = 0;
	async function load() {
		const current = ++generation,
			signal = controller.signal;
		await Promise.allSettled([
			modelHubApi
				.publicModels(signal)
				.then((rows) => {
					if (current === generation) state.models = rows;
				})
				.catch(() => {
					if (current === generation) {
						state.models = [];
						state.serviceStatus = "Service unavailable";
					}
				})
				.finally(() => {
					if (current === generation) state.modelLoading = false;
				}),
			modelHubApi
				.publicAgents(signal)
				.then((rows) => {
					if (current === generation) state.agents = rows;
				})
				.catch(() => {
					if (current === generation) state.agents = [];
				})
				.finally(() => {
					if (current === generation) state.agentLoading = false;
				}),
			modelHubApi
				.publicMcp(signal)
				.then((rows) => {
					if (current === generation) state.mcp = rows;
				})
				.catch(() => {
					if (current === generation) state.mcp = [];
				})
				.finally(() => {
					if (current === generation) state.mcpLoading = false;
				}),
			modelHubApi.info(signal).then((info) => {
				if (current === generation) {
					state.description = info.custom_docs_description;
					state.version = info.litellm_version;
					state.links = info.useful_links;
				}
			}),
		]);
	}
	function dispose() {
		generation++;
		controller.abort();
	}
	return { state, load, dispose };
}
export type PublicModelHubStore = ReturnType<typeof createPublicModelHubStore>;
