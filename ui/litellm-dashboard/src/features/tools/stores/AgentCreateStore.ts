import { reactive, ref, shallowRef } from "vue";
import { agentsApi } from "../api/AgentsApi";
import { createKey, updateKey } from "../../virtual-keys/api/VirtualKeysApi";
import { createAgentPayload, defaultAgentDraft } from "../logic/AgentDraftLogic";
import type { AgentFlowOptions, AgentEntitlements, AgentTypeInfo, AgentKey } from "../support/AgentModels";
const defaultOptions = (): AgentFlowOptions => ({
	type: "a2a",
	requireInbound: false,
	requireOutbound: false,
	maxIterations: null,
	maxBudget: null,
	keyOption: "create_new",
	keyName: "",
	keyModels: [],
	existingKey: null,
});
export function createAgentCreateStore(service = { create: agentsApi.create, createKey, updateKey }) {
	const draft = ref<Record<string, unknown>>(defaultAgentDraft()),
		options = ref<AgentFlowOptions>(defaultOptions()),
		entitlements = ref<AgentEntitlements>({ mcp_servers: [], mcp_access_groups: [], mcp_tool_permissions: {}, models: [], agents: [] }),
		metadata = shallowRef<AgentTypeInfo[]>([]),
		keys = shallowRef<AgentKey[]>([]),
		state = reactive({
			step: 0,
			pending: false,
			error: "",
			createdName: "",
			secret: "",
			assignedAlias: "",
			errors: {} as Record<string, string>,
		});
	function reset() {
		draft.value = defaultAgentDraft();
		options.value = defaultOptions();
		entitlements.value = { mcp_servers: [], mcp_access_groups: [], mcp_tool_permissions: {}, models: [], agents: [] };
		state.step = 0;
		state.error = "";
		state.createdName = "";
		state.secret = "";
		state.assignedAlias = "";
		state.errors = {};
	}
	function changeType(type: string) {
		options.value.type = type;
		draft.value = type === "a2a" ? defaultAgentDraft() : {};
		for (const field of metadata.value.find((info) => info.agent_type === type)?.credential_fields || [])
			if (field.default_value != null) draft.value[field.key] = field.default_value;
		state.errors = {};
	}
	function next() {
		if (state.step === 0) {
			if (!draft.value.agent_name) {
				state.errors = {
					agent_name: options.value.type === "custom" ? "Please enter an agent name" : "Please enter a unique agent name",
				};
				return false;
			}
			if (!options.value.keyName) options.value.keyName = String(draft.value.agent_name) + "-key";
		}
		state.errors = {};
		state.step++;
		return true;
	}
	async function create() {
		if (state.pending) return false;
		const payload = createAgentPayload(
			draft.value,
			options.value,
			metadata.value.find((info) => info.agent_type === options.value.type),
			entitlements.value,
		);
		if (!payload) {
			state.error = "Failed to build agent data";
			return false;
		}
		state.pending = true;
		state.error = "";
		try {
			const response = await service.create(payload),
				id = response.agent_id;
			state.createdName = response.agent_name || String(draft.value.agent_name || id);
			if (options.value.keyOption === "create_new" && options.value.keyName) {
				const body: Record<string, unknown> = {
					agent_id: id,
					key_alias: options.value.keyName,
					models: options.value.keyModels.length ? options.value.keyModels : [],
				};
				if (draft.value.team_id) body.team_id = draft.value.team_id;
				const key = await service.createKey(body);
				state.secret = typeof key.key === "string" ? key.key : "";
			} else if (options.value.keyOption === "existing_key") {
				if (!options.value.existingKey) {
					state.error = "Please select an existing key to assign";
					return false;
				}
				await service.updateKey({ key: options.value.existingKey, agent_id: id });
				state.assignedAlias =
					keys.value.find((key) => key.token === options.value.existingKey)?.key_alias ||
					options.value.existingKey.slice(0, 12) + "…";
			}
			state.step = 4;
			return true;
		} catch (error) {
			state.error = "Failed to create agent: " + (error instanceof Error ? error.message : String(error));
			return false;
		} finally {
			state.pending = false;
		}
	}
	return { draft, options, entitlements, metadata, keys, state, reset, changeType, next, create };
}
