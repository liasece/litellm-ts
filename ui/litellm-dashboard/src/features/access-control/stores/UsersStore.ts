import { reactive, shallowRef } from "vue";
import { accessApi, type AccessApi } from "../api/AccessApi";
import type { AccessTeam, AccessUser } from "../support/AccessModels";
export function emptyUserFilters() {
	return {
		email: "",
		user_id: "",
		user_role: "",
		sso_user_id: "",
		team: "",
		sort_by: "created_at",
		sort_order: "desc" as "asc" | "desc",
	};
}
export function createUsersStore(organizationIds: string[], api: AccessApi = accessApi) {
	const rows = shallowRef<AccessUser[]>([]),
		state = reactive({
			filters: emptyUserFilters(),
			loading: true,
			pending: false,
			error: "",
			message: "",
			page: 1,
			pageSize: 25,
			total: 0,
			totalPages: 1,
			expanded: false,
			detailId: "",
			editDetail: false,
			deleting: null as AccessUser | null,
		});
	let generation = 0,
		controller: AbortController | null = null,
		timer: ReturnType<typeof setTimeout> | undefined;
	async function refresh() {
		const current = ++generation;
		controller?.abort();
		controller = new AbortController();
		state.loading = true;
		state.error = "";
		try {
			const filter = state.filters,
				response = await api.users(
					{
						page: state.page,
						page_size: 25,
						user_ids: filter.user_id,
						user_email: filter.email,
						role: filter.user_role,
						team: filter.team,
						sso_user_ids: filter.sso_user_id,
						sort_by: filter.sort_by,
						sort_order: filter.sort_order,
						organization_ids: organizationIds.join(","),
					},
					controller.signal,
				);
			if (current === generation) {
				rows.value = response.rows;
				state.total = response.total;
				state.totalPages = response.totalPages;
			}
		} catch (reason) {
			if (current === generation && !(reason instanceof DOMException && reason.name === "AbortError"))
				state.error = reason instanceof Error ? reason.message : "Failed to load users";
		} finally {
			if (current === generation) state.loading = false;
		}
	}
	function filter(update: Partial<ReturnType<typeof emptyUserFilters>>) {
		Object.assign(state.filters, update);
		state.page = 1;
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => void refresh(), 300);
	}
	function reset() {
		filter(emptyUserFilters());
	}
	async function remove() {
		const user = state.deleting;
		if (!user) return;
		state.pending = true;
		try {
			await api.deleteUsers([user.user_id]);
			rows.value = rows.value.filter((row) => row.user_id !== user.user_id);
			state.message = "User deleted successfully";
		} catch (reason) {
			state.error = reason instanceof Error ? reason.message : "Failed to delete user";
		} finally {
			state.deleting = null;
			state.pending = false;
		}
	}
	function userTeams(user: AccessUser, teams: AccessTeam[]) {
		return (user.teams ?? [])
			.map((id) => teams.find((team) => team.team_id === id))
			.filter((team): team is AccessTeam => Boolean(team));
	}
	function dispose() {
		++generation;
		controller?.abort();
		if (timer) clearTimeout(timer);
	}
	return { state, rows, refresh, filter, reset, remove, userTeams, dispose };
}
