<script setup lang="ts">
import type { GuardrailPipeline, PipelineStep } from "../../support/PolicyModels";
import type { GuardrailRecord } from "../../../guardrails/support/GuardrailModels";
import { createPipelineStep } from "../../logic/PolicyLogic";
import { actionLabels } from "../../logic/PipelineTestLogic";
import PolicyFlowStepComponent from "./PolicyFlowStepComponent.vue";
import PolicyFlowConnectorComponent from "./PolicyFlowConnectorComponent.vue";
import PolicyFlowIconComponent from "./PolicyFlowIconComponent.vue";
const props = withDefaults(defineProps<{ modelValue: GuardrailPipeline; guardrails?: GuardrailRecord[]; readonly?: boolean }>(), {
		guardrails: () => [],
	}),
	emit = defineEmits<{ "update:modelValue": [value: GuardrailPipeline] }>();
function insert(index: number) {
	const steps = [...props.modelValue.steps];
	steps.splice(index, 0, createPipelineStep());
	emit("update:modelValue", { ...props.modelValue, steps });
}
function remove(index: number) {
	if (props.modelValue.steps.length > 1)
		emit("update:modelValue", { ...props.modelValue, steps: props.modelValue.steps.filter((_, i) => i !== index) });
}
function update(index: number, value: Partial<PipelineStep>) {
	emit("update:modelValue", { ...props.modelValue, steps: props.modelValue.steps.map((s, i) => (i === index ? { ...s, ...value } : s)) });
}
</script>
<template>
	<div class="policy-flow-canvas" :class="{ 'policy-flow-canvas--readonly': readonly }">
		<div class="policy-flow-trigger">
			<PolicyFlowIconComponent type="play" />
			<div>
				<strong>TRIGGER</strong><b>Incoming LLM Request</b
				><span v-if="!readonly">This flow runs when a request matches this policy</span>
			</div>
		</div>
		<template v-for="(step, index) in modelValue.steps" :key="index"
			><div v-if="readonly" class="policy-flow-static-connector" />
			<PolicyFlowConnectorComponent v-else @insert="insert(index)" />
			<article v-if="readonly" class="policy-flow-readonly-step">
				<header>
					<span><PolicyFlowIconComponent type="guardrail" /><strong>GUARDRAIL</strong></span
					><span>Step {{ index + 1 }}</span>
				</header>
				<h4>{{ step.guardrail }}</h4>
				<div>
					<span><PolicyFlowIconComponent type="pass" />Pass → {{ actionLabels[step.on_pass] || step.on_pass }}</span
					><span><PolicyFlowIconComponent type="fail" />Fail → {{ actionLabels[step.on_fail] || step.on_fail }}</span>
				</div>
			</article>
			<PolicyFlowStepComponent
				v-else
				:step="step"
				:index="index"
				:total="modelValue.steps.length"
				:guardrails="guardrails"
				@change="update(index, $event)"
				@delete="remove(index)"
		/></template>
		<template v-if="!readonly"
			><PolicyFlowConnectorComponent @insert="insert(modelValue.steps.length)" />
			<div class="policy-flow-end">
				<PolicyFlowIconComponent type="end" />
				<div><strong>END</strong><b>Continue to LLM</b><span>Request proceeds to the model</span></div>
			</div></template
		>
	</div>
</template>
