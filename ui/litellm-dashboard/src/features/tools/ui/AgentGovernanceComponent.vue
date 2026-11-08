<script setup lang="ts">
import { onMounted, ref } from "vue";
import UiSwitch from "../../platform/ui/UiSwitch.vue";
import AccessFieldComponent from "../../access-control/ui/AccessFieldComponent.vue";
import { agentsApi } from "../api/AgentsApi";
import type { AgentFlowOptions } from "../support/AgentModels";
const options = defineModel<AgentFlowOptions>({ required: true });
const draft = defineModel<Record<string, unknown>>("draft", { required: true });
const guardrails = ref<string[]>([]);
function outbound(value: boolean) {
	options.value.requireOutbound = value;
	if (!value) {
		options.value.maxIterations = null;
		options.value.maxBudget = null;
	}
}
onMounted(() => {
	void agentsApi.guardrails().then((value) => {
		guardrails.value = value;
	});
});
</script>
<template>
	<section class="tools-agent-governance">
		<div>
			<h4>Tracing</h4>
			<div class="tools-agent-trace-row">
				<div>
					<strong>Require x-litellm-trace-id on calls TO this agent</strong>
					<p>Only accept this agent being invoked with a trace-id (e.g. when used as a sub-agent).</p>
				</div>
				<UiSwitch v-model="options.requireInbound" />
			</div>
			<div class="tools-agent-trace-row">
				<div>
					<strong>Require x-litellm-trace-id on calls BY this agent</strong>
					<p>Requires LLM/MCP calls made by this agent to include x-litellm-trace-id for session tracking.</p>
				</div>
				<UiSwitch :model-value="options.requireOutbound" @update:model-value="outbound" />
			</div>
		</div>
		<hr />
		<div>
			<h4>Budgets &amp; Rate Limits</h4>
			<aside v-if="!options.requireOutbound">
				Enable &quot;Require x-litellm-trace-id on calls BY this agent&quot; in Tracing to configure budgets and rate limits.
			</aside>
			<h4>Session Budgets</h4>
			<div class="tools-agent-rate-grid">
				<AccessFieldComponent
					v-model="options.maxIterations"
					label="Max Iterations"
					type="number"
					:min="1"
					placeholder="e.g. 25"
					:disabled="!options.requireOutbound"
					help="Hard cap on LLM calls per session"
				/><AccessFieldComponent
					v-model="options.maxBudget"
					label="Max Budget Per Session ($)"
					type="number"
					:min="0.01"
					:step="0.5"
					placeholder="e.g. 5.00"
					:disabled="!options.requireOutbound"
					help="Max spend per trace before returning 429"
				/>
			</div>
			<hr />
			<h4>Agent Rate Limits</h4>
			<p>Global rate limits applied across all callers of this agent.</p>
			<div class="tools-agent-rate-grid">
				<AccessFieldComponent
					class="tools-agent-antd-field"
					v-model="draft.tpm_limit"
					label="TPM Limit"
					type="number"
					:min="0"
					placeholder="e.g. 100000"
					:disabled="!options.requireOutbound"
				/><AccessFieldComponent
					class="tools-agent-antd-field"
					v-model="draft.rpm_limit"
					label="RPM Limit"
					type="number"
					:min="0"
					placeholder="e.g. 100"
					:disabled="!options.requireOutbound"
				/>
			</div>
			<h4>Per-Session Rate Limits</h4>
			<p>Rate limits per session (x-litellm-trace-id). Each session gets its own counters.</p>
			<div class="tools-agent-rate-grid">
				<AccessFieldComponent
					class="tools-agent-antd-field"
					v-model="draft.session_tpm_limit"
					label="Session TPM Limit"
					type="number"
					:min="0"
					placeholder="e.g. 10000"
					:disabled="!options.requireOutbound"
				/><AccessFieldComponent
					class="tools-agent-antd-field"
					v-model="draft.session_rpm_limit"
					label="Session RPM Limit"
					type="number"
					:min="0"
					placeholder="e.g. 20"
					:disabled="!options.requireOutbound"
				/>
			</div>
		</div>
		<hr />
		<div>
			<h4>Guardrails</h4>
			<p>Apply guardrails to this agent. Selected guardrails will run on all calls made by this agent.</p>
			<AccessFieldComponent
				v-model="draft.guardrails"
				name="agent-guardrails"
				type="select"
				multiple
				:options="guardrails.map((value) => ({ value, label: value }))"
			/>
		</div>
	</section>
</template>
