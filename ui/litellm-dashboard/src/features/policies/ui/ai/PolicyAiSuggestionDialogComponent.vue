<script setup lang="ts">
import { onBeforeUnmount, watch } from "vue";
import type { PolicyTemplate } from "../../support/PolicyModels";
import { createPolicyAiSuggestionStore } from "../../stores/PolicyAiSuggestionStore";
import PolicyAiInputComponent from "./PolicyAiInputComponent.vue";
import PolicyAiSuggestionsComponent from "./PolicyAiSuggestionsComponent.vue";
import PolicyAiTestPanelComponent from "./PolicyAiTestPanelComponent.vue";
import UiDialog from "../../../platform/ui/UiDialog.vue";
import UiButton from "../../../platform/ui/UiButton.vue";
const props = defineProps<{ open: boolean; templates: PolicyTemplate[] }>(),
	emit = defineEmits<{ close: []; select: [templates: PolicyTemplate[]] }>();
const store = createPolicyAiSuggestionStore(() => props.templates),
	state = store.state;
watch(
	() => props.open,
	(open) => {
		if (open && !state.models.length) void store.models();
	},
	{ immediate: true },
);
onBeforeUnmount(store.dispose);
function close() {
	store.reset();
	emit("close");
}
function select() {
	const templates = store.useSelected();
	store.reset();
	emit("select", templates);
}
</script>
<template>
	<UiDialog
		:open="open"
		:width="state.showTest ? 1200 : 820"
		:show-footer="false"
		scroll-mode="overlay"
		class="policy-ai-dialog"
		aria-label="AI Policy Suggestion"
		@update:open="!$event && close()"
	>
		<header class="policy-ai-header">
			<h3>AI Policy Suggestion</h3>
			<p>
				{{
					state.suggestions !== null && !state.loading
						? state.suggestions.length +
							" template" +
							(state.suggestions.length !== 1 ? "s" : "") +
							" matched your requirements"
						: "Describe what you want to block and we'll suggest the best policy templates"
				}}
			</p>
		</header>
		<PolicyAiInputComponent v-if="state.suggestions === null || state.loading" :store="store" @close="close" />
		<div v-else class="policy-ai-results">
			<div :class="state.showTest && state.selected.size ? 'policy-ai-split' : 'policy-ai-single'">
				<PolicyAiSuggestionsComponent :store="store" :templates="templates" />
				<div v-if="state.showTest && state.selected.size" class="policy-ai-test-scroll">
					<PolicyAiTestPanelComponent :store="store" />
				</div>
			</div>
			<footer>
				<UiButton appearance="tremor" variant="default" @click="store.back">Back</UiButton
				><UiButton
					v-if="state.suggestions.length && state.selected.size && !state.showTest"
					appearance="tremor"
					variant="default"
					@click="state.showTest = true"
					>Test Suggestions</UiButton
				><UiButton variant="primary" appearance="tremor" :disabled="!state.selected.size || state.enriching" @click="select"
					>Use {{ state.selected.size }} Selected Template{{ state.selected.size !== 1 ? "s" : "" }}</UiButton
				>
			</footer>
		</div>
	</UiDialog>
</template>
