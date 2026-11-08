import { computed, reactive, ref, type Ref } from "vue";
import { testPrompt } from "../api/PromptsApi";
import { convertToDotPrompt, extractVariables } from "../logic/PromptSerializationLogic";
import { promptFrameContent, promptFrameUsage } from "../logic/PromptStreamLogic";
import { notificationManager } from "../../notifications/logic/NotificationManager";
import type { PromptConversationMessage, PromptDraft } from "../support/PromptModels";
import type { PlaygroundResponseUsage } from "../../playground/support/PlaygroundResponseMetricsModels";
export function createPromptConversationStore(prompt: Ref<PromptDraft>, authorized: () => boolean, stream = testPrompt) {
	const messages = ref<PromptConversationMessage[]>([]),
		variables = reactive<Record<string, string>>({}),
		state = reactive({ loading: false, input: "", variablesFilled: false }),
		extracted = computed(() => extractVariables(prompt.value)),
		missing = computed(() => extracted.value.filter((name) => !variables[name]?.trim()));
	let controller: AbortController | null = null,
		disposed = false;
	async function send() {
		if (!authorized()) {
			notificationManager.fromBackend("Access token is required");
			return;
		}
		if (missing.value.length) {
			notificationManager.fromBackend("Please fill in all template variables");
			return;
		}
		if (!state.input.trim()) return;
		if (!state.variablesFilled && extracted.value.length) state.variablesFilled = true;
		const previous = messages.value.map(({ role, content }) => ({ role, content })),
			input = state.input,
			body: Record<string, unknown> = { dotprompt_content: convertToDotPrompt(prompt.value) };
		if (!previous.length) body.prompt_variables = { ...variables };
		else body.conversation_history = [...previous, { role: "user", content: input }];
		messages.value.push({ role: "user", content: input });
		state.input = "";
		const current = new AbortController();
		controller = current;
		state.loading = true;
		const started = Date.now();
		let first: number | undefined,
			content = "",
			model: string | undefined,
			usage: PlaygroundResponseUsage | undefined;
		try {
			for await (const frame of stream(body, current.signal, () => {
				if (!disposed) messages.value.push({ role: "assistant", content: "" });
			})) {
				if (disposed) break;
				if (!model && typeof frame.model === "string") model = frame.model;
				const frameUsage = promptFrameUsage(frame);
				if (frameUsage) usage = frameUsage;
				const delta = promptFrameContent(frame);
				if (delta) {
					if (!first) first = Date.now() - started;
					content += delta;
					const last = messages.value.length - 1;
					if (last >= 0) messages.value[last] = { role: "assistant", content, model, timeToFirstToken: first };
				}
			}
			if (!disposed) {
				const last = messages.value.at(-1);
				if (last) {
					last.totalLatency = Date.now() - started;
					last.usage = usage;
				}
			}
		} catch (error) {
			if (!disposed && !(error instanceof Error && error.name === "AbortError")) {
				const text = "Error: " + (error instanceof Error ? error.message : String(error)),
					last = messages.value.at(-1);
				if (last?.role === "assistant" && last.content === "") messages.value.splice(-1, 1, { role: "assistant", content: text });
				else messages.value.push({ role: "assistant", content: text });
			}
		} finally {
			if (!disposed && controller === current) {
				state.loading = false;
				controller = null;
			}
		}
	}
	function cancel() {
		if (controller) {
			controller.abort();
			controller = null;
			state.loading = false;
			notificationManager.info("Request cancelled");
		}
	}
	function clear() {
		messages.value = [];
		state.variablesFilled = false;
		notificationManager.success("Chat history cleared.");
	}
	return {
		messages,
		variables,
		state,
		extracted,
		missing,
		send,
		cancel,
		clear,
		dispose() {
			disposed = true;
			controller?.abort();
			controller = null;
		},
	};
}
