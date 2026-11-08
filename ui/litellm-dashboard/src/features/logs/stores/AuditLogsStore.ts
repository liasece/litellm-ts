import { reactive, shallowRef } from "vue";
import { auxiliaryLogsApi, type AuditLogEntry } from "../api/AuxiliaryLogsApi";
export function createAuditLogsStore(api = auxiliaryLogsApi) {
	const state = reactive({
		page: 1,
		total: 0,
		loading: true,
		fetching: false,
		error: null as string | null,
		filters: { object_id: "", changed_by: "", object_team_id: "", object_key_hash: "", action: "", table_name: "" },
	});
	const rows = shallowRef<AuditLogEntry[]>([]);
	let disposed = false,
		generation = 0,
		request: AbortController | null = null;
	async function load() {
		const current = ++generation;
		request?.abort();
		request = new AbortController();
		state.fetching = true;
		state.error = null;
		const params = new URLSearchParams({ page: String(state.page), page_size: "50", sort_by: "updated_at", sort_order: "desc" });
		for (const [key, value] of Object.entries(state.filters)) if (value) params.set(key, value);
		try {
			const data = await api.audit(params, request.signal);
			if (disposed || current !== generation) return;
			rows.value = data.audit_logs;
			state.total = data.total;
		} catch (error: unknown) {
			if (!disposed && generation === current && !(error instanceof DOMException && error.name === "AbortError"))
				state.error = error instanceof Error ? error.message : "Failed to fetch audit logs";
		} finally {
			if (!disposed && current === generation) {
				state.loading = false;
				state.fetching = false;
			}
		}
	}
	function filter(name: keyof typeof state.filters, value: string) {
		state.filters[name] = value;
		state.page = 1;
		void load();
	}
	function page(value: number) {
		state.page = value;
		void load();
	}
	function dispose() {
		disposed = true;
		generation++;
		request?.abort();
	}
	return { state, rows, load, filter, page, dispose };
}
