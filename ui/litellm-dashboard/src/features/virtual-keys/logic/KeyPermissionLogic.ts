import { isProxyAdminRole, isUserTeamAdminForSingleTeam, rolesWithWriteAccess } from "../../identity/logic/UserRoleLogic";
import type { KeyTeam, VirtualKey } from "../support/VirtualKeyModels";

export function canModifyVirtualKey(key: VirtualKey, role: string, userId: string, teams: readonly KeyTeam[]): boolean {
	return (
		isProxyAdminRole(role) ||
		isUserTeamAdminForSingleTeam(teams.find((team) => team.team_id === key.team_id)?.members_with_roles ?? null, userId) ||
		(Boolean(userId) && key.user_id === userId && role === "Internal User")
	);
}
export function canCreateVirtualKey(role: string): boolean {
	return rolesWithWriteAccess.includes(role);
}
