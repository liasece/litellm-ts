import { reactive, shallowRef } from "vue";
import { accessApi, type AccessApi } from "../api/AccessApi";
import { buildOrganizationPayload } from "../logic/ResourceDraftLogic";
import type { AccessMember, AccessOrganization, AccessRecord } from "../support/AccessModels";
export function createOrganizationDetailStore(id: string, onChanged: () => void | Promise<void>, api: AccessApi = accessApi) {
	const data = shallowRef<AccessOrganization | null>(null),
		state = reactive({
			loading: true,
			pending: false,
			error: "",
			message: "",
			editing: false,
			memberOpen: false,
			editingMember: null as AccessMember | null,
		});
	let generation = 0,
		controller: AbortController | null = null;
	async function refresh() {
		const current = ++generation;
		controller?.abort();
		controller = new AbortController();
		state.loading = true;
		try {
			const result = await api.organization(id, controller.signal);
			if (current === generation) data.value = result;
		} catch (reason) {
			if (current === generation && !(reason instanceof DOMException && reason.name === "AbortError"))
				state.error = reason instanceof Error ? reason.message : "Failed to load organization information";
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
		if (!data.value) return;
		try {
			const payload = buildOrganizationPayload(draft, data.value);
			if (await run(() => api.updateOrganization(payload), "Organization settings updated successfully")) state.editing = false;
		} catch (reason) {
			state.error = reason instanceof Error ? reason.message : "Failed to update organization settings";
		}
	}
	async function member(value: AccessMember) {
		if (
			await run(
				() => (state.editingMember ? api.updateOrganizationMember(id, value) : api.addOrganizationMember(id, value)),
				state.editingMember ? "Organization member updated successfully" : "Organization member added successfully",
			)
		) {
			state.memberOpen = false;
			state.editingMember = null;
		}
	}
	async function deleteMember(member: AccessMember) {
		if (member.user_id)
			await run(() => api.deleteOrganizationMember(id, member.user_id as string), "Organization member deleted successfully");
	}
	function dispose() {
		++generation;
		controller?.abort();
	}
	return { data, state, refresh, save, member, deleteMember, dispose };
}
