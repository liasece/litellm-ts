import { reactive } from "vue";
import { usageAiApi } from "../api/UsageAiApi";
import type { UsageAiApi, UsageAiMessage, UsageAiToolStep } from "../support/UsageAiModels";
export function createUsageAiStore(api: UsageAiApi = usageAiApi) {
	const state = reactive({
		messages: [] as UsageAiMessage[],
		input: "",
		loading: false,
		selectedModel: "",
		models: [] as string[],
		modelsLoading: false,
		streaming: "",
		status: null as string | null,
		tools: [] as UsageAiToolStep[],
	});
	let disposed = false,
		generation = 0,
		controller: AbortController | null = null,
		modelsController: AbortController | null = null;
	async function loadModels() {
		if (disposed || state.models.length || state.modelsLoading) return;
		modelsController = new AbortController();
		state.modelsLoading = true;
		try {
			const models = await api.models(modelsController.signal);
			if (!disposed && !modelsController.signal.aborted) state.models = models;
		} catch {
			/* A model is optional: the backend default remains available. */
		} finally {
			if (!disposed) state.modelsLoading = false;
		}
	}
	async function send() {
		if (disposed || state.loading || !state.input.trim()) return;
		const current = ++generation,
			request = new AbortController();
		controller = request;
		state.messages.push({ role: "user", content: state.input.trim() });
		state.input = "";
		state.loading = true;
		state.streaming = "";
		state.status = null;
		state.tools = [];
		let content = "";
		const history = state.messages.slice(-20).map(({ role, content }) => ({ role, content }));
		try {
			for await (const event of api.stream(history, state.selectedModel || "", request.signal)) {
				if (disposed || current !== generation || request.signal.aborted) return;
				if (event.type === "chunk") {
					state.status = null;
					content += event.content;
					state.streaming = content;
				} else if (event.type === "status") state.status = event.message;
				else if (event.type === "tool_call") {
					const index = state.tools.findIndex((step) => step.tool_name === event.tool_name),
						step = { ...event };
					if (index >= 0) state.tools[index] = step;
					else state.tools.push(step);
				} else if (event.type === "done") {
					state.status = null;
					state.messages.push({
						role: "assistant",
						content,
						toolCalls: state.tools.length
							? structuredClone(state.tools.map((t) => ({ ...t, arguments: { ...t.arguments } })))
							: undefined,
					});
					state.tools = [];
					state.streaming = "";
				} else if (event.type === "error") {
					state.status = null;
					state.tools = [];
					state.messages.push({ role: "assistant", content: "Error: " + event.message });
					state.streaming = "";
				}
			}
		} catch (error: unknown) {
			if (disposed || current !== generation || request.signal.aborted) return;
			state.messages.push({
				role: "assistant",
				content: "Error: " + (error instanceof Error ? error.message : "Failed to get response. Please try again."),
			});
			state.streaming = "";
		} finally {
			if (!disposed && current === generation) {
				state.loading = false;
				if (controller === request) controller = null;
			}
		}
	}
	function stop() {
		generation++;
		controller?.abort();
		controller = null;
		state.loading = false;
	}
	function clear() {
		stop();
		state.messages = [];
		state.streaming = "";
		state.tools = [];
		state.status = null;
	}
	function dispose() {
		disposed = true;
		generation++;
		controller?.abort();
		modelsController?.abort();
	}
	return { state, loadModels, send, stop, clear, dispose };
}
