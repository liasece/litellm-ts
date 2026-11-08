<script setup lang="ts">
import { ref, watch } from "vue";
import UiDialog from "../../../platform/ui/UiDialog.vue";
import UiButton from "../../../platform/ui/UiButton.vue";
import UiSelect from "../../../platform/ui/UiSelect.vue";
import UiInput from "../../../platform/ui/UiInput.vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
import { fetchModelGroupChoices } from "../../../model-selection/api/ModelSelectionApi";
import { useAuthenticationStore } from "../../../identity/stores/AuthenticationStore";
import type { EvaluationSettings } from "../../support/GuardrailsMonitorModels";
import { defaultEvaluationPrompt, defaultEvaluationSchema } from "../../data/MonitorEvaluationDefaults";
const open = defineModel<boolean>("open", { required: true }),
	props = defineProps<{ guardrailName?: string }>(),
	emit = defineEmits<{ run: [settings: EvaluationSettings] }>(),
	auth = useAuthenticationStore(),
	prompt = ref(defaultEvaluationPrompt),
	schema = ref(defaultEvaluationSchema),
	model = ref<string | null>(null),
	options = ref<{ value: string; label: string }[]>([]),
	loading = ref(false);
watch(
	() => [open.value, auth.isAuthorized.value],
	async (_value, _old, cleanup) => {
		let cancelled = false;
		cleanup(() => (cancelled = true));
		if (!open.value || !auth.isAuthorized.value) {
			options.value = [];
			return;
		}
		loading.value = true;
		try {
			const list = await fetchModelGroupChoices();
			if (!cancelled) options.value = list.map((row) => ({ value: row.model_group, label: row.model_group }));
		} catch {
			if (!cancelled) options.value = [];
		} finally {
			if (!cancelled) loading.value = false;
		}
	},
	{ immediate: true },
);
function select(value: unknown) {
	if (typeof value === "string") model.value = value;
}
function run() {
	if (!model.value) return;
	emit("run", { prompt: prompt.value, schema: schema.value, model: model.value });
	open.value = false;
}
</script>
<template>
	<UiDialog
		v-model:open="open"
		title="Evaluation Settings"
		:width="640"
		:show-footer="false"
		scroll-mode="overlay"
		class="monitor-evaluation-dialog"
		><p>
			{{
				props.guardrailName
					? "Configure AI evaluation for " + props.guardrailName
					: "Configure AI evaluation for re-running on logs"
			}}
		</p>
		<div>
			<section>
				<header>
					<label>Evaluation Prompt</label
					><button type="button" @click="prompt = defaultEvaluationPrompt">Reset to default</button>
				</header>
				<UiInput v-model="prompt" multiline :rows="6" /><small
					>System prompt sent to the evaluation model. Output is structured via response_format.</small
				>
			</section>
			<section>
				<label>Response Schema</label><small>response_format: json_schema</small><UiInput v-model="schema" multiline :rows="6" />
			</section>
			<section>
				<label>Model</label
				><UiSelect
					:model-value="model"
					:options="options"
					:placeholder="loading ? 'Loading models…' : 'Select a model'"
					searchable
					:empty-text="!auth.isAuthorized.value ? 'Sign in to see models' : 'No models available'"
					@update:model-value="select"
				/>
			</section>
		</div>
		<footer>
			<UiButton @click="open = false">Cancel</UiButton
			><UiButton variant="primary" :disabled="!model" @click="run"><UiIcon name="PlayCircleOutlined" />Run Evaluation</UiButton>
		</footer></UiDialog
	>
</template>
