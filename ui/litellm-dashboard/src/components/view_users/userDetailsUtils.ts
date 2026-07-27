import { teamInfoCall } from "../networking";
import type { TeamDisplayInfo } from "./types";

export async function fetchTeamDisplayInfo(
  accessToken: string,
  teamIds: string[],
): Promise<TeamDisplayInfo[]> {
  return Promise.all(
    teamIds.map(async (teamId) => {
      try {
        const teamData = await teamInfoCall(accessToken, teamId);
        return {
          team_id: teamId,
          team_alias: teamData?.team_info?.team_alias || null,
        };
      } catch {
        return { team_id: teamId, team_alias: null };
      }
    }),
  );
}
