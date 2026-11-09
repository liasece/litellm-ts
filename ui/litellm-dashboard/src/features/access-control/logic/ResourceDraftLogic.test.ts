import { describe, expect, it } from "vitest";
import { buildTeamCreatePayload, buildTeamUpdatePayload, buildOrganizationPayload, teamDraft } from "./ResourceDraftLogic";
import { buildUserUpdatePayload } from "./UserDraftLogic";
import type { AccessOrganization, AccessTeam } from "../support/AccessModels";
describe("Access-control form behavior", () => {
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
	it("keeps explicit nullable user edits", () => {
		expect(buildUserUpdatePayload({ user_id: "user-a", models: [], metadata: "{}", max_budget: 10 }, true)).toEqual({
			user_id: "user-a",
			models: [],
			metadata: {},
			max_budget: null,
		});
	});
});
