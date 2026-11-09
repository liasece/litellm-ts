import { reactive, shallowRef } from "vue";
import { accessApi, type AccessApi } from "../api/AccessApi";
import type { AccessRecord, AccessTeam } from "../support/AccessModels";
import { buildTeamCreatePayload } from "../logic/ResourceDraftLogic";
export function createTeamsStore(role: string, userId: string, onChanged: () => void | Promise<void>, api: AccessApi = accessApi) {
	const rows = shallowRef<AccessTeam[]>([]),
		state = reactive({
			loading: true,
			pending: false,
			error: "",
			message: "",
			page: 1,
			pageSize: 10,
			total: 0,
			query: "",
			organizationId: "",
			sortBy: "created_at",
			sortOrder: "desc" as "asc" | "desc",
			tab: "your-teams",
			createOpen: false,
			deleting: null as AccessTeam | null,
			detailId: "",
			editDetail: false,
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
			const result = await api.teams(
				{
					page: state.page,
					page_size: state.pageSize,
					organization_id: state.organizationId,
					team_alias: state.query,
					user_id: role !== "Admin" && role !== "Admin Viewer" ? userId : null,
					sort_by: state.sortBy,
					sort_order: state.sortOrder,
				},
				controller.signal,
			);
			if (current === generation) {
				rows.value = result.rows;
				state.total = result.total;
			}
		} catch (reason) {
			if (current === generation && !(reason instanceof DOMException && reason.name === "AbortError"))
				state.error = reason instanceof Error ? reason.message : "Failed to load teams";
		} finally {
			if (current === generation) state.loading = false;
		}
	}
	function search(value: string | number | null) {
		state.query = String(value ?? "");
		state.page = 1;
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => void refresh(), 300);
	}
	function filter() {
		state.page = 1;
		return refresh();
	}
	function sort(key: string, order: "asc" | "desc" | null) {
		state.sortBy = order ? key : "created_at";
		state.sortOrder = order ?? "desc";
		return refresh();
	}
	async function run(operation: () => Promise<unknown>, message: string) {
		if (state.pending) return false;
		state.pending = true;
		state.error = "";
		try {
			await operation();
			state.message = message;
			await refresh();
			await onChanged();
			return true;
		} catch (reason) {
			state.error = reason instanceof Error ? reason.message : "Request failed";
			return false;
		} finally {
			state.pending = false;
		}
	}
	async function create(value: AccessRecord) {
		if (rows.value.some((team) => team.team_alias === value.team_alias)) {
			state.error = "Team alias " + value.team_alias + " already exists, please pick another alias";
			return;
		}
		try {
			if (await run(() => api.createTeam(buildTeamCreatePayload(value)), "Team created")) state.createOpen = false;
		} catch (reason) {
			state.error = reason instanceof Error ? reason.message : "Error creating the team";
		}
	}
	async function remove() {
		const team = state.deleting;
		if (team) {
			await run(() => api.deleteTeam(team.team_id), "Team deleted successfully");
			state.deleting = null;
		}
	}
	function dispose() {
		++generation;
		controller?.abort();
		if (timer) clearTimeout(timer);
	}
	return { state, rows, refresh, search, filter, sort, create, remove, dispose };
}
