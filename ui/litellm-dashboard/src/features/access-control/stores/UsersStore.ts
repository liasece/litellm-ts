import { notificationManager } from "../../notifications/logic/NotificationManager";
import { reactive, shallowRef } from "vue";
import { accessApi, type AccessApi } from "../api/AccessApi";
import { objectValue } from "../logic/ResourceDraftLogic";
import { buildBulkUserPayload, buildInviteUserPayload } from "../logic/UserDraftLogic";
import type { AccessRecord, AccessTeam, AccessUser } from "../support/AccessModels";
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
			selection: false,
			selected: [] as string[],
			detailId: "",
			editDetail: false,
			deleting: null as AccessUser | null,
			inviteOpen: false,
			bulkInviteOpen: false,
			bulkEditOpen: false,
			invitationOpen: false,
			invitation: null as AccessRecord | null,
			resetInvitation: false,
			tab: "users",
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
	async function resetPassword(id: string) {
		notificationManager.success("Generating password reset link...");
		try {
			state.invitation = await api.invite(id);
			state.resetInvitation = true;
			state.invitationOpen = true;
		} catch (reason) {
			state.error = reason instanceof Error ? reason.message : "Failed to generate password reset link";
		}
	}
	async function invite(value: AccessRecord, sso: boolean) {
		state.pending = true;
		state.error = "";
		try {
			const response = objectValue(await api.createUser(buildInviteUserPayload(value)));
			const userId = String(objectValue(response.data).user_id ?? response.user_id ?? "");
			if (!userId) throw new Error("User creation did not return a user ID");
			await refresh();
			state.invitation = sso
				? { id: crypto.randomUUID(), user_id: userId, has_user_setup_sso: true }
				: { ...(await api.invite(userId)), has_user_setup_sso: false };
			state.resetInvitation = false;
			state.invitationOpen = true;
			state.message = "API user Created";
			return true;
		} catch (reason) {
			state.error = reason instanceof Error ? reason.message : "Error creating the user";
			return false;
		} finally {
			state.pending = false;
		}
	}
	async function bulk(value: AccessRecord, teamIds: string[], budget: number | null, all: boolean) {
		const body = buildBulkUserPayload(value);
		if (!Object.keys(body).length && !teamIds.length) {
			state.error = "Please modify at least one field or select teams to add users to";
			return false;
		}
		state.pending = true;
		state.error = "";
		try {
			const messages: string[] = [];
			if (Object.keys(body).length) {
				const result = objectValue(await api.bulkUpdateUsers(body, state.selected, all));
				messages.push(
					all ? "Updated all users (" + result.total_requested + " total)" : "Updated " + state.selected.length + " user(s)",
				);
			}
			let successful = 0,
				failed = 0,
				additions = 0;
			for (const id of teamIds) {
				try {
					const result = objectValue(
						await api.bulkTeamMembers(
							id,
							state.selected.map((userId) => ({
								user_id: userId,
								role: "user",
								user_email: rows.value.find((user) => user.user_id === userId)?.user_email ?? null,
							})),
							budget || null,
							all,
						),
					);
					successful++;
					additions += Number(result.successful_additions ?? 0);
				} catch {
					failed++;
				}
			}
			if (successful) messages.push("Added users to " + successful + " team(s) (" + additions + " total additions)");
			if (failed) state.error = "Failed to add users to " + failed + " team(s)";
			state.message = messages.join(". ");
			state.selected = [];
			state.selection = false;
			state.bulkEditOpen = false;
			await refresh();
			return true;
		} catch (reason) {
			state.error = reason instanceof Error ? reason.message : "Failed to perform bulk operations";
			return false;
		} finally {
			state.pending = false;
		}
	}
	function selectedUsers() {
		return rows.value.filter((user) => state.selected.includes(user.user_id));
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
	return { state, rows, refresh, filter, reset, remove, resetPassword, invite, bulk, selectedUsers, userTeams, dispose };
}
