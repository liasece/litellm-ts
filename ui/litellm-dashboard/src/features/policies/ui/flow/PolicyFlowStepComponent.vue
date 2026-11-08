<script setup lang="ts">
import type { PipelineStep, PipelineAction } from "../../support/PolicyModels";
import type { GuardrailRecord } from "../../../guardrails/support/GuardrailModels";
import { actionOptions } from "../../logic/PipelineTestLogic";
import PolicySelectComponent from "../common/PolicySelectComponent.vue";
import PolicyFlowIconComponent from "./PolicyFlowIconComponent.vue";
import PolicyHeroIconComponent from "../common/PolicyHeroIconComponent.vue";
import UiInput from "../../../platform/ui/UiInput.vue";
defineProps<{ step: PipelineStep; index: number; total: number; guardrails: GuardrailRecord[] }>();
const emit = defineEmits<{ change: [value: Partial<PipelineStep>]; delete: [] }>();
function action(key: "on_pass" | "on_fail", value: string) {
	if (["next", "allow", "block", "modify_response"].includes(value)) emit("change", { [key]: value as PipelineAction });
}
</script>
<template>
	<article class="policy-flow-step">
		<header>
			<span><PolicyFlowIconComponent type="guardrail" /><strong>GUARDRAIL</strong></span
			><span
				>Step {{ index + 1
				}}<button type="button" title="Delete step" :disabled="total <= 1" @click="emit('delete')">
					<PolicyHeroIconComponent name="DotsVertical" :size="16" /></button
			></span>
		</header>
		<div class="policy-flow-step-select">
			<label>Guardrail</label
			><PolicySelectComponent
				:model-value="step.guardrail"
				:options="
					guardrails.map((g) => ({
						value: g.guardrail_name || g.guardrail_id || '',
						label: g.guardrail_name || g.guardrail_id || '',
					}))
				"
				searchable
				placeholder="Select a guardrail"
				@update:model-value="emit('change', { guardrail: $event })"
			/>
		</div>
		<section v-for="key in ['on_pass', 'on_fail'] as const" :key="key">
			<h4><PolicyFlowIconComponent :type="key === 'on_pass' ? 'pass' : 'fail'" />{{ key === "on_pass" ? "ON PASS" : "ON FAIL" }}</h4>
			<label>Action</label
			><PolicySelectComponent :model-value="step[key]" :options="actionOptions" @update:model-value="action(key, $event)" />
			<div v-if="step[key] === 'modify_response'" class="policy-flow-message">
				<label>Custom Response Message</label
				><UiInput
					:model-value="step.modify_response_message || ''"
					appearance="tremor"
					placeholder="Enter custom response..."
					@update:model-value="emit('change', { modify_response_message: String($event || '') || null })"
				/>
			</div>
		</section>
	</article>
</template>
