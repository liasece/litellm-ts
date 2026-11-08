import { shallowReactive } from "vue";
import { modelHubApi } from "../api/ModelHubApi";
import type { HubAgent, HubMcp, HubModel } from "../support/ModelHubModels";
export function createModelHubStore() {
	const state = shallowReactive({
		models: [] as HubModel[],
		agents: [] as HubAgent[],
		mcp: [] as HubMcp[],
		modelLoading: true,
		agentLoading: true,
		mcpLoading: true,
		tab: "models",
		model: null as HubModel | null,
		agent: null as HubAgent | null,
		server: null as HubMcp | null,
	});
	const controller = new AbortController();
	let generation = 0;
	async function models() {
		const current = generation;
		state.modelLoading = true;
		try {
			const rows = await modelHubApi.models(controller.signal);
			if (current === generation) state.models = rows;
		} catch {
			if (current === generation) state.models = [];
		} finally {
			if (current === generation) state.modelLoading = false;
		}
	}
	async function agents() {
		const current = generation;
		state.agentLoading = true;
		try {
			const rows = await modelHubApi.agents(controller.signal);
			if (current === generation) state.agents = rows;
		} catch {
			if (current === generation) state.agents = [];
		} finally {
			if (current === generation) state.agentLoading = false;
		}
	}
	async function mcp() {
		const current = generation;
		state.mcpLoading = true;
		try {
			const rows = await modelHubApi.mcp(controller.signal);
			if (current === generation) state.mcp = rows;
		} catch {
			if (current === generation) state.mcp = [];
		} finally {
			if (current === generation) state.mcpLoading = false;
		}
	}
	function load() {
		return Promise.allSettled([models(), agents(), mcp()]);
	}
	function dispose() {
		generation++;
		controller.abort();
	}
	return { state, load, models, agents, mcp, dispose };
}
export type ModelHubStore = ReturnType<typeof createModelHubStore>;
