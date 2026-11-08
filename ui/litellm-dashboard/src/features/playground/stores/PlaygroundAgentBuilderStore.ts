import { computed, shallowReactive } from "vue";
import { agentBuilderApi, type AgentModel } from "../api/PlaygroundAgentBuilderApi";
import { createPlaygroundCatalogStore } from "./PlaygroundCatalogStore";
import { agentModelId, agentServerIds, agentTools } from "../logic/PlaygroundAgentBuilderLogic";
import { notify } from "../logic/PlaygroundValueLogic";
export function createPlaygroundAgentBuilderStore(userId: () => string) {
	const catalog = createPlaygroundCatalogStore(),
		state = shallowReactive({
			agents: [] as AgentModel[],
			loading: true,
			selected: null as string | null,
			tab: "configure",
			name: "",
			systemPrompt: "",
			model: "",
			temperature: 0.7,
			maxTokens: 4096,
			tools: [] as Record<string, unknown>[],
			saving: false,
			deleting: false,
			confirmDelete: false,
			creatingKey: false,
			key: null as string | null,
		}),
		selected = computed(() => state.agents.find((agent) => agent.model_name === state.selected) ?? null),
		id = computed(() => agentModelId(selected.value)),
		servers = computed(() => agentServerIds(state.tools, catalog.state.servers));
	let controller: AbortController | undefined,
		generation = 0;
	function select(name: string | null) {
		state.selected = name;
		state.key = null;
		const agent = state.agents.find((agent) => agent.model_name === name);
		if (agent) {
			state.name = agent.model_name;
			state.systemPrompt = agent.litellm_params.litellm_system_prompt ?? "";
			state.model = agent.litellm_params.model.slice("litellm_agent/".length) || catalog.state.models[0]?.model_group || "";
			state.temperature = agent.litellm_params.temperature ?? 0.7;
			state.maxTokens = agent.litellm_params.max_tokens ?? 4096;
			state.tools = (agent.litellm_params.tools ?? []).filter((tool) => tool.type === "mcp" && typeof tool.server_url === "string");
		}
	}
	async function load() {
		controller?.abort();
		controller = new AbortController();
		const current = ++generation;
		state.loading = true;
		try {
			const [agents] = await Promise.all([agentBuilderApi.list(controller.signal), catalog.load()]);
			if (current !== generation) return;
			state.agents = agents;
			if (!state.selected || (state.selected !== "__new__" && !agents.some((agent) => agent.model_name === state.selected)))
				select(agents[0]?.model_name ?? null);
			if (!state.model) state.model = catalog.state.models[0]?.model_group ?? "";
		} catch {
			if (current === generation) notify("error", "Failed to load agents");
		} finally {
			if (current === generation) state.loading = false;
		}
	}
	function add() {
		state.selected = "__new__";
		state.key = null;
		state.name = "";
		state.systemPrompt = "You are a helpful assistant.";
		state.model = catalog.state.models[0]?.model_group ?? "";
		state.temperature = 0.7;
		state.maxTokens = 4096;
		state.tools = [];
		state.tab = "configure";
	}
	function chooseServers(ids: string[]) {
		state.tools = agentTools(ids, catalog.state.servers);
	}
	function body() {
		return {
			model_name: state.name.trim(),
			litellm_params: {
				model: "litellm_agent/" + state.model,
				litellm_system_prompt: state.systemPrompt.trim() || undefined,
				temperature: state.temperature,
				max_tokens: state.maxTokens,
				tools: state.tools,
			},
			model_info: selected.value?.model_info ?? {},
		};
	}
	async function save() {
		if (!state.name.trim() || !state.model) {
			notify("error", "Name and underlying model are required");
			return;
		}
		if (state.saving) return;
		state.saving = true;
		const isNew = state.selected === "__new__",
			name = state.name.trim(),
			modelId = id.value;
		try {
			if (isNew) {
				await agentBuilderApi.create(body());
				notify("success", "Model " + name + " created successfully");
			} else if (modelId) {
				await agentBuilderApi.update(modelId, body());
				notify("success", "Agent updated successfully");
			} else return;
			await load();
			select(name);
			if (isNew) state.tab = "chat";
		} catch {
			notify("error", isNew ? "Failed to save agent" : "Failed to update agent");
		} finally {
			state.saving = false;
		}
	}
	async function remove() {
		const modelId = id.value,
			name = selected.value?.model_name;
		if (!modelId || state.deleting) return;
		state.deleting = true;
		try {
			await agentBuilderApi.remove(modelId);
			notify("success", "Agent deleted");
			state.confirmDelete = false;
			await load();
			select(state.agents.find((agent) => agent.model_name !== name)?.model_name ?? null);
		} catch {
			notify("error", "Failed to delete agent");
		} finally {
			state.deleting = false;
		}
	}
	async function createKey() {
		const model = selected.value?.model_name;
		if (!model || !userId()) return;
		state.creatingKey = true;
		state.key = null;
		try {
			const response = await agentBuilderApi.key(userId(), model);
			state.key = response.key ?? null;
			notify(
				response.key ? "success" : "error",
				response.key ? "Virtual key created. Use it in the curl example below." : "Key created but value not returned",
			);
		} catch {
			notify("error", "Failed to create key for agent");
		} finally {
			state.creatingKey = false;
		}
	}
	function dispose() {
		generation++;
		controller?.abort();
		catalog.dispose();
		state.key = null;
	}
	return { state, catalog, selected, id, servers, load, select, add, chooseServers, save, remove, createKey, dispose };
}
export type PlaygroundAgentBuilderStore = ReturnType<typeof createPlaygroundAgentBuilderStore>;
