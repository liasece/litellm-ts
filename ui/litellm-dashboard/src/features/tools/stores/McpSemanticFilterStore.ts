import { reactive, ref } from "vue";
import { mcpSettingsApi } from "../api/McpSettingsApi";
import { semanticTest } from "../api/McpServersApi";
import { parseSemanticFilterHeaders } from "../logic/McpSemanticLogic";
export function createMcpSemanticFilterStore() {
	const state = reactive({
			loading: true,
			pending: false,
			testing: false,
			dirty: false,
			saved: false,
			error: "",
			updateError: "",
			message: "",
			query: "",
			model: "gpt-4o",
		}),
		draft = reactive<Record<string, unknown>>({
			enabled: false,
			embedding_model: "text-embedding-3-small",
			top_k: 10,
			similarity_threshold: 0.3,
		}),
		schema = ref<Record<string, unknown>>({}),
		applied = ref<Record<string, unknown>>({}),
		result = ref<ReturnType<typeof parseSemanticFilterHeaders>>(null);
	let timer: ReturnType<typeof setTimeout> | undefined;
	async function load() {
		state.loading = true;
		state.error = "";
		try {
			const data = await mcpSettingsApi.semantic();
			schema.value = data.field_schema || {};
			applied.value = data.values;
			Object.assign(draft, {
				enabled: data.values.enabled ?? false,
				embedding_model: data.values.embedding_model ?? "text-embedding-3-small",
				top_k: data.values.top_k ?? 10,
				similarity_threshold: data.values.similarity_threshold ?? 0.3,
			});
			state.dirty = false;
		} catch (error) {
			state.error = error instanceof Error ? error.message : String(error);
		} finally {
			state.loading = false;
		}
	}
	async function save() {
		if (state.pending) return;
		state.pending = true;
		state.updateError = "";
		try {
			await mcpSettingsApi.saveSemantic({ ...draft });
			state.dirty = false;
			state.saved = true;
			state.message = "Settings updated successfully. Changes will be applied across all pods within 10 seconds.";
			timer = setTimeout(() => {
				state.saved = false;
			}, 3000);
			await load();
		} catch (error) {
			state.updateError = error instanceof Error ? error.message : String(error);
		} finally {
			state.pending = false;
		}
	}
	async function test() {
		if (!state.query || !state.model) {
			state.message = "";
			state.updateError = "Please enter a query and select a model";
			return;
		}
		state.testing = true;
		result.value = null;
		try {
			const headers = await semanticTest(state.model, state.query);
			result.value = parseSemanticFilterHeaders(headers.filter, headers.tools);
			state.message = result.value
				? "Semantic filter test completed successfully"
				: "Semantic filter is not enabled or no tools were filtered";
		} catch {
			state.updateError = "Failed to test semantic filter";
		} finally {
			state.testing = false;
		}
	}
	return {
		state,
		draft,
		schema,
		applied,
		result,
		load,
		save,
		test,
		dispose() {
			if (timer) clearTimeout(timer);
		},
	};
}
