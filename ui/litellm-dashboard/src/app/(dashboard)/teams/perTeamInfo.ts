import type { Member } from "@/components/networking";
import type { KeyResponse, Team } from "@/components/key_team_helpers/key_list";

export interface PerTeamInfo {
  keys: KeyResponse[];
  team_info: {
    members_with_roles: Member[];
  };
}

export function derivePerTeamInfo(teams: Team[] | null): Record<string, PerTeamInfo> {
  if (!teams) {
    return {};
  }

  return teams.reduce<Record<string, PerTeamInfo>>((perTeamInfo, team) => {
    perTeamInfo[team.team_id] = {
      keys: team.keys || [],
      team_info: {
        members_with_roles: team.members_with_roles || [],
      },
    };
    return perTeamInfo;
  }, {});
}
