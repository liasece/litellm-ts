<script setup lang="ts">
import { computed } from "vue";
import { asRecord, safeJsonStringify } from "../../../logic/PrettyMessagesBlocksLogic";
import { recordArray } from "../../../logic/PrettyMessagesRealtimeLogic";
import { readFieldPath } from "../../../logic/PrettyMessagesFieldRules";
import LogDetailsGuardrailSectionComponent from "./LogDetailsGuardrailSectionComponent.vue";
const props = defineProps<{ response: unknown }>();
const record = computed(() => asRecord(props.response) ?? {});
const groups = [
	{ path: "wordPolicy.customWords", title: "Custom Words", open: true, type: "word" },
	{ path: "wordPolicy.managedWordLists", title: "Managed Word Lists", open: false, type: "word" },
	{ path: "sensitiveInformationPolicy.piiEntities", title: "PII Entities", open: true, type: "pii" },
	{ path: "sensitiveInformationPolicy.regexes", title: "Custom Regexes", open: false, type: "regex" },
];
const policies = [
	["wordPolicy", "word"],
	["contentPolicy", "content"],
	["topicPolicy", "topic"],
	["sensitiveInformationPolicy", "sensitive-info"],
	["contextualGroundingPolicy", "contextual-grounding"],
	["automatedReasoningPolicy", "automated-reasoning"],
];
const tables = [
	{
		path: "contentPolicy.filters",
		title: "Content Policy",
		fields: [
			["type", "Type"],
			["action", "Action"],
			["detected", "Detected"],
			["filterStrength", "Strength"],
			["confidence", "Confidence"],
		],
	},
	{
		path: "contextualGroundingPolicy.filters",
		title: "Contextual Grounding",
		fields: [
			["type", "Type"],
			["action", "Action"],
			["detected", "Detected"],
			["score", "Score"],
			["threshold", "Threshold"],
		],
	},
];
const values = (value: unknown) =>
	Object.entries(asRecord(value) ?? {}).filter((entry): entry is [string, number] => typeof entry[1] === "number");
function coverage(value: unknown, prefix = false) {
	const r = asRecord(value) ?? {};
	return [
		["textCharacters", "text"],
		["images", "images"],
	].flatMap(([key, label]) => {
		const item = asRecord(r[key]);
		return item ? [label + (prefix ? " guarded " : " ") + String(item.guarded ?? 0) + "/" + String(item.total ?? 0)] : [];
	});
}
</script>
<template>
	<div class="ld-stack">
		<div class="ld-guardrail-summary">
			<div class="ld-grid-two">
				<div>
					<div class="ld-kv">
						<strong>Action:</strong
						><span class="ld-chip" :class="record.action === 'GUARDRAIL_INTERVENED' ? 'ld-chip--red' : 'ld-chip--green'">{{
							record.action ?? "N/A"
						}}</span>
					</div>
					<div v-if="record.actionReason" class="ld-kv">
						<strong>Action Reason:</strong><span>{{ record.actionReason }}</span>
					</div>
					<div v-if="record.blockedResponse" class="ld-kv">
						<strong>Blocked Response:</strong><em>{{ record.blockedResponse }}</em>
					</div>
				</div>
				<div>
					<div class="ld-kv">
						<strong>Coverage:</strong
						><span class="ld-inline ld-wrap"
							><span v-for="item in coverage(record.guardrailCoverage, true)" :key="item" class="ld-chip ld-chip--blue">{{
								item
							}}</span></span
						>
					</div>
					<div class="ld-kv">
						<strong>Usage:</strong
						><span class="ld-inline ld-wrap"
							><span v-for="[key, value] in values(record.usage)" :key="key" class="ld-chip"
								>{{ key }}: {{ value }}</span
							></span
						>
					</div>
				</div>
			</div>
			<template v-if="recordArray(record.outputs ?? record.output).length"
				><div class="ld-divider" />
				<h4>Outputs</h4>
				<div v-for="(output, index) in recordArray(record.outputs ?? record.output)" :key="index" class="ld-guardrail-subcard">
					<span v-if="output.text !== undefined">{{ output.text }}</span
					><em v-else>(non-text output)</em>
				</div></template
			>
		</div>
		<LogDetailsGuardrailSectionComponent
			v-for="(assessment, index) in recordArray(record.assessments)"
			:key="index"
			:title="'Assessment #' + (index + 1)"
			><template #right
				><span class="ld-inline ld-wrap"
					><span
						v-if="asRecord(assessment.invocationMetrics)?.guardrailProcessingLatency !== undefined"
						class="ld-chip ld-chip--amber"
						>{{ asRecord(assessment.invocationMetrics)?.guardrailProcessingLatency }} ms</span
					><template v-for="[key, label] in policies" :key="key"
						><span v-if="assessment[key]" class="ld-chip">{{ label }}</span></template
					></span
				></template
			>
			<div class="ld-stack">
				<template v-for="group in groups" :key="group.path"
					><LogDetailsGuardrailSectionComponent
						v-if="recordArray(readFieldPath(assessment, group.path)).length"
						:title="group.title"
						:default-open="group.open"
						><div class="ld-stack">
							<div
								v-for="(item, i) in recordArray(readFieldPath(assessment, group.path))"
								:key="i"
								class="ld-guardrail-subcard ld-between"
							>
								<span class="ld-inline ld-wrap"
									><span class="ld-chip" :class="item.detected ? 'ld-chip--red' : ''">{{ item.action ?? "N/A" }}</span
									><span v-if="group.type === 'regex'">{{ item.name ?? "regex" }}</span
									><span v-if="item.type" class="ld-chip">{{ item.type }}</span
									><span class="ld-mono">{{ group.type === "regex" ? item.regex : item.match }}</span></span
								><span class="ld-inline"
									><span class="ld-chip" :class="item.detected ? 'ld-chip--red' : ''">{{
										item.detected ? "detected" : "not detected"
									}}</span
									><span v-if="group.type === 'regex' && item.match" class="ld-mono">{{ item.match }}</span></span
								>
							</div>
						</div></LogDetailsGuardrailSectionComponent
					></template
				>
				<template v-for="table in tables" :key="table.path"
					><div v-if="recordArray(readFieldPath(assessment, table.path)).length">
						<h6>{{ table.title }}</h6>
						<div class="ld-table-scroll">
							<table class="ld-provider-table">
								<thead>
									<tr>
										<th v-for="[field, label] in table.fields" :key="field">{{ label }}</th>
									</tr>
								</thead>
								<tbody>
									<tr v-for="(item, i) in recordArray(readFieldPath(assessment, table.path))" :key="i">
										<td v-for="[field] in table.fields" :key="field">
											<span
												v-if="field === 'detected'"
												class="ld-chip"
												:class="item.detected ? 'ld-chip--red' : ''"
												>{{ item.detected ? "detected" : "not detected" }}</span
											><span
												v-else-if="field === 'action'"
												class="ld-chip"
												:class="item.detected ? 'ld-chip--red' : ''"
												>{{ item[field] ?? "—" }}</span
											><template v-else>{{ item[field] ?? "—" }}</template>
										</td>
									</tr>
								</tbody>
							</table>
						</div>
					</div></template
				>
				<div v-if="recordArray(readFieldPath(assessment, 'topicPolicy.topics')).length">
					<h6>Topic Policy</h6>
					<div class="ld-inline ld-wrap">
						<div
							v-for="(item, i) in recordArray(readFieldPath(assessment, 'topicPolicy.topics'))"
							:key="i"
							class="ld-guardrail-subcard ld-inline"
						>
							<span class="ld-chip" :class="item.detected ? 'ld-chip--red' : ''">{{ item.action ?? "N/A" }}</span
							><strong>{{ item.name ?? "topic" }}</strong
							><span v-if="item.type" class="ld-chip">{{ item.type }}</span
							><span class="ld-chip" :class="item.detected ? 'ld-chip--red' : ''">{{
								item.detected ? "detected" : "not detected"
							}}</span>
						</div>
					</div>
				</div>
				<LogDetailsGuardrailSectionComponent v-if="assessment.invocationMetrics" title="Invocation Metrics" :default-open="false"
					><div class="ld-grid-two">
						<div>
							<div class="ld-kv">
								<strong>Latency (ms)</strong
								><span>{{ asRecord(assessment.invocationMetrics)?.guardrailProcessingLatency ?? "—" }}</span>
							</div>
							<div class="ld-kv">
								<strong>Coverage:</strong
								><span class="ld-inline ld-wrap"
									><span
										v-for="item in coverage(asRecord(assessment.invocationMetrics)?.guardrailCoverage)"
										:key="item"
										class="ld-chip ld-chip--blue"
										>{{ item }}</span
									></span
								>
							</div>
						</div>
						<div class="ld-kv">
							<strong>Usage:</strong
							><span class="ld-inline ld-wrap"
								><span
									v-for="[key, value] in values(asRecord(assessment.invocationMetrics)?.usage)"
									:key="key"
									class="ld-chip"
									>{{ key }}: {{ value }}</span
								></span
							>
						</div>
					</div></LogDetailsGuardrailSectionComponent
				>
				<LogDetailsGuardrailSectionComponent
					v-if="
						Array.isArray(readFieldPath(assessment, 'automatedReasoningPolicy.findings')) &&
						(readFieldPath(assessment, 'automatedReasoningPolicy.findings') as unknown[]).length
					"
					title="Automated Reasoning Findings"
					:default-open="false"
				>
					<pre
						v-for="(finding, i) in readFieldPath(assessment, 'automatedReasoningPolicy.findings') as unknown[]"
						:key="i"
						class="ld-guardrail-json"
						>{{ safeJsonStringify(finding, true) }}</pre
					>
				</LogDetailsGuardrailSectionComponent>
			</div>
		</LogDetailsGuardrailSectionComponent>
		<LogDetailsGuardrailSectionComponent title="Raw Bedrock Guardrail Response" :default-open="false">
			<pre class="ld-guardrail-json">{{ safeJsonStringify(response, true) }}</pre>
		</LogDetailsGuardrailSectionComponent>
	</div>
</template>
