import { computed, ref } from "vue";
import { mcpApi } from "../api/McpServersApi";
import { mcpSettingsApi } from "../api/McpSettingsApi";
import { objectValue } from "../logic/McpDraftLogic";
import { SETTINGS_KEY } from "../support/McpStandardsSupport";
import { notificationManager } from "../../notifications/logic/NotificationManager";
import type { MCPSubmissionsSummary, MCPServer } from "../support/McpModels";
export function createMcpSubmissionsStore() {
	const summary = ref<MCPSubmissionsSummary>({ total: 0, pending_review: 0, active: 0, rejected: 0, items: [] }),
		loading = ref(true),
		error = ref(""),
		search = ref(""),
		status = ref("all"),
		required = ref<string[]>([]),
		saving = ref(false),
		confirm = ref<{ server: MCPServer; action: "approve" | "reject" } | null>(null),
		pending = ref(false);
	let disposed = false;
	const filtered = computed(() =>
		summary.value.items.filter((server) => {
			if (status.value !== "all" && server.approval_status !== status.value) return false;
			if (search.value.trim()) {
				const q = search.value.toLowerCase();
				return (
					(server.alias ?? server.server_name ?? server.server_id ?? "").toLowerCase().includes(q) ||
					(server.url ?? "").toLowerCase().includes(q)
				);
			}
			return true;
		}),
	);
	async function load() {
		loading.value = true;
		error.value = "";
		try {
			const [value, settings] = await Promise.all([mcpApi.submissions(), mcpSettingsApi.generalRaw().catch(() => null)]);
			if (disposed) return;
			summary.value = value;
			const data = objectValue(settings).data;
			if (Array.isArray(data)) {
				const row = data.map(objectValue).find((row) => row.field_name === SETTINGS_KEY);
				if (Array.isArray(row?.field_value))
					required.value = row.field_value.filter((field): field is string => typeof field === "string");
			}
		} catch (reason) {
			if (!disposed) error.value = reason instanceof Error ? reason.message : "Failed to load submissions";
		} finally {
			if (!disposed) loading.value = false;
		}
	}
	async function save() {
		saving.value = true;
		try {
			await mcpSettingsApi.update(SETTINGS_KEY, required.value);
			notificationManager.success("Submission rules saved");
		} catch {
			notificationManager.fromBackend("Failed to save submission rules");
		} finally {
			saving.value = false;
		}
	}
	async function review(notes?: string) {
		if (!confirm.value) return;
		const { server, action } = confirm.value;
		pending.value = true;
		try {
			if (action === "approve") await mcpApi.approve(server.server_id);
			else await mcpApi.reject(server.server_id, notes || undefined);
			await load();
			notificationManager.success(
				'MCP server "' +
					(server.alias ?? server.server_name ?? server.server_id) +
					'" ' +
					(action === "approve" ? "approved" : "rejected"),
			);
		} catch {
			notificationManager.fromBackend("Failed to " + action + " MCP server");
		} finally {
			pending.value = false;
			confirm.value = null;
		}
	}
	return {
		summary,
		loading,
		error,
		search,
		status,
		required,
		saving,
		confirm,
		pending,
		filtered,
		load,
		save,
		review,
		dispose() {
			disposed = true;
		},
	};
}
