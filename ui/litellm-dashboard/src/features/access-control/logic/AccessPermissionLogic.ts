import type { AccessOrganization, AccessTeam } from "../support/AccessModels";
export function adminOrganizations(role: string, userId: string, organizations: AccessOrganization[]): AccessOrganization[] {
	return role === "Admin"
		? organizations
		: organizations.filter((org) => org.members.some((member) => member.user_id === userId && member.user_role === "org_admin"));
}
export function canManageTeams(role: string, userId: string, organizations: AccessOrganization[]): boolean {
	return role === "Admin" || adminOrganizations(role, userId, organizations).length > 0;
}
export function canEditTeam(team: AccessTeam, role: string, userId: string, organizations: AccessOrganization[]): boolean {
	return (
		role === "Admin" ||
		team.members_with_roles.some((member) => member.user_id === userId && member.role === "admin") ||
		adminOrganizations(role, userId, organizations).some((org) => org.organization_id === team.organization_id)
	);
}
export function teamTabs(canEdit: boolean) {
	return [
		{ key: "overview", label: "Overview" },
		{ key: "virtual-keys", label: "Virtual Keys" },
		...(canEdit
			? [
					{ key: "members", label: "Members" },
					{ key: "settings", label: "Settings" },
				]
			: []),
	];
}
