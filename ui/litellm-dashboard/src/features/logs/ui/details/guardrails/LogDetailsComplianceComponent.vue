<script setup lang="ts">
import { onBeforeUnmount, reactive, watch } from "vue";
import { checkLogCompliance, type ComplianceResult } from "../../../api/LogDetailsComplianceApi";
import type { LogEntry } from "../../../support/LogsModels";
import LogDetailsGuardrailIconComponent from "./LogDetailsGuardrailIconComponent.vue";
const props = defineProps<{ log: LogEntry }>();
const regulations = [
	{ key: "eu-ai-act", label: "EU AI Act" },
	{ key: "gdpr", label: "GDPR" },
] as const;
const state = reactive<Record<string, { loading: boolean; error: string | null; data: ComplianceResult | null; expanded: boolean }>>({});
for (const regulation of regulations) state[regulation.key] = { loading: false, error: null, data: null, expanded: false };
let controller: AbortController | undefined,
	generation = 0;
watch(
	[
		() => props.log.request_id,
		() => props.log.user,
		() => props.log.model,
		() => props.log.startTime,
		() => props.log.metadata?.guardrail_information,
	],
	() => {
		controller?.abort();
		controller = new AbortController();
		const signal = controller.signal,
			epoch = ++generation;
		for (const regulation of regulations) {
			const target = state[regulation.key];
			target.loading = true;
			target.error = null;
			target.data = null;
			void checkLogCompliance(regulation.key, props.log, signal)
				.then((data) => {
					if (epoch === generation) target.data = data;
				})
				.catch((error: unknown) => {
					if (epoch === generation && !signal.aborted)
						target.error = error instanceof Error ? error.message : "Failed to check " + regulation.label + " compliance";
				})
				.finally(() => {
					if (epoch === generation) target.loading = false;
				});
		}
	},
	{ immediate: true },
);
onBeforeUnmount(() => {
	generation++;
	controller?.abort();
});
</script>
<template>
	<div class="ld-compliance">
		<h4>Regulatory Compliance</h4>
		<section v-for="regulation in regulations" :key="regulation.key" class="ld-compliance__card">
			<button
				type="button"
				:aria-expanded="state[regulation.key].expanded"
				@click="state[regulation.key].expanded = !state[regulation.key].expanded"
			>
				<span class="ld-inline"
					><svg v-if="state[regulation.key].loading" class="ld-spin" width="16" height="16" viewBox="0 0 16 16" fill="none">
						<circle cx="8" cy="8" r="6" stroke="#D1D5DB" stroke-width="2" />
						<path d="M8 2a6 6 0 0 1 6 6" stroke="#6366F1" stroke-width="2" stroke-linecap="round" /></svg
					><span v-else-if="state[regulation.key].error" :title="state[regulation.key].error || ''">--</span
					><LogDetailsGuardrailIconComponent
						v-else
						:name="state[regulation.key].data?.compliant ? 'check' : 'fail'"
						:size="16"
					/>{{ regulation.label }}</span
				><span class="ld-inline"
					><span
						v-if="!state[regulation.key].loading && state[regulation.key].data"
						class="ld-chip"
						:class="state[regulation.key].data?.compliant ? 'ld-chip--green' : 'ld-chip--red'"
						>{{ state[regulation.key].data?.compliant ? "COMPLIANT" : "NON-COMPLIANT" }}</span
					><span v-if="state[regulation.key].error" class="ld-chip">UNAVAILABLE</span
					><LogDetailsGuardrailIconComponent name="chevron" :expanded="state[regulation.key].expanded"
				/></span>
			</button>
			<div v-if="state[regulation.key].expanded" class="ld-compliance__body">
				<p v-if="state[regulation.key].loading" class="ld-secondary">Checking compliance...</p>
				<p v-if="state[regulation.key].error" class="ld-danger">{{ state[regulation.key].error }}</p>
				<div v-for="(check, index) in state[regulation.key].data?.checks" :key="index" class="ld-compliance__check">
					<LogDetailsGuardrailIconComponent :name="check.passed ? 'check' : 'fail'" :size="16" />
					<div>
						<div class="ld-inline">
							<strong>{{ check.check_name }}</strong
							><span class="ld-mono">{{ check.article }}</span>
						</div>
						<p>{{ check.detail }}</p>
					</div>
				</div>
			</div>
		</section>
	</div>
</template>
