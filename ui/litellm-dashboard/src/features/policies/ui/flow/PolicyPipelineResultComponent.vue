<script setup lang="ts">
import type { PipelineTestResult } from "../../support/PolicyModels";
import { actionLabels, outcomeStyles, terminalStyles } from "../../logic/PipelineTestLogic";
defineProps<{ result: PipelineTestResult }>();
</script>
<template>
	<div>
		<div v-for="(step, index) in result.step_results" :key="index" class="policy-pipeline-step-result">
			<header>
				<strong>Step {{ index + 1 }}: {{ step.guardrail_name }}</strong
				><span :style="outcomeStyles[step.outcome] || outcomeStyles.error">{{ step.outcome.toUpperCase() }}</span>
			</header>
			<p>
				Action: {{ actionLabels[step.action_taken] || step.action_taken
				}}<span v-if="step.duration_seconds != null" class="policy-pipeline-duration"
					>({{ (step.duration_seconds * 1000).toFixed(0) }}ms)</span
				>
			</p>
			<p v-if="step.error_detail" class="policy-error-text">{{ step.error_detail }}</p>
		</div>
		<div class="policy-pipeline-terminal">
			<header>
				<strong>Result</strong
				><span :style="terminalStyles[result.terminal_action] || terminalStyles.block">{{
					result.terminal_action === "modify_response" ? "Custom Response" : result.terminal_action
				}}</span>
			</header>
			<p v-if="result.error_message" class="policy-error-text">{{ result.error_message }}</p>
			<p v-if="result.modify_response_message" class="policy-info-text">Response: {{ result.modify_response_message }}</p>
		</div>
	</div>
</template>
