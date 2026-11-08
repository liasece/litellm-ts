import { describe, expect, it } from "vitest";
import { buildTeamCreatePayload, buildTeamUpdatePayload, buildOrganizationPayload, teamDraft } from "./ResourceDraftLogic";
import { buildProjectPayload, createProjectDraft, validateProjectDraft } from "./ProjectDraftLogic";
import { buildInviteUserPayload, buildUserUpdatePayload, buildInvitationUrl } from "./UserDraftLogic";
import type { AccessOrganization, AccessProject, AccessTeam } from "../support/AccessModels";
describe("Access-control form behavior", () => {
	it("distinguishes an untouched project budget, zero budget, and clearing a budget", () => {
		const draft = createProjectDraft();
		expect(buildProjectPayload(draft)).not.toHaveProperty("max_budget");
		draft.max_budget = 0;
		expect(buildProjectPayload(draft).max_budget).toBe(0);
		draft.max_budget = null;
		expect(buildProjectPayload(draft).max_budget).toBeNull();
	});
	it("round-trips project model limits from internal metadata while excluding them from visible metadata fields", () => {
		const project = {
			project_id: "project-a",
			project_alias: "Research",
			team_id: "team-a",
			models: [],
			spend: 0,
			blocked: false,
			created_at: "2026-01-01",
			updated_at: "2026-01-01",
			metadata: { model_rpm_limit: { model: 0 }, model_tpm_limit: { model: 100 }, label: "test" },
			litellm_budget_table: { budget_id: "budget", max_budget: 0 },
		} as AccessProject;
		const draft = createProjectDraft(project);
		expect(draft.metadata).toEqual([{ key: "label", value: "test" }]);
		expect(buildProjectPayload(draft)).toMatchObject({
			max_budget: 0,
			model_rpm_limit: { model: 0 },
			model_tpm_limit: { model: 100 },
			metadata: { label: "test" },
		});
		draft.modelLimits.push({ ...draft.modelLimits[0] });
		expect(validateProjectDraft(draft).modelLimits).toBe("Duplicate model");
	});
	it("does not turn omitted resource access into explicit empty permissions when creating a team", () => {
		const payload = buildTeamCreatePayload({
			team_alias: "Research",
			models: ["gpt-4.1"],
			organization_id: " org-a ",
			vector_stores: ["vector-a"],
			metadata: '{"label":"test"}',
			logging_settings: [{ callback_name: "" }, { callback_name: "langfuse", callback_vars: {} }],
		});
		expect(payload.object_permission).toEqual({ vector_stores: ["vector-a"] });
		expect(payload.organization_id).toBe("org-a");
		expect(payload.metadata).toEqual({ label: "test", logging: [{ callback_name: "langfuse", callback_vars: {} }] });
		expect(payload).not.toHaveProperty("vector_stores");
	});
	it("preserves team metadata, clears limits explicitly and filters tool permissions to the selected servers on updates", () => {
		const payload = buildTeamUpdatePayload("team-a", {
			team_alias: "Research",
			models: [],
			metadata: '{"custom":true,"soft_budget_alerting_emails":["old@example.test"]}',
			max_budget: "",
			tpm_limit: "",
			rpm_limit: 0,
			soft_budget_alerting_emails: " first@example.test, , second@example.test ",
			mcp_servers: ["server-a"],
			mcp_access_groups: [],
			mcp_tool_permissions: { "server-a": ["read"], "server-b": ["delete"] },
			access_group_ids: [],
		});
		expect(payload).toMatchObject({
			max_budget: null,
			tpm_limit: null,
			rpm_limit: 0,
			metadata: {
				custom: true,
				disable_global_guardrails: false,
				soft_budget_alerting_emails: ["first@example.test", "second@example.test"],
			},
			object_permission: { mcp_servers: ["server-a"], mcp_access_groups: [], mcp_tool_permissions: { "server-a": ["read"] } },
			access_group_ids: [],
		});
	});
	it("loads member defaults from the team budget table and preserves separate logging/secret settings", () => {
		const draft = teamDraft({
			team_id: "team-a",
			models: [],
			keys: [],
			members_with_roles: [],
			metadata: {
				logging: [{ callback_name: "langfuse" }],
				secret_manager_settings: { namespace: "test" },
				soft_budget_alerting_emails: ["alerts@example.test"],
				custom: true,
			},
			team_member_budget_table: { max_budget: 0, tpm_limit: 0, rpm_limit: null, budget_duration: "30d" },
		} as AccessTeam);
		expect(draft).toMatchObject({
			team_member_budget: 0,
			team_member_tpm_limit: 0,
			team_member_rpm_limit: null,
			soft_budget_alerting_emails: "alerts@example.test",
			metadata: '{\n  "custom": true\n}',
		});
		expect(draft.secret_manager_settings).toContain("namespace");
	});
	it("retains unrelated organization permissions when an administrator clears its selected resources", () => {
		const org = {
			organization_id: "org-a",
			organization_alias: "Research",
			models: [],
			members: [],
			litellm_budget_table: { budget_id: "budget-a" },
			object_permission: { future_permission: ["keep"] },
		} as AccessOrganization;
		expect(
			buildOrganizationPayload(
				{
					organization_alias: "Research",
					max_budget: null,
					metadata: "",
					vector_stores: [],
					mcp_servers: [],
					mcp_access_groups: [],
				},
				org,
			),
		).toMatchObject({
			metadata: null,
			litellm_budget_table: { max_budget: null },
			object_permission: { future_permission: ["keep"], vector_stores: [], mcp_servers: [], mcp_access_groups: [] },
		});
	});
	it("keeps account invitation defaults and explicit nullable user edits", () => {
		expect(buildInviteUserPayload({ user_role: "internal_user", organization_ids: ["org-a"], metadata: '{"tag":"test"}' })).toEqual({
			user_role: "internal_user",
			models: ["no-default-models"],
			organizations: ["org-a"],
			metadata: { tag: "test" },
		});
		expect(buildUserUpdatePayload({ user_id: "user-a", models: [], metadata: "{}", max_budget: 10 }, true)).toEqual({
			user_id: "user-a",
			models: [],
			metadata: {},
			max_budget: null,
		});
	});
	it("creates invitation and reset links under the configured root without losing the SSO flow", () => {
		expect(buildInvitationUrl("https://fixture.example/litellm", { id: "invitation-a" }, true)).toBe(
			"https://fixture.example/litellm/ui?invitation_id=invitation-a&action=reset_password",
		);
		expect(buildInvitationUrl("https://fixture.example", { id: "invitation-a", has_user_setup_sso: true }, true)).toBe(
			"https://fixture.example/ui",
		);
	});
});
