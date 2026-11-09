import { reactive } from "vue";
import { requestJson } from "../../platform/api/HttpApiClient";
import { queryPath } from "../api/AccessApi";
import { parseUsers, recordSchema } from "../api/AccessApiSchemas";
import type { AccessMember, AccessUser } from "../support/AccessModels";
export function createMemberEditorStore() {
	const state = reactive({
		draft: { role: "user" } as AccessMember,
		options: [] as AccessUser[],
		field: "user_email" as "user_email" | "user_id",
		loading: false,
		error: "",
	});
	let timer: ReturnType<typeof setTimeout> | undefined,
		controller: AbortController | null = null,
		generation = 0;
	function reset(member?: AccessMember, role = "user") {
		++generation;
		controller?.abort();
		if (timer) clearTimeout(timer);
		state.draft = member ? { ...member } : { role };
		state.options = [];
		state.error = "";
	}
	function search(text: string, field: "user_email" | "user_id") {
		if (timer) clearTimeout(timer);
		controller?.abort();
		const current = ++generation;
		state.field = field;
		if (!text) {
			state.options = [];
			return;
		}
		timer = setTimeout(async () => {
			controller = new AbortController();
			state.loading = true;
			try {
				const response = recordSchema.parse(
					await requestJson(queryPath("/user/list", { [field]: text, page: 1, page_size: 20 }), { signal: controller.signal }),
				);
				const options = parseUsers(response.users ?? []);
				if (current === generation) state.options = options;
			} catch (error: unknown) {
				if (current === generation && !(error instanceof DOMException && error.name === "AbortError"))
					state.error = error instanceof Error ? error.message : "Failed to fetch users";
			} finally {
				if (current === generation) state.loading = false;
			}
		}, 300);
	}
	function select(value: unknown) {
		const user = state.options.find((user) => user[state.field] === value);
		if (user) state.draft = { ...state.draft, user_id: user.user_id, user_email: user.user_email };
		else state.draft[state.field] = null;
	}
	function dispose() {
		++generation;
		controller?.abort();
		if (timer) clearTimeout(timer);
	}
	return { state, reset, search, select, dispose };
}
