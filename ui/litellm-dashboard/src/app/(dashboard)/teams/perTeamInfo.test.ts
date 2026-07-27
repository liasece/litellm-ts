import { describe, expect, it } from "vitest";
import type { Team } from "@/components/key_team_helpers/key_list";
import { derivePerTeamInfo } from "./perTeamInfo";

describe("derivePerTeamInfo", () => {
	it("returns an empty lookup while teams are unavailable", () => {
		expect(derivePerTeamInfo(null)).toEqual({});
	});

	it("indexes keys and members by team id without changing their values", () => {
		const keys = [{ token: "key-1" }];
		const members = [{ user_id: "user-1", role: "admin" }];
		const teams = [
			{
				team_id: "team-1",
				keys,
				members_with_roles: members,
			},
		] as Team[];

		expect(derivePerTeamInfo(teams)).toEqual({
			"team-1": {
				keys,
				team_info: {
					members_with_roles: members,
				},
			},
		});
	});

	it("uses empty collections for omitted keys and members", () => {
		expect(derivePerTeamInfo([{ team_id: "team-1" } as Team])).toEqual({
			"team-1": {
				keys: [],
				team_info: {
					members_with_roles: [],
				},
			},
		});
	});
});
