import { shallowReactive } from "vue";
import { playgroundCatalogApi } from "../api/PlaygroundCatalogApi";
import type { PlaygroundAgent, PlaygroundAuth, PlaygroundMcpServer, PlaygroundMcpTool, PlaygroundModel } from "../support/PlaygroundModels";
export function createPlaygroundCatalogStore(api = playgroundCatalogApi) {
	const state = shallowReactive({
		loading: false,
		models: [] as PlaygroundModel[],
		servers: [] as PlaygroundMcpServer[],
		agents: [] as PlaygroundAgent[],
		guardrails: [] as Record<string, unknown>[],
		policies: [] as Record<string, unknown>[],
		vectors: [] as Record<string, unknown>[],
		tags: {} as Record<string, unknown>,
		settings: {} as Record<string, unknown>,
		tools: {} as Record<string, PlaygroundMcpTool[]>,
		toolErrors: {} as Record<string, string>,
		error: null as string | null,
	});
	let controller: AbortController | undefined,
		generation = 0,
		agentGeneration = 0,
		pending: Promise<void> | null = null;
	async function load() {
		if (pending) return pending;
		controller = new AbortController();
		const signal = controller.signal,
			current = ++generation;
		state.loading = true;
		const request = (async () => {
			const result = await Promise.allSettled([
				api.models(signal),
				api.servers(signal),
				api.guardrails(signal),
				api.policies(signal),
				api.vectors(signal),
				api.tags(signal),
				api.settings(signal),
			]);
			if (current !== generation || signal.aborted) return;
			if (result[0].status === "fulfilled") state.models = result[0].value;
			else state.error = result[0].reason instanceof Error ? result[0].reason.message : "Failed to fetch models";
			if (result[1].status === "fulfilled") state.servers = result[1].value;
			if (result[2].status === "fulfilled") state.guardrails = result[2].value;
			if (result[3].status === "fulfilled") state.policies = result[3].value;
			if (result[4].status === "fulfilled") state.vectors = result[4].value;
			if (result[5].status === "fulfilled") state.tags = result[5].value;
			if (result[6].status === "fulfilled") state.settings = result[6].value;
		})().finally(() => {
			if (current === generation) state.loading = false;
			if (pending === request) pending = null;
		});
		pending = request;
		return request;
	}
	async function loadTools(id: string, headers?: Record<string, string>) {
		const current = generation,
			result = await api.tools(id, headers, controller?.signal);
		if (current !== generation) return;
		state.tools = { ...state.tools, [id]: result.tools };
		state.toolErrors = { ...state.toolErrors, [id]: result.message ?? "" };
	}
	async function loadAgents(auth: PlaygroundAuth, base?: string) {
		const current = generation,
			currentAgent = ++agentGeneration;
		try {
			const agents = await api.agents(auth, base, controller?.signal);
			if (current === generation && currentAgent === agentGeneration) state.agents = agents;
		} catch (error) {
			if (current === generation && currentAgent === agentGeneration)
				state.error = error instanceof Error ? error.message : "Failed to fetch agents";
		}
	}
	async function reloadServers() {
		const current = generation,
			servers = await api.servers(controller?.signal);
		if (current === generation) state.servers = servers;
	}
	function dispose() {
		generation++;
		controller?.abort();
		pending = null;
	}
	return { state, load, loadTools, loadAgents, reloadServers, dispose };
}
export type PlaygroundCatalogStore = ReturnType<typeof createPlaygroundCatalogStore>;
