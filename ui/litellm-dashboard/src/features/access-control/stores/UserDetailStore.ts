import { reactive, shallowRef } from "vue";
import { accessApi, type AccessApi } from "../api/AccessApi";
import type { AccessRecord, AccessTeam, AccessUser } from "../support/AccessModels";
export function createUserDetailStore(
	id: string,
	onDeleted: () => void,
	onChanged: () => void | Promise<void>,
	api: AccessApi = accessApi,
) {
	const data = shallowRef<AccessUser | null>(null),
		teams = shallowRef<AccessTeam[]>([]),
		state = reactive({
			loading: true,
			pending: false,
			error: "",
			message: "",
			editing: false,
			tab: "overview",
			teamsExpanded: false,
			deleteOpen: false,
			teamOpen: false,
			selectedTeamId: "",
			selectedRole: "user",
			allTeams: [] as AccessTeam[],
			loadingTeams: false,
			removingTeam: null as AccessTeam | null,
		});
	let generation = 0,
		controller: AbortController | null = null;
	async function refresh() {
		const current = ++generation;
		controller?.abort();
		controller = new AbortController();
		state.loading = true;
		try {
			const result = await api.user(id, controller.signal);
			const details = await Promise.all(
				(result.teams ?? []).map(async (teamId) => {
					try {
						return (await api.team(teamId, controller?.signal)).team_info;
					} catch {
						return { team_id: teamId, models: [], keys: [], members_with_roles: [] } as AccessTeam;
					}
				}),
			);
			if (current === generation) {
				data.value = result;
				teams.value = details;
			}
		} catch (reason) {
			if (current === generation && !(reason instanceof DOMException && reason.name === "AbortError"))
				state.error = reason instanceof Error ? reason.message : "Failed to fetch user data";
		} finally {
			if (current === generation) state.loading = false;
		}
	}
	async function save(value: AccessRecord) {
		state.pending = true;
		state.error = "";
		try {
			await api.updateUser(value);
			if (data.value) {
				const next = { ...data.value };
				for (const name of ["user_email", "user_alias", "models", "max_budget", "budget_duration", "metadata"])
					if (Object.prototype.hasOwnProperty.call(value, name)) next[name] = value[name];
				data.value = next;
			}
			state.message = "User updated successfully";
			state.editing = false;
			await onChanged();
		} catch (reason) {
			state.error = reason instanceof Error ? reason.message : "Failed to update user";
		} finally {
			state.pending = false;
		}
	}
	async function remove() {
		state.pending = true;
		try {
			await api.deleteUsers([id]);
			state.message = "User deleted successfully";
			onDeleted();
		} catch (reason) {
			state.error = reason instanceof Error ? reason.message : "Failed to delete user";
		} finally {
			state.deleteOpen = false;
			state.pending = false;
		}
	}
	async function openTeam() {
		state.teamOpen = true;
		state.selectedTeamId = "";
		state.selectedRole = "user";
		state.loadingTeams = true;
		try {
			state.allTeams = await api.allTeams();
		} catch (reason) {
			state.error = reason instanceof Error ? reason.message : "Failed to fetch teams";
		} finally {
			state.loadingTeams = false;
		}
	}
	async function addTeam() {
		if (!state.selectedTeamId) return;
		state.pending = true;
		try {
			await api.addTeamMember(state.selectedTeamId, { role: state.selectedRole, user_id: id });
			await refresh();
			state.message = "User added to team successfully";
			state.teamOpen = false;
			await onChanged();
		} catch (reason) {
			state.error = reason instanceof Error ? reason.message : "Failed to add user to team";
		} finally {
			state.pending = false;
		}
	}
	async function removeTeam() {
		const team = state.removingTeam;
		if (!team) return;
		state.pending = true;
		try {
			await api.deleteTeamMember(team.team_id, { role: "user", user_id: id });
			await refresh();
			state.message = "User removed from team successfully";
			state.removingTeam = null;
			await onChanged();
		} catch (reason) {
			state.error = reason instanceof Error ? reason.message : "Failed to remove user from team";
		} finally {
			state.pending = false;
		}
	}
	function dispose() {
		++generation;
		controller?.abort();
	}
	return { state, data, teams, refresh, save, remove, openTeam, addTeam, removeTeam, dispose };
}
