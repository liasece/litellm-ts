<script setup lang="ts">
import { ref } from "vue";
import UiCard from "../../../platform/ui/UiCard.vue";
import UiButton from "../../../platform/ui/UiButton.vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
import { copyGuardrailText } from "../../support/GuardrailClipboardSupport";
import type { GuardrailTestResult, GuardrailTestError } from "../../support/GuardrailTestModels";
import { notificationManager } from "../../../notifications/logic/NotificationManager";
defineProps<{ results: GuardrailTestResult[]; errors: GuardrailTestError[] }>();
const collapsed = ref(new Set<string>());
function toggle(name: string) {
	const next = new Set(collapsed.value);
	if (next.has(name)) next.delete(name);
	else next.add(name);
	collapsed.value = next;
}
async function copy(text: string) {
	if (await copyGuardrailText(text)) notificationManager.success("Result copied to clipboard");
	else notificationManager.fromBackend("Failed to copy result");
}
</script>
<template>
	<div v-if="results.length || errors.length" class="guardrail-test-results">
		<h3>Results</h3>
		<UiCard v-for="result in results" :key="result.guardrailName" class="guardrail-test-success"
			><header>
				<button type="button" @click="toggle(result.guardrailName)">
					<UiIcon :name="collapsed.has(result.guardrailName) ? 'RightOutlined' : 'DownOutlined'" /><UiIcon
						name="CheckCircleOutlined"
					/><strong>{{ result.guardrailName }}</strong>
				</button>
				<div>
					<span><UiIcon name="ClockCircleOutlined" />{{ result.latency }}ms</span
					><UiButton
						v-if="!collapsed.has(result.guardrailName)"
						appearance="tremor"
						variant="default"
						size="small"
						data-guardrail-size="xs"
						@click="copy(result.response_text)"
						><UiIcon name="CopyOutlined" />Copy</UiButton
					>
				</div>
			</header>
			<template v-if="!collapsed.has(result.guardrailName)"
				><div class="guardrail-test-output">
					<label>Output Text</label>
					<div>{{ result.response_text }}</div>
				</div>
				<small><strong>Characters:</strong> {{ result.response_text.length }}</small></template
			></UiCard
		><UiCard v-for="failure in errors" :key="failure.guardrailName" class="guardrail-test-error"
			><div>
				<button type="button" aria-label="Toggle error details" @click="toggle(failure.guardrailName)">
					<UiIcon :name="collapsed.has(failure.guardrailName) ? 'RightOutlined' : 'DownOutlined'" /></button
				><UiIcon name="CloseCircleFilled" :size="20" />
				<div>
					<header>
						<button type="button" @click="toggle(failure.guardrailName)">{{ failure.guardrailName }} - Error</button
						><span><UiIcon name="ClockCircleOutlined" />{{ failure.latency }}ms</span>
					</header>
					<p v-if="!collapsed.has(failure.guardrailName)">{{ failure.error.message }}</p>
				</div>
			</div></UiCard
		>
	</div>
</template>
