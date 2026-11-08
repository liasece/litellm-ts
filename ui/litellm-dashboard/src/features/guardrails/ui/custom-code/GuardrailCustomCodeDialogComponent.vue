<script setup lang="ts">
import { computed, watch, nextTick } from "vue";
import UiDialog from "../../../platform/ui/UiDialog.vue";
import UiInput from "../../../platform/ui/UiInput.vue";
import UiSelect from "../../../platform/ui/UiSelect.vue";
import UiSwitch from "../../../platform/ui/UiSwitch.vue";
import UiButton from "../../../platform/ui/UiButton.vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
import { useAuthenticationStore } from "../../../identity/stores/AuthenticationStore";
import { createGuardrailCustomCodeStore } from "../../stores/GuardrailCustomCodeStore";
import { CODE_TEMPLATES, MODE_OPTIONS } from "../../data/GuardrailCustomCodeData";
import type { GuardrailRecord } from "../../support/GuardrailModels";
import GuardrailCodeTestComponent from "./GuardrailCodeTestComponent.vue";
import GuardrailPrimitivesComponent from "./GuardrailPrimitivesComponent.vue";
import "../../styles/GuardrailCustomCodeStyles.css";
const open = defineModel<boolean>("open", { required: true }),
	props = defineProps<{ editData?: GuardrailRecord | null }>(),
	emit = defineEmits<{ saved: [] }>(),
	auth = useAuthenticationStore(),
	store = createGuardrailCustomCodeStore(() => auth.isAuthorized.value),
	{ state } = store,
	lineCount = computed(() => Math.max(state.code.split("\n").length, 20));
watch(
	() => [open.value, props.editData],
	() => {
		if (open.value) store.initialize(props.editData);
	},
	{ immediate: true },
);
function chooseTemplate(value: unknown) {
	if (typeof value === "string") store.template(value);
}
function modes(value: unknown) {
	state.mode = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
async function save() {
	if (await store.save(props.editData)) {
		emit("saved");
		open.value = false;
	}
}
async function keydown(event: KeyboardEvent) {
	if (event.key !== "Tab") return;
	event.preventDefault();
	const element = event.currentTarget as HTMLTextAreaElement,
		start = element.selectionStart,
		end = element.selectionEnd;
	state.code = state.code.substring(0, start) + "    " + state.code.substring(end);
	await nextTick();
	element.selectionStart = element.selectionEnd = start + 4;
}
</script>
<template>
	<UiDialog v-model:open="open" :width="1400" :show-footer="false" scroll-mode="overlay" class="guardrail-custom-code-dialog"
		><div class="guardrail-custom-code">
			<header>
				<h2>{{ editData ? "Edit" : "Create" }} Custom Guardrail</h2>
				<p>Define custom logic using Python-like syntax</p>
			</header>
			<div class="guardrail-code-controls">
				<label class="guardrail-code-name"
					>Guardrail Name<UiInput v-model="state.name" appearance="tremor" placeholder="e.g., block-pii-custom" /></label
				><label class="guardrail-code-mode"
					>Mode (can select multiple)<UiSelect
						:model-value="state.mode"
						:options="MODE_OPTIONS"
						multiple
						placeholder="Select modes"
						@update:model-value="modes" /></label
				><label class="guardrail-code-template"
					>Template<UiSelect
						:model-value="state.template"
						:options="
							Object.entries(CODE_TEMPLATES).map(([value, template]) => ({ value, label: template.name, group: 'STANDARD' }))
						"
						@update:model-value="chooseTemplate"
						><template #footer
							><a
								class="guardrail-community-template"
								href="https://models.litellm.ai/guardrails"
								target="_blank"
								rel="noopener noreferrer"
								><UiIcon name="UsergroupAddOutlined" />Browse Community templates<UiIcon
									name="ExportOutlined"
									:size="10" /></a></template></UiSelect></label
				><label class="guardrail-code-default">Default On<UiSwitch v-model="state.defaultOn" /></label>
			</div>
			<div class="guardrail-code-main">
				<div class="guardrail-code-main-left">
					<div class="guardrail-code-caption"><strong>Python Logic</strong><span>Restricted environment (no imports)</span></div>
					<div class="guardrail-code-editor">
						<div class="guardrail-code-lines">
							<div v-for="line in lineCount" :key="line">{{ line }}</div>
						</div>
						<textarea v-model="state.code" spellcheck="false" aria-label="Python Logic" @keydown="keydown" />
					</div>
					<GuardrailCodeTestComponent
						v-model:expanded="state.testExpanded"
						v-model:input="state.testInput"
						:testing="state.testing"
						:result="state.testResult"
						@test="store.test"
					/>
					<div class="guardrail-code-contribution">
						<div>
							<span><UiIcon name="UsergroupAddOutlined" :size="18" /></span>
							<div>
								<strong>Built a useful guardrail?</strong
								><small>Share it with the community and help others build faster</small>
							</div>
						</div>
						<a href="https://github.com/BerriAI/litellm-guardrails" target="_blank" rel="noopener noreferrer"
							><UiButton appearance="tremor" variant="primary" size="small" data-guardrail-size="xs"
								><template #icon><UiIcon name="ExportOutlined" /></template>Contribute Template</UiButton
							></a
						>
					</div>
				</div>
				<GuardrailPrimitivesComponent />
			</div>
			<footer>
				<span>Changes are auto-saved to local draft</span>
				<div>
					<UiButton appearance="tremor" variant="default" @click="open = false">Cancel</UiButton
					><UiButton
						appearance="tremor"
						variant="primary"
						:loading="state.saving"
						:disabled="state.saving || !state.name.trim()"
						@click="save"
						><template #icon><UiIcon name="SaveOutlined" /></template>{{ editData ? "Update" : "Save" }} Guardrail</UiButton
					>
				</div>
			</footer>
		</div></UiDialog
	>
</template>
