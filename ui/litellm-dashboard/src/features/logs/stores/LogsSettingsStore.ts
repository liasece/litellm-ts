import { reactive, ref } from "vue";
import { proxyConfigApi, type ProxyConfigField } from "../../proxy-config/api/ProxyConfigApi";
import { LOGS_OPTIONAL_COLUMNS, type LogsOptionalColumnId } from "../support/LogsModels";
const known = new Set<string>(LOGS_OPTIONAL_COLUMNS.map((column) => column.id));
export function parseColumnPreferences(raw: string | null): LogsOptionalColumnId[] {
	try {
		const value: unknown = JSON.parse(raw || "null");
		return Array.isArray(value)
			? [...new Set(value.filter((item): item is LogsOptionalColumnId => typeof item === "string" && known.has(item)))]
			: [];
	} catch {
		return [];
	}
}
function readColumns() {
	try {
		return parseColumnPreferences(localStorage.getItem("logsVisibleOptionalColumns"));
	} catch {
		return [];
	}
}
export function createLogsSettingsStore(api: Pick<typeof proxyConfigApi, "list" | "update" | "deleteField"> = proxyConfigApi) {
	const columns = ref<LogsOptionalColumnId[]>(readColumns());
	const state = reactive({
		open: false,
		loading: false,
		saving: false,
		error: null as string | null,
		fields: [] as ProxyConfigField[],
		storePrompts: false,
		storeUpstream: false,
		retention: "",
	});
	let generation = 0,
		disposed = false;
	async function load() {
		const current = ++generation;
		state.loading = true;
		state.error = null;
		try {
			const fields = await api.list();
			if (disposed || current !== generation) return;
			state.fields = fields;
			const value = (name: string) => fields.find((field) => field.field_name === name)?.field_value;
			state.storePrompts = Boolean(value("store_prompts_in_spend_logs"));
			state.storeUpstream = Boolean(value("store_upstream_logs_in_spend_logs"));
			state.retention =
				typeof value("maximum_spend_logs_retention_period") === "string"
					? String(value("maximum_spend_logs_retention_period"))
					: "";
		} catch (error: unknown) {
			if (!disposed && current === generation)
				state.error = error instanceof Error ? error.message : "Failed to load spend logs settings";
		} finally {
			if (!disposed && current === generation) state.loading = false;
		}
	}
	async function show() {
		state.open = true;
		await load();
	}
	function setColumns(value: LogsOptionalColumnId[]) {
		columns.value = value;
		try {
			localStorage.setItem("logsVisibleOptionalColumns", JSON.stringify(value));
		} catch {
			/* Preference applies for this view. */
		}
	}
	async function save() {
		if (state.loading || state.saving) return;
		state.saving = true;
		state.error = null;
		try {
			if (!state.retention.trim())
				await api.deleteField("general_settings", "maximum_spend_logs_retention_period").catch(() => undefined);
			await api.update({
				general_settings: {
					store_prompts_in_spend_logs: state.storePrompts,
					store_upstream_logs_in_spend_logs: state.storeUpstream,
					...(state.retention.trim() ? { maximum_spend_logs_retention_period: state.retention } : {}),
				},
			});
			if (!disposed) {
				if (typeof window !== "undefined")
					window.dispatchEvent(
						new CustomEvent("litellm-notification", {
							detail: { type: "success", message: "Spend logs settings updated successfully" },
						}),
					);
				state.open = false;
				await load();
			}
		} catch (error: unknown) {
			if (!disposed) state.error = "Failed to save spend logs settings: " + (error instanceof Error ? error.message : String(error));
		} finally {
			if (!disposed) state.saving = false;
		}
	}
	function dispose() {
		disposed = true;
		generation++;
	}
	return {
		state,
		columns,
		show,
		load,
		save,
		setColumns,
		dispose,
		setOpen: (open: boolean) => {
			state.open = open;
		},
		setPrompts: (value: boolean) => {
			state.storePrompts = value;
		},
		setUpstream: (value: boolean) => {
			state.storeUpstream = value;
		},
		setRetention: (value: string | number | null) => {
			state.retention = String(value ?? "");
		},
	};
}
export type LogsSettingsStore = ReturnType<typeof createLogsSettingsStore>;
