<script setup lang="ts">
import { ref } from "vue";
import UiInput from "../../../platform/ui/UiInput.vue";
import UiButton from "../../../platform/ui/UiButton.vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
import UiTooltip from "../../../platform/ui/UiTooltip.vue";
import GuardrailTestResultsComponent from "./GuardrailTestResultsComponent.vue";
import type { GuardrailTestResult, GuardrailTestError } from "../../support/GuardrailTestModels";
import { notificationManager } from "../../../notifications/logic/NotificationManager";
import { copyGuardrailText } from "../../support/GuardrailClipboardSupport";
defineProps<{ names: string[]; pending: boolean; results: GuardrailTestResult[]; errors: GuardrailTestError[] }>();
const emit = defineEmits<{ submit: [text: string] }>(),
	input = ref("");
function submit() {
	if (!input.value.trim()) {
		notificationManager.fromBackend("Please enter text to test");
		return;
	}
	emit("submit", input.value);
}
function keydown(event: KeyboardEvent) {
	if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
		event.preventDefault();
		submit();
	}
}
async function copy() {
	if (await copyGuardrailText(input.value)) notificationManager.success("Input copied to clipboard");
	else notificationManager.fromBackend("Failed to copy input");
}
</script>
<template>
	<div class="guardrail-test-panel">
		<header>
			<div>
				<h2>Test Guardrails:</h2>
				<div>
					<span v-for="name in names" :key="name">{{ name }}</span>
				</div>
			</div>
			<p>Test {{ names.length > 1 ? "guardrails" : "guardrail" }} and compare results</p>
		</header>
		<div class="guardrail-test-panel-scroll">
			<div class="guardrail-test-input">
				<header>
					<label
						>Input Text
						<UiTooltip title="Press Enter to submit. Use Shift+Enter for new line."
							><UiIcon name="InfoCircleOutlined" /></UiTooltip></label
					><UiButton v-if="input" appearance="tremor" variant="default" size="small" data-guardrail-size="xs" @click="copy"
						><UiIcon name="CopyOutlined" />Copy Input</UiButton
					>
				</header>
				<UiInput v-model="input" multiline :rows="8" placeholder="Enter text to test with guardrails..." @keydown="keydown" />
				<footer>
					<span>Press <kbd>Enter</kbd> to submit • <kbd>Shift+Enter</kbd> for new line</span
					><span>Characters: {{ input.length }}</span>
				</footer>
				<UiButton appearance="tremor" variant="primary" :loading="pending" :disabled="!input.trim()" @click="submit"
					>{{ pending ? "Testing" : "Test" }} {{ names.length }} guardrail{{ names.length > 1 ? "s" : ""
					}}{{ pending ? "..." : "" }}</UiButton
				>
			</div>
			<GuardrailTestResultsComponent :results="results" :errors="errors" />
		</div>
	</div>
</template>
