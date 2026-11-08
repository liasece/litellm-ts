import { computed, ref, watch } from "vue";
import { mcpApi } from "../api/McpServersApi";
import { canTestMcp, mcpConnectionConfig } from "../logic/McpDraftLogic";
import type { MCPTool } from "../support/McpModels";
export function createMcpConnectionStore(values: () => Record<string, unknown>) {
	const tools = ref<MCPTool[]>([]),
		loading = ref(false),
		error = ref(""),
		stack = ref(""),
		token = ref<string | null>(null),
		canFetch = computed(() => canTestMcp(values(), token.value));
	let generation = 0;
	async function fetch() {
		if (!canFetch.value) return;
		const current = ++generation;
		loading.value = true;
		error.value = "";
		try {
			const result = await mcpApi.testTools(mcpConnectionConfig(values()), token.value);
			if (current !== generation) return;
			if (result.tools && !result.error) {
				tools.value = result.tools;
				error.value = "";
				stack.value = "";
			} else {
				tools.value = [];
				error.value = result.message || "Failed to retrieve tools list";
				stack.value = result.stack_trace || "";
			}
		} catch (reason) {
			if (current === generation) {
				error.value = reason instanceof Error ? reason.message : String(reason);
				tools.value = [];
				stack.value = "";
			}
		} finally {
			if (current === generation) loading.value = false;
		}
	}
	function clear() {
		++generation;
		tools.value = [];
		error.value = "";
		stack.value = "";
		loading.value = false;
	}
	const stop = watch(
		() => {
			const draft = values();
			return [
				draft.url,
				draft.spec_path,
				draft.transport,
				draft.auth_type,
				JSON.stringify(draft.static_headers || {}),
				JSON.stringify(draft.credentials || {}),
				token.value,
				canFetch.value,
			];
		},
		() => {
			if (canFetch.value) void fetch();
			else clear();
		},
		{ immediate: true },
	);
	return {
		tools,
		loading,
		error,
		stack,
		token,
		canFetch,
		fetch,
		clear,
		dispose() {
			stop();
			clear();
		},
	};
}
