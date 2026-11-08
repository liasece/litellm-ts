import { ref, computed } from "vue";
import { accessApi } from "../api/AccessApi";
import type { AccessTeam } from "../support/AccessModels";
export function createTeamSelectionStore(
	identity: () => { authorized: boolean; userId?: string; role: string; organizationId?: string | null; pageSize: number },
	load = accessApi.teams,
) {
	const teams = ref<AccessTeam[]>([]),
		loading = ref(false),
		loadingNext = ref(false),
		page = ref(0),
		totalPages = ref(0),
		search = ref("");
	let generation = 0,
		disposed = false,
		timer: ReturnType<typeof setTimeout> | undefined;
	const options = computed(() =>
		teams.value.map((team) => ({ value: team.team_id, label: (team.team_alias ?? "") + " (" + team.team_id + ")" })),
	);
	async function fetchPage(next: number, reset = false) {
		const who = identity();
		if (!who.authorized) return;
		const current = reset ? ++generation : generation;
		if (reset) {
			teams.value = [];
			page.value = 0;
			totalPages.value = 0;
			loading.value = true;
		} else loadingNext.value = true;
		try {
			const result = await load({
				organization_id: who.organizationId,
				team_alias: search.value || undefined,
				user_id: who.role === "Admin" || who.role === "Admin Viewer" ? undefined : who.userId,
				page: next,
				page_size: who.pageSize,
			});
			if (disposed || current !== generation) return;
			const values = reset ? result.rows : [...teams.value, ...result.rows],
				seen = new Set<string>();
			teams.value = values.filter((team) => {
				if (seen.has(team.team_id)) return false;
				seen.add(team.team_id);
				return true;
			});
			page.value = result.page;
			totalPages.value = result.totalPages;
		} catch {
			if (!disposed && current === generation && reset) teams.value = [];
		} finally {
			if (!disposed && current === generation) {
				loading.value = false;
				loadingNext.value = false;
			}
		}
	}
	function refresh() {
		return fetchPage(1, true);
	}
	function queue(value: string) {
		search.value = value;
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => void refresh(), 300);
	}
	function next() {
		if (!loading.value && !loadingNext.value && page.value < totalPages.value) void fetchPage(page.value + 1);
	}
	return {
		teams,
		options,
		loading,
		loadingNext,
		page,
		totalPages,
		search,
		refresh,
		queue,
		next,
		dispose() {
			disposed = true;
			++generation;
			if (timer) clearTimeout(timer);
		},
	};
}
