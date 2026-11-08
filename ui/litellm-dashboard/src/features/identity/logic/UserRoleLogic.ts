export const old_admin_roles = ["Admin", "Admin Viewer"];
export const v2_admin_role_names = ["proxy_admin", "proxy_admin_viewer", "org_admin"];
export const all_admin_roles = [...old_admin_roles, ...v2_admin_role_names];
export const internalUserRoles = ["Internal User", "Internal Viewer"];
export const rolesAllowedToSeeUsage = ["Admin", "Admin Viewer", "Internal User", "Internal Viewer"];
export const rolesWithWriteAccess = ["Internal User", "Admin", "proxy_admin"];

export const isAdminRole = (role: string): boolean => all_admin_roles.includes(role);
export const isProxyAdminRole = (role: string): boolean => role === "proxy_admin" || role === "Admin";

interface TeamMember {
	user_id: string;
	role: string;
}
interface TeamWithMembers {
	members_with_roles: TeamMember[] | null;
}

export function isUserTeamAdminForSingleTeam(members: TeamMember[] | null, userId: string): boolean {
	return members?.some((member) => member.user_id === userId && member.role === "admin") ?? false;
}

export function isUserTeamAdminForAnyTeam(teams: TeamWithMembers[] | null, userId: string): boolean {
	return teams?.some((team) => isUserTeamAdminForSingleTeam(team.members_with_roles, userId)) ?? false;
}

export function formatUserRole(role: string): string {
	if (!role) return "Undefined Role";
	switch (role.toLowerCase()) {
		case "app_owner":
		case "demo_app_owner":
			return "App Owner";
		case "app_admin":
		case "proxy_admin":
			return "Admin";
		case "proxy_admin_viewer":
			return "Admin Viewer";
		case "org_admin":
			return "Org Admin";
		case "internal_user":
			return "Internal User";
		case "internal_user_viewer":
		case "internal_viewer":
			return "Internal Viewer";
		case "app_user":
			return "App User";
		default:
			return "Unknown Role";
	}
}
