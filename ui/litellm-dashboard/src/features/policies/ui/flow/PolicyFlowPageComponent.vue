<script setup lang="ts">
import { onBeforeUnmount, watch } from "vue";
import { createPolicyFlowStore } from "../../stores/PolicyFlowStore";
import type { Policy } from "../../support/PolicyModels";
import type { GuardrailRecord } from "../../../guardrails/support/GuardrailModels";
import PolicyHeroIconComponent from "../common/PolicyHeroIconComponent.vue";
import PolicyFlowCanvasComponent from "./PolicyFlowCanvasComponent.vue";
import PolicyVersionsComponent from "./PolicyVersionsComponent.vue";
import PolicyPipelineTestComponent from "./PolicyPipelineTestComponent.vue";
import UiButton from "../../../platform/ui/UiButton.vue";
import UiInput from "../../../platform/ui/UiInput.vue";
const props = defineProps<{ editing: Partial<Policy> | null; guardrails: GuardrailRecord[] }>(),
	emit = defineEmits<{ back: []; saved: []; selected: [policy: Policy] }>();
const store = createPolicyFlowStore({
		selected: (policy) => emit("selected", policy),
		saved: () => emit("saved"),
		back: () => emit("back"),
	}),
	state = store.state;
watch(
	() => props.editing,
	(value) => store.sync(value),
	{ immediate: true },
);
onBeforeUnmount(store.dispose);
</script>
<template>
	<div class="policy-flow">
		<header>
			<div>
				<button type="button" aria-label="Back to Policies" @click="emit('back')">
					<PolicyHeroIconComponent name="ArrowLeft" :size="18" /></button
				><span>Policies</span><span class="policy-flow-slash">/</span
				><UiInput
					v-model="state.name"
					appearance="tremor"
					placeholder="Policy name..."
					:disabled="!!editing?.policy_id"
					style="width: 240px"
				/><b>Flow</b>
			</div>
			<div>
				<UiButton appearance="tremor" variant="default" @click="emit('back')">Cancel</UiButton
				><UiButton appearance="tremor" variant="default" @click="state.showTest = !state.showTest">{{
					state.showTest ? "Hide Test" : "Test Pipeline"
				}}</UiButton
				><UiButton variant="primary" appearance="tremor" :loading="state.saving" @click="store.save">{{
					editing?.policy_id ? "Update Policy" : "Save Policy"
				}}</UiButton>
			</div>
		</header>
		<div class="policy-flow-description">
			<UiInput
				v-model="state.description"
				appearance="tremor"
				placeholder="Add a description (optional)..."
				style="max-width: 500px"
			/>
		</div>
		<div class="policy-flow-body">
			<PolicyVersionsComponent
				v-if="editing?.policy_name"
				:versions="state.versions"
				:selected-id="editing.policy_id"
				:status="editing.version_status"
				:loading="state.versionsLoading"
				:creating="state.creatingVersion"
				:updating="state.updatingStatus"
				@create="store.newVersion"
				@select="emit('selected', $event)"
				@publish="store.setStatus('published')"
				@promote="store.setStatus('production')"
			/>
			<main>
				<div><PolicyFlowCanvasComponent v-model="state.pipeline" :guardrails="guardrails" /></div>
			</main>
			<PolicyPipelineTestComponent v-if="state.showTest" :pipeline="state.pipeline" @close="state.showTest = false" />
		</div>
	</div>
</template>
