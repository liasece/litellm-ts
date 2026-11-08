import { describe, expect, it } from "vitest";
import { createKeyDraft, validateKeyDraft } from "./KeyDraftLogic";
import { buildKeyPayload } from "./KeyPayloadLogic";
import { markKeyField, type VirtualKey } from "../support/VirtualKeyModels";
const context = { userId: "visual-admin", canEditGuardrails: true };
const key: VirtualKey = {
	token: "fixture-hash",
	models: ["gpt-4.1"],
	metadata: { tags: ["old"], owner: "fixture", guardrails: ["global-rule"] },
	object_permission: { object_permission_id: "permission-id", future_permission: ["retain"], mcp_servers: ["server-1"] },
	key_alias: "Original",
	team_id: "team-1",
	max_budget: 20,
};
describe("Virtual Key request contracts", () => {
	it("matches the captured untouched legacy form without replacing inherited budgets or permissions", () => {
		const draft = createKeyDraft();
		draft.key_alias = "Fixture Key";
		expect(buildKeyPayload(draft, context)).toEqual({
			user_id: "visual-admin",
			blocked: false,
			team_id: null,
			key_alias: "Fixture Key",
			models: [],
			key_type: "llm_api",
			duration: null,
			metadata: {},
		});
	});
	it("includes null rate-limit types only after the optional section registers them", () => {
		const draft = createKeyDraft();
		draft.key_alias = "Fixture Key";
		markKeyField(draft, "tpm_limit_type");
		markKeyField(draft, "rpm_limit_type");
		const payload = buildKeyPayload(draft, context);
		expect(payload).toMatchObject({ tpm_limit_type: null, rpm_limit_type: null });
		expect(payload).not.toHaveProperty("max_budget");
		expect(payload).not.toHaveProperty("object_permission");
	});
	it("keeps legacy creation behavior for invalid metadata while edits reject the same input", () => {
		const draft = createKeyDraft();
		draft.key_alias = "Fixture Key";
		draft.metadataText = "{ invalid JSON";
		expect(validateKeyDraft(draft, { creating: true })).toEqual({});
		expect(buildKeyPayload(draft, context).metadata).toEqual({});
		expect(validateKeyDraft(draft, { creating: false }).metadataText).toBe("Invalid metadata JSON");
		expect(() => buildKeyPayload(draft, { ...context, key })).toThrow(SyntaxError);
	});
	it("preserves valid metadata and the legacy distinction between absent and empty object access", () => {
		const draft = createKeyDraft();
		draft.metadataText = '{"owner":"Synthetic acceptance fixture"}';
		draft.mcp_servers = ["server-1"];
		draft.mcp_tool_permissions = { "server-1": ["read_record"] };
		draft.agent_access_groups = ["research"];
		const payload = buildKeyPayload(draft, context);
		expect(payload.object_permission).toEqual({
			mcp_servers: ["server-1"],
			agent_access_groups: ["research"],
			mcp_tool_permissions: { "server-1": ["read_record"] },
		});
		expect(payload.metadata).toEqual({ owner: "Synthetic acceptance fixture" });
		expect(payload.object_permission).not.toHaveProperty("vector_stores");
	});
	it("keeps unrelated permission fields when an edit explicitly clears MCP access", () => {
		const draft = createKeyDraft(key);
		draft.mcp_servers = [];
		draft.mcp_tool_permissions = {};
		draft.tags = [];
		const payload = buildKeyPayload(draft, { ...context, key });
		expect(payload.object_permission).toMatchObject({
			object_permission_id: "permission-id",
			future_permission: ["retain"],
			mcp_servers: [],
			mcp_tool_permissions: {},
		});
		expect(payload.metadata).toEqual({ owner: "fixture", guardrails: ["global-rule"] });
		expect(payload).not.toHaveProperty("tags");
	});
	it("uses agent ownership with the same requesting user and puts service ownership in metadata", () => {
		const draft = createKeyDraft();
		draft.owner = "agent";
		draft.agent_id = "agent-1";
		expect(buildKeyPayload(draft, context)).toMatchObject({ agent_id: "agent-1", user_id: "visual-admin" });
		draft.owner = "service_account";
		draft.team_id = "team-1";
		draft.key_alias = "billing-service";
		const payload = buildKeyPayload(draft, context);
		expect(payload.metadata).toEqual({ service_account_id: "billing-service" });
		expect(payload).not.toHaveProperty("user_id");
	});
	it("trims custom keys and honors the UI setting disabling them", () => {
		const draft = createKeyDraft();
		draft.key = "  sk-synthetic-acceptance  ";
		expect(buildKeyPayload(draft, context).key).toBe("sk-synthetic-acceptance");
		expect(buildKeyPayload(draft, { ...context, customKeysDisabled: true })).not.toHaveProperty("key");
	});
	it("keeps router null defaults, aliases, logging and rotation payloads", () => {
		const draft = createKeyDraft();
		draft.router_settings = { routing_strategy: null, enable_tag_filtering: false, fallbacks: [{ "gpt-4.1": ["gpt-4.1-mini"] }] };
		draft.aliases = { fast: "gpt-4.1-mini" };
		draft.auto_rotate = true;
		draft.rotation_interval = "7d";
		draft.duration = "30d";
		draft.never_expire = false;
		draft.logging = [
			{ callback_name: "langfuse", callback_type: "success", callback_vars: { public_key: "os.environ/FIXTURE_PUBLIC_KEY" } },
		];
		draft.disabled_callbacks = ["s3"];
		const payload = buildKeyPayload(draft, context);
		expect(payload.router_settings).toEqual(draft.router_settings);
		expect(payload.aliases).toEqual(draft.aliases);
		expect(payload).toMatchObject({ auto_rotate: true, rotation_interval: "7d", duration: "30d" });
		expect(payload.metadata).toEqual({ logging: draft.logging, litellm_disabled_callbacks: ["s3"] });
	});
	it("strips privileged guardrail and prompt changes for users without that capability", () => {
		const draft = createKeyDraft();
		draft.guardrails = ["pii"];
		draft.prompts = ["private"];
		const payload = buildKeyPayload(draft, { ...context, canEditGuardrails: false });
		expect(payload).not.toHaveProperty("guardrails");
		expect(payload).not.toHaveProperty("prompts");
	});
	it("validates custom-key and team-budget constraints without rejecting empty optional fields", () => {
		const draft = createKeyDraft();
		draft.key_alias = "Fixture";
		draft.key = "invalid";
		draft.max_budget = 101;
		expect(validateKeyDraft(draft, { creating: true, team: { team_id: "team", max_budget: 100 } })).toMatchObject({
			key: "Custom Key must start with 'sk-'",
			max_budget: "Budget cannot exceed team max budget: 100",
		});
		draft.key = "sk-short";
		expect(validateKeyDraft(draft, { creating: true }).key).toContain("at least 16");
		draft.owner = "service_account";
		expect(validateKeyDraft(draft, { creating: true }).team_id).toBe("Please select a team for the service account");
	});
});
