import { describe, expect, it } from "vitest";
import type { KeyResponse } from "../key_team_helpers/key_list";
import { buildKeyUpdatePayload } from "./keyUpdatePayload";

const currentKey = {
	token: "token",
	object_permission: {
		object_permission_id: "permission-id",
		vector_stores: ["old-vector"],
		mcp_servers: ["old-server"],
		mcp_access_groups: ["old-mcp-group"],
		mcp_tool_permissions: { "old-server": ["old-tool"] },
		agents: ["old-agent"],
		agent_access_groups: ["old-agent-group"],
	},
} as KeyResponse;

describe("buildKeyUpdatePayload", () => {
	it("merges all resource permission fields without overwriting sibling updates", () => {
		const payload = buildKeyUpdatePayload(
			{
				token: "token",
				metadata: "{}",
				vector_stores: ["vector-1"],
				mcp_servers_and_groups: { servers: ["server-1"], accessGroups: ["mcp-group-1"] },
				mcp_tool_permissions: {},
				agents_and_groups: { agents: ["agent-1"], accessGroups: ["agent-group-1"] },
			},
			currentKey,
			true,
		);

		expect(payload.object_permission).toEqual({
			object_permission_id: "permission-id",
			vector_stores: ["vector-1"],
			mcp_servers: ["server-1"],
			mcp_access_groups: ["mcp-group-1"],
			mcp_tool_permissions: {},
			agents: ["agent-1"],
			agent_access_groups: ["agent-group-1"],
		});
	});

	it("preserves an already normalized budget duration", () => {
		const payload = buildKeyUpdatePayload(
			{ token: "token", metadata: {}, budget_duration: "24h" },
			currentKey,
			true,
		);

		expect(payload.budget_duration).toBe("24h");
	});

	it("removes premium fields when guardrail editing is not allowed", () => {
		const payload = buildKeyUpdatePayload(
			{ token: "token", metadata: {}, guardrails: ["guardrail"], prompts: ["prompt"] },
			currentKey,
			false,
		);

		expect(payload.guardrails).toBeUndefined();
		expect(payload.prompts).toBeUndefined();
	});
});
