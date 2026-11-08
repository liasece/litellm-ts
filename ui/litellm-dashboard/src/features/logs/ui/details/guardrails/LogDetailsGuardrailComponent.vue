<script setup lang="ts">
import { computed } from "vue";
import type { LogEntry } from "../../../support/LogsModels";
import { guardrailLifecycle, guardrailPassed } from "../../../logic/LogDetailsGuardrailLogic";
import LogDetailsGuardrailIconComponent from "./LogDetailsGuardrailIconComponent.vue";
import LogDetailsComplianceComponent from "./LogDetailsComplianceComponent.vue";
import LogDetailsGuardrailEvaluationComponent from "./LogDetailsGuardrailEvaluationComponent.vue";
import "./LogDetailsGuardrailStyles.css";
const props = defineProps<{ entries: Record<string, unknown>[]; log: LogEntry }>();
const passed = computed(() => props.entries.filter(guardrailPassed).length),
	overhead = computed(() => Math.round(props.entries.reduce((sum, entry) => sum + Number(entry.duration ?? 0), 0) * 1000)),
	lifecycle = computed(() => guardrailLifecycle(props.entries));
function exportLog() {
	const blob = new Blob([JSON.stringify(props.entries, null, 2)], { type: "application/json" }),
		url = URL.createObjectURL(blob),
		anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = "guardrail-compliance-log-" + new Date().toISOString().slice(0, 10) + ".json";
	anchor.click();
	URL.revokeObjectURL(url);
}
</script>
<template>
	<section v-if="entries.length" class="ld-guardrail">
		<div class="ld-guardrail__header">
			<div class="ld-inline" style="gap: 16px">
				<LogDetailsGuardrailIconComponent name="shield" />
				<div>
					<h3>Guardrails &amp; Policy Compliance</h3>
					<div class="ld-inline ld-guardrail__subtitle">
						<span>{{ entries.length }} guardrail{{ entries.length === 1 ? "" : "s" }} evaluated</span
						><span class="ld-guardrail__separator">|</span
						><span class="ld-chip" :class="passed === entries.length ? 'ld-chip--green' : 'ld-chip--red'"
							><svg v-if="passed === entries.length" width="12" height="12" viewBox="0 0 12 12" fill="none">
								<path
									d="M3 6l2.5 2.5L9 4"
									stroke="currentColor"
									stroke-width="1.5"
									stroke-linecap="round"
									stroke-linejoin="round"
								/></svg
							>{{ passed }} Passed</span
						>
					</div>
				</div>
			</div>
			<div class="ld-guardrail__actions">
				<span>Total: {{ overhead }}ms overhead</span
				><button type="button" @click="exportLog"><LogDetailsGuardrailIconComponent name="download" />Export Compliance Log</button>
			</div>
		</div>
		<div class="ld-guardrail__compliance"><LogDetailsComplianceComponent :log="log" /></div>
		<div class="ld-guardrail__body">
			<div class="ld-guardrail__lifecycle">
				<h4>Request Lifecycle</h4>
				<div v-for="(item, index) in lifecycle" :key="index" class="ld-lifecycle__item">
					<div class="ld-lifecycle__line">
						<LogDetailsGuardrailIconComponent
							:name="
								item.type === 'request' || item.type === 'response'
									? 'dot'
									: item.type === 'llm'
										? 'play'
										: item.success
											? 'check'
											: 'fail'
							"
						/><span v-if="index < lifecycle.length - 1" />
					</div>
					<div class="ld-lifecycle__content">
						<span :class="{ 'ld-lifecycle__llm': item.type === 'llm' }">{{ item.label }}</span
						><span
							v-if="item.success !== undefined"
							class="ld-chip"
							:class="item.success ? 'ld-chip--green' : 'ld-chip--red'"
							>{{ item.success ? "PASSED" : "FAILED" }}</span
						><span class="ld-lifecycle__time">T+{{ item.offsetMs }}ms</span>
					</div>
				</div>
			</div>
			<div class="ld-guardrail__evaluations">
				<h4>Evaluation Details</h4>
				<div class="ld-stack">
					<LogDetailsGuardrailEvaluationComponent
						v-for="(entry, index) in entries"
						:key="String(entry.guardrail_name || 'guardrail') + '-' + index"
						:entry="entry"
					/>
				</div>
			</div>
		</div>
	</section>
</template>
