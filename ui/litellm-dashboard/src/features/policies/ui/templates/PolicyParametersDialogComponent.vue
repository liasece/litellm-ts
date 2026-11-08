<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from "vue";
import type { PolicyTemplate } from "../../support/PolicyModels";
import { createPolicyParameterStore } from "../../stores/PolicyParameterStore";
import PolicySelectComponent from "../common/PolicySelectComponent.vue";
import PolicyTagInputComponent from "../common/PolicyTagInputComponent.vue";
import PolicyRadioComponent from "../common/PolicyRadioComponent.vue";
import UiDialog from "../../../platform/ui/UiDialog.vue";
import UiInput from "../../../platform/ui/UiInput.vue";
import UiButton from "../../../platform/ui/UiButton.vue";
import UiSpinner from "../../../platform/ui/UiSpinner.vue";
const props = defineProps<{ open: boolean; template: PolicyTemplate | null; loading: boolean }>(),
	emit = defineEmits<{ close: []; confirm: [parameters: Record<string, string>, options: { competitors: string[] }] }>();
const store = createPolicyParameterStore(() => props.template),
	state = store.state,
	variationCount = computed(() => Object.values(state.variations).flat().length);
watch(
	[() => props.open, () => props.template],
	([open]) => {
		if (open) store.initialize();
		else store.dispose();
	},
	{ immediate: true },
);
onBeforeUnmount(store.dispose);
</script>
<template>
	<UiDialog :open="open" :width="700" scroll-mode="overlay" class="policy-parameters-dialog" @update:open="!$event && emit('close')"
		><template #title
			><h3>{{ template?.title }}</h3>
			<p>Configure competitor blocking for your brand</p></template
		>
		<div class="policy-parameter-fields">
			<div v-for="(parameter, index) in store.nonEnrichment.value" :key="parameter.name + '-' + index">
				<label>{{ parameter.label }}<em v-if="parameter.required">*</em></label
				><UiInput v-model="state.values[parameter.name]" appearance="tremor" :placeholder="parameter.placeholder || ''" />
			</div>
			<template v-if="store.hasEnrichment.value"
				><div>
					<label>Competitor Discovery</label>
					<div class="policy-competitor-modes">
						<PolicyRadioComponent v-model="state.mode" value="ai" button>✨ Use AI</PolicyRadioComponent
						><PolicyRadioComponent v-model="state.mode" value="manual" button>Enter Manually</PolicyRadioComponent>
					</div>
				</div>
				<div>
					<label>Your Brand Name<em>*</em></label
					><UiInput v-model="state.values[store.enrichmentKey.value]" appearance="tremor" placeholder="e.g. Acme Airlines" />
				</div>
				<template v-if="state.mode === 'ai'"
					><div>
						<label>Select Model<em>*</em></label
						><PolicySelectComponent
							v-model="state.model"
							:options="state.models.map((value) => ({ value, label: value }))"
							:loading="state.modelsLoading"
							searchable
							placeholder="Select a model to generate names"
						/>
					</div>
					<UiButton
						variant="primary"
						appearance="tremor"
						class="policy-full-width"
						:loading="state.generating"
						:disabled="!state.model || !store.brandFilled.value || state.generating"
						@click="store.generate()"
						>{{ state.generating ? "✨ Generating names..." : "✨ Generate Competitor Names" }}</UiButton
					></template
				>
				<div>
					<label
						>Competitor Names
						<span v-if="state.competitors.length" class="policy-muted">({{ state.competitors.length }})</span></label
					><PolicyTagInputComponent v-model="state.competitors" placeholder="Type a name and press Enter to add" />
					<p class="policy-field-extra">Type a name and press Enter to add. Click ✕ to remove.</p>
					<div v-if="state.status" class="policy-enrichment-status"><UiSpinner :size="14" />{{ state.status }}</div>
					<p v-if="variationCount && !state.status" class="policy-enrichment-success">
						✓ {{ variationCount }} alternate spellings &amp; variations auto-generated for guardrail matching
					</p>
				</div>
				<div v-if="state.mode === 'ai' && state.generated && state.competitors.length">
					<label>Refine List</label>
					<div class="policy-inline-actions">
						<UiInput
							v-model="state.refinement"
							appearance="tremor"
							placeholder="e.g. add 10 more from Asia, increase to 50 total..."
							:disabled="state.refining"
							@keydown.enter.prevent="!state.refining && store.generate(true)"
						/><UiButton
							variant="primary"
							appearance="tremor"
							size="small"
							:loading="state.refining"
							:disabled="!state.refinement.trim() || state.refining"
							@click="store.generate(true)"
							>{{ state.refining ? "..." : "Send" }}</UiButton
						>
					</div>
					<p class="policy-field-extra policy-muted">
						Give instructions to add, remove, or change competitors. Press Enter to send.
					</p>
				</div>
			</template>
			<!-- The original parameter modal renders its non-enriched fields in both sections. -->
			<template v-else
				><div v-for="(parameter, index) in store.parameters.value" :key="'plain-' + index">
					<label>{{ parameter.label }}<em v-if="parameter.required">*</em></label
					><UiInput v-model="state.values[parameter.name]" appearance="tremor" :placeholder="parameter.placeholder || ''" /></div
			></template>
		</div>
		<template #footer
			><UiButton appearance="tremor" variant="default" :disabled="loading" @click="emit('close')">Cancel</UiButton
			><UiButton
				variant="primary"
				appearance="tremor"
				:loading="loading"
				:disabled="!store.ready.value || loading"
				@click="emit('confirm', { ...state.values }, { competitors: [...state.competitors] })"
				>{{ loading ? "Creating guardrails..." : "Continue" }}</UiButton
			></template
		>
	</UiDialog>
</template>
