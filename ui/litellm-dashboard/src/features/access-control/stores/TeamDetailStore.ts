import { reactive, shallowRef } from "vue";
import { accessApi, type AccessApi } from "../api/AccessApi";
import type { AccessMember, AccessRecord, TeamDetail } from "../support/AccessModels";
import { buildTeamUpdatePayload } from "../logic/ResourceDraftLogic";
export function createTeamDetailStore(id: string, onChanged: () => void | Promise<void>, api: AccessApi = accessApi) {
	const data = shallowRef<TeamDetail | null>(null),
		state = reactive({
			loading: true,
			pending: false,
			error: "",
			message: "",
			memberOpen: false,
			deletingMember: null as AccessMember | null,
			editing: false,
		});
	let generation = 0,
		controller: AbortController | null = null;
	async function refresh() {
		const current = ++generation;
		controller?.abort();
		controller = new AbortController();
		state.loading = true;
		try {
			const result = await api.team(id, controller.signal);
			if (current === generation) data.value = result;
		} catch (reason) {
			if (current === generation && !(reason instanceof DOMException && reason.name === "AbortError"))
				state.error = reason instanceof Error ? reason.message : "Failed to load team information";
		} finally {
			if (current === generation) state.loading = false;
		}
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
	async function save(draft: AccessRecord) {
		try {
			const payload = buildTeamUpdatePayload(id, draft);
			if (await run(() => api.updateTeam(payload), "Team settings updated successfully")) state.editing = false;
		} catch (reason) {
			state.error = reason instanceof Error ? reason.message : "Failed to update team";
		}
	}
	async function member(value: AccessMember) {
		if (await run(() => api.addTeamMember(id, value), "Team member added successfully")) {
			state.memberOpen = false;
		}
	}
	async function deleteMember() {
		const member = state.deletingMember;
		if (member) {
			await run(() => api.deleteTeamMember(id, member), "Team member removed successfully");
			state.deletingMember = null;
		}
	}
	function dispose() {
		++generation;
		controller?.abort();
	}
	return { data, state, refresh, save, member, deleteMember, dispose };
}
