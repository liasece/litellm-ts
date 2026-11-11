import { computed, inject, reactive, type InjectionKey } from "vue";
import { applicationApi } from "../api/ApplicationApi";
import type { ShellOrganization, ShellSettings, ShellTeam, ShellTheme } from "../support/ApplicationModels";

export function createApplicationStore() {
	const state = reactive({
		settings: {} as ShellSettings,
		organizations: [] as ShellOrganization[],
		teams: [] as ShellTeam[],
		theme: {} as ShellTheme,
		proxySettings: {} as Record<string, unknown>,
		loading: false,
		errors: [] as string[],
	});
	let generation = 0;
	async function initialize(): Promise<void> {
		const current = ++generation;
		state.loading = true;
		const results = await Promise.allSettled([
			applicationApi.settings(),
			applicationApi.organizations(),
			applicationApi.teams(),
			applicationApi.theme(),
			applicationApi.proxySettings(),
		]);
		if (generation !== current) return;
		const [settings, organizations, teams, theme, proxy] = results;
		if (settings.status === "fulfilled") state.settings = settings.value;
		if (organizations.status === "fulfilled") state.organizations = organizations.value;
		if (teams.status === "fulfilled") state.teams = teams.value;
		if (theme.status === "fulfilled") state.theme = theme.value;
		if (proxy.status === "fulfilled") state.proxySettings = proxy.value;
		state.errors = results
			.filter((result): result is PromiseRejectedResult => result.status === "rejected")
			.map((result) => (result.reason instanceof Error ? result.reason.message : "Failed to load dashboard settings"));
		state.loading = false;
	}
	function clear(): void {
		generation++;
		state.organizations = [];
		state.teams = [];
		state.settings = {};
		state.proxySettings = {};
		state.errors = [];
		state.loading = false;
	}
	const logoUrl = computed(() => state.theme.logo_url);
	return { state, logoUrl, initialize, clear };
}
export type ApplicationStore = ReturnType<typeof createApplicationStore>;
export const applicationStoreKey: InjectionKey<ApplicationStore> = Symbol("application");
export function useApplicationStore(): ApplicationStore {
	const store = inject(applicationStoreKey);
	if (!store) throw new Error("ApplicationStore is unavailable");
	return store;
}
