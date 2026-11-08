import { computed, ref, watch } from "vue";
import { mcpApi } from "../api/McpServersApi";
import { mcpForwardedHeaders } from "../logic/McpToolSchemaLogic";
import type { MCPServer, MCPTool, MCPContent } from "../support/McpModels";
export function createMcpToolRunnerStore(server: Pick<MCPServer, "server_id" | "alias" | "extra_headers">) {
	const tools = ref<MCPTool[]>([]),
		loading = ref(false),
		error = ref(""),
		query = ref(""),
		headerValues = ref<Record<string, string>>({}),
		showHeaders = ref(false),
		selected = ref<MCPTool | null>(null),
		result = ref<MCPContent[] | null>(null),
		callError = ref(""),
		calling = ref(false),
		duration = ref<number | null>(null);
	const headers = computed(() => mcpForwardedHeaders(server.alias, headerValues.value)),
		filtered = computed(() =>
			tools.value.filter((tool) =>
				[tool.name, tool.description || "", tool.mcp_info?.server_name || ""].some((value) =>
					value.toLowerCase().includes(query.value.toLowerCase()),
				),
			),
		);
	let generation = 0,
		callGeneration = 0,
		disposed = false;
	async function load() {
		const version = ++generation;
		loading.value = true;
		error.value = "";
		try {
			const response = await mcpApi.tools(server.server_id, headers.value);
			if (disposed || version !== generation) return;
			tools.value = response.tools;
			error.value = response.error ? response.message || String(response.error) : "";
		} catch (reason) {
			if (!disposed && version === generation) error.value = reason instanceof Error ? reason.message : String(reason);
		} finally {
			if (!disposed && version === generation) loading.value = false;
		}
	}
	function select(tool: MCPTool | null) {
		++callGeneration;
		selected.value = tool;
		result.value = null;
		callError.value = "";
		duration.value = null;
		calling.value = false;
	}
	async function call(args: Record<string, unknown>) {
		if (!selected.value) return;
		const tool = selected.value,
			version = ++callGeneration,
			start = Date.now();
		calling.value = true;
		callError.value = "";
		result.value = null;
		duration.value = null;
		try {
			const value = await mcpApi.callTool(server.server_id, tool.name, args, headers.value);
			if (!disposed && version === callGeneration) result.value = value;
		} catch (reason) {
			if (!disposed && version === callGeneration) callError.value = reason instanceof Error ? reason.message : String(reason);
		} finally {
			if (!disposed && version === callGeneration) {
				calling.value = false;
				duration.value = Date.now() - start;
			}
		}
	}
	const stop = watch(headers, () => void load(), { deep: true, immediate: true });
	return {
		tools,
		loading,
		error,
		query,
		headerValues,
		showHeaders,
		headers,
		filtered,
		selected,
		result,
		callError,
		calling,
		duration,
		load,
		select,
		call,
		dispose() {
			disposed = true;
			++generation;
			++callGeneration;
			stop();
		},
	};
}
