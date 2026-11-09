import { reactive } from "vue";
import { usageCatalogApi } from "../api/UsageCatalogApi";
import type { EntityOption } from "../support/UsageModels";
export function createUsageCatalogStore(api = usageCatalogApi) {
	const state = reactive({
		users: [] as EntityOption[],
		maxBudget: null as number | null,
		usersLoading: false,
		usersFetchingMore: false,
		userPage: 0,
		userTotalPages: 0,
		userSearch: "",
	});
	let disposed = false,
		userGeneration = 0,
		searchTimer: ReturnType<typeof setTimeout> | null = null;
	const controller = new AbortController();
	let userController: AbortController | null = null;
	async function users(append = false): Promise<void> {
		if (disposed || (append && (state.usersFetchingMore || state.usersLoading || state.userPage >= state.userTotalPages))) return;
		const current = append ? userGeneration : ++userGeneration;
		if (!append) {
			userController?.abort();
			userController = new AbortController();
			state.usersLoading = true;
			state.users = [];
		} else state.usersFetchingMore = true;
		const request = userController ?? new AbortController(),
			page = append ? state.userPage + 1 : 1;
		try {
			const data = await api.users(page, state.userSearch, request.signal);
			if (disposed || current !== userGeneration) return;
			const existing = append ? state.users : [],
				seen = new Set(existing.map((u) => u.value));
			state.users = [
				...existing,
				...data.rows
					.filter((u) => {
						if (seen.has(u.user_id)) return false;
						seen.add(u.user_id);
						return true;
					})
					.map((u) => ({
						value: u.user_id,
						label: u.user_alias
							? u.user_alias + " (" + u.user_id + ")"
							: u.user_email
								? u.user_email + " (" + u.user_id + ")"
								: u.user_id,
					})),
			];
			state.userPage = data.page;
			state.userTotalPages = data.totalPages;
		} catch {
			/* The selector stays usable with already loaded options. */
		} finally {
			if (current === userGeneration && !disposed) {
				state.usersLoading = false;
				state.usersFetchingMore = false;
			}
		}
	}
	function searchUsers(value: string) {
		if (searchTimer) clearTimeout(searchTimer);
		searchTimer = setTimeout(() => {
			state.userSearch = value;
			void users();
		}, 300);
	}
	function scrollUsers(event: Event) {
		const element = event.currentTarget as HTMLElement;
		if ((element.scrollTop + element.clientHeight) / element.scrollHeight >= 0.8) void users(true);
	}
	async function initialize(admin: boolean): Promise<void> {
		const tasks = [
			api.currentUser(controller.signal).then((user) => {
				if (!disposed) state.maxBudget = user.max_budget ?? null;
			}),
		];
		if (admin) tasks.push(users());
		await Promise.allSettled(tasks);
	}
	function dispose() {
		disposed = true;
		controller.abort();
		userGeneration++;
		userController?.abort();
		if (searchTimer) clearTimeout(searchTimer);
	}
	return { state, initialize, searchUsers, scrollUsers, dispose };
}
