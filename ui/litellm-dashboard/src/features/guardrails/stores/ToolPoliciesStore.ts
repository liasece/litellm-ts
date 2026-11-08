import { computed, reactive, ref, watch } from "vue";
import { toolPoliciesApi } from "../api/ToolPoliciesApi";
import { filterToolPolicies, sortToolPolicies, toolPolicyMetrics } from "../logic/ToolPolicyListLogic";
import type { ToolPolicyRow, ToolPolicySortField } from "../support/ToolPolicyModels";
export function createToolPoliciesStore(
	authorized: () => boolean,
	api = toolPoliciesApi,
	alertError = (message: string) => window.alert(message),
) {
	const tools = ref<ToolPolicyRow[]>([]),
		state = reactive({
			loading: true,
			fetching: false,
			error: "",
			savingInput: null as string | null,
			savingOutput: null as string | null,
			search: "",
			sortField: "created_at" as ToolPolicySortField,
			sortOrder: "desc" as "asc" | "desc",
			page: 1,
			liveTail: true,
			filters: {} as Record<string, string>,
		}),
		filtered = computed(() => filterToolPolicies(tools.value, state.search, state.filters)),
		sorted = computed(() => sortToolPolicies(filtered.value, state.sortField, state.sortOrder)),
		totalPages = computed(() => Math.max(1, Math.ceil(sorted.value.length / 50))),
		pageRows = computed(() => sorted.value.slice((state.page - 1) * 50, state.page * 50)),
		metrics = computed(() => toolPolicyMetrics(tools.value));
	let generation = 0,
		disposed = false,
		interval: ReturnType<typeof setInterval> | undefined;
	async function load() {
		if (!authorized()) return;
		const current = ++generation;
		state.fetching = true;
		state.error = "";
		try {
			const rows = await api.list();
			if (!disposed && current === generation) tools.value = rows;
		} catch (error) {
			if (!disposed && current === generation) state.error = error instanceof Error ? error.message : "Failed to load tools";
		} finally {
			if (!disposed && current === generation) {
				state.fetching = false;
				state.loading = false;
			}
		}
	}
	const stopWatch = watch(
		() => state.liveTail,
		(live) => {
			if (interval) clearInterval(interval);
			interval = live ? setInterval(() => void load(), 15000) : undefined;
		},
		{ immediate: true },
	);
	async function policy(name: string, value: string, type: "input" | "output") {
		if (!authorized()) return;
		const field = type === "input" ? "input_policy" : "output_policy",
			saving = type === "input" ? "savingInput" : "savingOutput";
		state[saving] = name;
		try {
			await api.update(name, { [field]: value });
			if (!disposed) tools.value = tools.value.map((tool) => (tool.tool_name === name ? { ...tool, [field]: value } : tool));
		} catch (error) {
			if (!disposed) alertError("Failed to update " + type + " policy: " + (error instanceof Error ? error.message : String(error)));
		} finally {
			if (!disposed) state[saving] = null;
		}
	}
	function sort(field: ToolPolicySortField, order: "asc" | "desc" | false) {
		state.sortField = order === false ? "created_at" : field;
		state.sortOrder = order === false ? "desc" : order;
		state.page = 1;
	}
	return {
		tools,
		state,
		filtered,
		sorted,
		totalPages,
		pageRows,
		metrics,
		load,
		policy,
		sort,
		apply(filters: Record<string, string>) {
			state.filters = filters;
			state.page = 1;
		},
		search(value: string) {
			state.search = value;
			state.page = 1;
		},
		dispose() {
			disposed = true;
			++generation;
			stopWatch();
			if (interval) clearInterval(interval);
		},
	};
}
