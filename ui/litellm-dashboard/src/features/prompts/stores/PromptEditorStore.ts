import { computed, reactive, ref } from "vue";
import { promptsApi } from "../api/PromptsApi";
import { parseExistingPrompt, convertToDotPrompt, extractVariables } from "../logic/PromptSerializationLogic";
import { notificationManager } from "../../notifications/logic/NotificationManager";
import type { PromptDraft, PromptInfoResponse, PromptSpec } from "../support/PromptModels";
export function emptyPrompt(): PromptDraft {
	return {
		name: "New prompt",
		model: "gpt-4o",
		config: { temperature: 1, max_tokens: 1000 },
		tools: [],
		developerMessage: "",
		messages: [{ role: "user", content: "Enter task specifics. Use {{template_variables}} for dynamic inputs" }],
	};
}
function initialVersion(value?: PromptInfoResponse | null) {
	const spec = value?.prompt_spec;
	if (!spec) return undefined;
	const version = spec.version || spec.litellm_params?.prompt_id;
	if (typeof version === "number") return spec.prompt_id + ".v" + version;
	if (typeof version === "string" && (version.includes(".v") || version.includes("_v"))) return version;
	return spec.prompt_id;
}
export function createPromptEditorStore(initial?: PromptInfoResponse | null) {
	let parsed = emptyPrompt();
	if (initial)
		try {
			parsed = parseExistingPrompt(initial);
		} catch {
			notificationManager.fromBackend("Failed to parse prompt data");
		}
	const prompt = ref(parsed),
		state = reactive({
			editMode: Boolean(initial),
			activeVersionId: initialVersion(initial),
			history: false,
			toolModal: false,
			publish: false,
			editingTool: null as number | null,
			saving: false,
			view: "pretty",
			parameters: false,
		}),
		variables = computed(() => extractVariables(prompt.value)),
		dotprompt = computed(() => convertToDotPrompt(prompt.value));
	function addMessage() {
		prompt.value.messages.push({ role: "user", content: "" });
	}
	function updateMessage(index: number, field: "role" | "content", value: string) {
		const row = prompt.value.messages[index];
		if (row) row[field] = value;
	}
	function removeMessage(index: number) {
		if (prompt.value.messages.length > 1) prompt.value.messages.splice(index, 1);
	}
	function moveMessage(from: number, to: number) {
		const rows = [...prompt.value.messages],
			moved = rows.splice(from, 1)[0];
		if (!moved) return;
		rows.splice(to, 0, moved);
		prompt.value.messages = rows;
	}
	function editTool(index?: number) {
		state.editingTool = index ?? null;
		state.toolModal = true;
	}
	function saveTool(json: string) {
		try {
			const parsed: unknown = JSON.parse(json),
				value = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {},
				fn = value.function && typeof value.function === "object" ? (value.function as Record<string, unknown>) : {};
			const tool = {
				name: typeof fn.name === "string" && fn.name ? fn.name : "Unnamed Tool",
				description: typeof fn.description === "string" ? fn.description : "",
				json,
			};
			if (state.editingTool !== null) prompt.value.tools.splice(state.editingTool, 1, tool);
			else prompt.value.tools.push(tool);
			state.toolModal = false;
			state.editingTool = null;
			return true;
		} catch {
			notificationManager.fromBackend("Invalid JSON format");
			return false;
		}
	}
	function loadVersion(version: PromptSpec) {
		try {
			prompt.value = parseExistingPrompt({ prompt_spec: version, raw_prompt_template: null });
			state.activeVersionId = version.prompt_id + ".v" + (version.version || 1);
		} catch {
			notificationManager.fromBackend("Failed to load prompt version");
		}
	}
	function needsPublish() {
		if (!prompt.value.name || !prompt.value.name.trim() || prompt.value.name === "New prompt") {
			state.publish = true;
			return true;
		}
		return false;
	}
	async function save() {
		if (!prompt.value.name?.trim()) {
			notificationManager.fromBackend("Please enter a valid prompt name");
			return false;
		}
		state.saving = true;
		try {
			const id = prompt.value.name.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase(),
				body = {
					prompt_id: id,
					litellm_params: { prompt_integration: "dotprompt", prompt_id: id, dotprompt_content: dotprompt.value },
					prompt_info: { prompt_type: "db" },
				};
			if (state.editMode && initial?.prompt_spec.prompt_id) {
				await promptsApi.update(initial.prompt_spec.prompt_id, body);
				notificationManager.success("Prompt updated successfully!");
			} else {
				await promptsApi.create(body);
				notificationManager.success("Prompt created successfully!");
			}
			return true;
		} catch {
			notificationManager.fromBackend(state.editMode ? "Failed to update prompt" : "Failed to save prompt");
			return false;
		} finally {
			state.saving = false;
			state.publish = false;
		}
	}
	return {
		prompt,
		state,
		variables,
		dotprompt,
		addMessage,
		updateMessage,
		removeMessage,
		moveMessage,
		editTool,
		saveTool,
		loadVersion,
		needsPublish,
		save,
	};
}
