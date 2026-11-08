import { computed, reactive, shallowRef } from "vue";
import { promptsApi } from "../api/PromptsApi";
import { notificationManager } from "../../notifications/logic/NotificationManager";
export function createPromptUploadStore(authorized: () => boolean, api = promptsApi) {
	const state = reactive({ id: "", integration: "dotprompt", loading: false, attempted: false }),
		file = shallowRef<File | null>(null),
		error = computed(() =>
			!state.attempted
				? ""
				: !state.id
					? "Please enter a prompt ID"
					: !/^[a-zA-Z0-9_-]+$/.test(state.id)
						? "Prompt ID can only contain letters, numbers, underscores, and hyphens"
						: "",
		);
	function choose(value: File) {
		file.value = value;
		if (!value.name.endsWith(".prompt")) notificationManager.fromBackend("Please upload a .prompt file");
	}
	function reset() {
		state.id = "";
		state.integration = "dotprompt";
		state.attempted = false;
		file.value = null;
	}
	async function save() {
		state.attempted = true;
		if (error.value) return false;
		if (!authorized()) {
			notificationManager.fromBackend("Access token is required");
			return false;
		}
		if (!file.value) {
			notificationManager.fromBackend("Please upload a .prompt file");
			return false;
		}
		state.loading = true;
		try {
			let converted;
			try {
				converted = await api.convert(file.value);
			} catch {
				notificationManager.fromBackend("Failed to convert prompt file to JSON");
				return false;
			}
			try {
				await api.create({
					prompt_id: state.id,
					litellm_params: { prompt_integration: "dotprompt", prompt_id: converted.prompt_id, prompt_data: converted.json_data },
					prompt_info: { prompt_type: "db" },
				});
				notificationManager.success("Prompt created successfully!");
				reset();
				return true;
			} catch {
				notificationManager.fromBackend("Failed to create prompt");
				return false;
			}
		} finally {
			state.loading = false;
		}
	}
	return { state, file, error, choose, reset, save };
}
