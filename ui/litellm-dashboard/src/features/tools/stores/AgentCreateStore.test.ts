import { describe, it, expect, vi } from "vitest";
import { createAgentCreateStore } from "./AgentCreateStore";
import { agentsApi } from "../api/AgentsApi";
import { createKey, updateKey } from "../../virtual-keys/api/VirtualKeysApi";
import { baseAgentPayload, createAgentPayload, dynamicAgentPayload, parseAgentDraft } from "../logic/AgentDraftLogic";
import type { AgentTypeInfo } from "../support/AgentModels";
function fixture() {
	const create = vi
			.fn<typeof agentsApi.create>()
			.mockResolvedValue({ agent_id: "agent-synthetic", agent_name: "Synthetic", litellm_params: {} }),
		newKey = vi.fn<typeof createKey>().mockResolvedValue({ key: "synthetic-key-result" }),
		assign = vi.fn<typeof updateKey>().mockResolvedValue({});
	return { store: createAgentCreateStore({ create, createKey: newKey, updateKey: assign }), create, newKey, assign };
}
describe("Agent creation workflow compatibility", () => {
	it("holds the configure step on a missing name and seeds its dedicated key name only once", () => {
		const { store } = fixture();
		expect(store.next()).toBe(false);
		expect(store.state.step).toBe(0);
		store.draft.value.agent_name = "first-agent";
		expect(store.next()).toBe(true);
		expect(store.options.value.keyName).toBe("first-agent-key");
		store.state.step = 0;
		store.draft.value.agent_name = "renamed-agent";
		store.next();
		expect(store.options.value.keyName).toBe("first-agent-key");
	});
	it("creates an agent before assigning its dedicated key with the selected team and no invented model restrictions", async () => {
		const { store, create, newKey, assign } = fixture();
		store.options.value.type = "custom";
		store.options.value.keyName = "example-agent-key";
		store.draft.value = { agent_name: "example", team_id: "team-synthetic" };
		await expect(store.create()).resolves.toBe(true);
		expect(create).toHaveBeenCalledWith(expect.objectContaining({ team_id: "team-synthetic", agent_name: "example" }));
		expect(newKey).toHaveBeenCalledWith({
			agent_id: "agent-synthetic",
			key_alias: "example-agent-key",
			models: [],
			team_id: "team-synthetic",
		});
		expect(assign).not.toHaveBeenCalled();
		expect(store.state.step).toBe(4);
		store.reset();
		expect(store.state.secret).toBe("");
	});
	it("assigns existing keys or deliberately skips creation without generating another key", async () => {
		const { store, newKey, assign } = fixture();
		store.options.value.type = "custom";
		store.draft.value.agent_name = "example";
		store.options.value.keyOption = "existing_key";
		store.options.value.existingKey = "existing-key-reference";
		await store.create();
		expect(assign).toHaveBeenCalledWith({ key: "existing-key-reference", agent_id: "agent-synthetic" });
		expect(newKey).not.toHaveBeenCalled();
		store.reset();
		store.options.value.type = "custom";
		store.options.value.keyOption = "skip";
		await store.create();
		expect(newKey).not.toHaveBeenCalled();
		expect(assign).toHaveBeenCalledTimes(1);
	});
	it("does not display the ready state when key assignment fails after agent creation", async () => {
		const { store, newKey } = fixture();
		store.options.value.type = "custom";
		store.options.value.keyName = "example";
		store.state.step = 3;
		newKey.mockRejectedValueOnce(new Error("synthetic failure"));
		await expect(store.create()).resolves.toBe(false);
		expect(store.state.step).toBe(3);
		expect(store.state.pending).toBe(false);
		expect(store.state.error).toContain("synthetic failure");
	});
	it("keeps explicit zero rate limits and static header precedence while omitting empty header lists", () => {
		const payload = baseAgentPayload({
			agent_name: "example",
			tpm_limit: 0,
			static_headers: [
				{ header: " X-Example ", value: "first" },
				{ header: "X-Example", value: "last" },
			],
			extra_headers: [],
		});
		expect(payload).toMatchObject({ tpm_limit: 0, static_headers: { "X-Example": "last" } });
		expect(payload).not.toHaveProperty("extra_headers");
	});
	it("builds metadata-driven model templates and preserves entitlements plus tracing controls", () => {
		const info: AgentTypeInfo = {
			agent_type: "langgraph",
			agent_type_display_name: "LangGraph",
			model_template: "langgraph/{graph_id}",
			credential_fields: [
				{ key: "graph_id", label: "Graph", include_in_litellm_params: false },
				{ key: "api_base", label: "API Base" },
			],
		};
		const values = { agent_name: "example", graph_id: "graph-a", api_base: "https://example.test" };
		expect(dynamicAgentPayload(values, info)).toMatchObject({
			litellm_params: { model: "langgraph/graph-a", api_base: "https://example.test" },
		});
		expect(dynamicAgentPayload(values, info).litellm_params as Record<string, unknown>).not.toHaveProperty("graph_id");
		const { store } = fixture();
		store.options.value = {
			...store.options.value,
			type: "langgraph",
			requireInbound: true,
			requireOutbound: true,
			maxIterations: 25,
			maxBudget: 5,
		};
		const payload = createAgentPayload(values, store.options.value, info, {
			models: ["model-a"],
			agents: [],
			mcp_servers: ["mcp-a"],
			mcp_access_groups: [],
			mcp_tool_permissions: { "mcp-a": ["read_tool"] },
		});
		expect(payload).toMatchObject({
			object_permission: { models: ["model-a"], mcp_servers: ["mcp-a"], mcp_tool_permissions: { "mcp-a": ["read_tool"] } },
			litellm_params: {
				require_trace_id_on_calls_to_agent: true,
				require_trace_id_on_calls_by_agent: true,
				max_iterations: 25,
				max_budget_per_session: 5,
			},
		});
		expect(
			parseAgentDraft(
				{
					agent_id: "agent-a",
					agent_name: "Example",
					litellm_params: { model: "langgraph/graph-a", api_base: "https://example.test" },
				},
				info,
			),
		).toMatchObject({ graph_id: "graph-a", api_base: "https://example.test" });
	});
});
