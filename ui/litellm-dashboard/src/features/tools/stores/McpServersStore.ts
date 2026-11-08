import { computed, ref } from "vue";
import { mcpApi } from "../api/McpServersApi";
import { filterMcpServers } from "../logic/McpListLogic";
import { objectValue } from "../logic/McpDraftLogic";
import { MCP_EDIT_STATE } from "./McpEditorStore";
import type { MCPServer, Team } from "../support/McpModels";
export function createMcpServersStore() {
	const rows = ref<MCPServer[]>([]),
		loading = ref(false),
		healthLoading = ref(false),
		error = ref(""),
		team = ref("all"),
		group = ref("all"),
		selectedId = ref<string | null>(null),
		editing = ref(false),
		rechecking = ref(new Set<string>()),
		statuses = ref(new Map<string, string>());
	const controller = new AbortController();
	let generation = 0,
		disposed = false,
		timer: ReturnType<typeof setInterval> | undefined;
	let pendingEdit: string | null = null;
	try {
		const value = objectValue(JSON.parse(window.sessionStorage.getItem(MCP_EDIT_STATE) || "{}"));
		pendingEdit = typeof value.serverId === "string" ? value.serverId : null;
	} catch {
		pendingEdit = null;
	}
	const servers = computed(() =>
			rows.value.map((server) => ({
				...server,
				status: (statuses.value.get(server.server_id) || server.status) as MCPServer["status"],
			})),
		),
		filtered = computed(() => filterMcpServers(servers.value, team.value, group.value)),
		selected = computed(() => servers.value.find((server) => server.server_id === selectedId.value)),
		teams = computed(() => {
			const values = new Map<string, Team>();
			for (const server of servers.value)
				for (const item of server.teams || []) if (!values.has(item.team_id)) values.set(item.team_id, item);
			return [...values.values()];
		}),
		groups = computed(() => [
			...new Set(
				servers.value
					.flatMap((server) => server.mcp_access_groups || [])
					.filter((value): value is string => typeof value === "string"),
			),
		]);
	async function load() {
		const version = ++generation;
		loading.value = true;
		error.value = "";
		try {
			const values = await mcpApi.list(controller.signal);
			if (disposed || version !== generation) return;
			rows.value = values;
			if (pendingEdit && values.some((server) => server.server_id === pendingEdit)) {
				selectedId.value = pendingEdit;
				editing.value = true;
				pendingEdit = null;
			}
		} catch (reason) {
			if (!disposed && version === generation) error.value = reason instanceof Error ? reason.message : String(reason);
		} finally {
			if (!disposed && version === generation) loading.value = false;
		}
	}
	async function health(ids?: string[]) {
		if (ids) for (const id of ids) rechecking.value.add(id);
		else healthLoading.value = true;
		try {
			const values = await mcpApi.health(ids);
			if (disposed) return;
			const next = new Map(statuses.value);
			for (const value of values) next.set(value.server_id, value.status);
			statuses.value = next;
		} catch {
			if (!ids) statuses.value = new Map();
		} finally {
			if (ids) for (const id of ids) rechecking.value.delete(id);
			else healthLoading.value = false;
		}
	}
	function initialize() {
		void load();
		void health();
		timer = setInterval(() => void health(), 30000);
	}
	function close() {
		selectedId.value = null;
		editing.value = false;
	}
	return {
		rows,
		servers,
		filtered,
		loading,
		error,
		healthLoading,
		team,
		group,
		selectedId,
		selected,
		editing,
		rechecking,
		teams,
		groups,
		load,
		health,
		initialize,
		close,
		dispose() {
			disposed = true;
			++generation;
			controller.abort();
			if (timer) clearInterval(timer);
		},
	};
}
