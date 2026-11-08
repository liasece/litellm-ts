export interface NavigationItem {
	page: string;
	label: string;
	icon: string;
	roles?: readonly string[];
	badge?: string;
}
export interface NavigationGroup {
	label: string;
	collapsible?: boolean;
	roles?: readonly string[];
	items: readonly NavigationItem[];
}
export interface NavigationAccess {
	role: string;
	isOrganizationAdmin: boolean;
	projectsEnabled: boolean;
	enabledInternalPages: readonly string[] | null;
}
