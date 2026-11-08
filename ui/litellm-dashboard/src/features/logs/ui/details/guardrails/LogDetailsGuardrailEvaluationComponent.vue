<script setup lang="ts">
import { computed, ref } from "vue";
import { guardrailMode, guardrailName, guardrailPassed, guardrailRisk } from "../../../logic/LogDetailsGuardrailLogic";
import { maskedEntityCount } from "../../../logic/LogDetailsDisplayLogic";
import { asRecord, safeJsonStringify } from "../../../logic/PrettyMessagesBlocksLogic";
import { recordArray } from "../../../logic/PrettyMessagesRealtimeLogic";
import LogDetailsGuardrailIconComponent from "./LogDetailsGuardrailIconComponent.vue";
import LogDetailsGuardrailSectionComponent from "./LogDetailsGuardrailSectionComponent.vue";
import LogDetailsPresidioComponent from "./LogDetailsPresidioComponent.vue";
import LogDetailsBedrockComponent from "./LogDetailsBedrockComponent.vue";
import LogDetailsContentFilterComponent from "./LogDetailsContentFilterComponent.vue";
const props = defineProps<{ entry: Record<string, unknown> }>();
const expanded = ref(false),
	success = computed(() => guardrailPassed(props.entry)),
	masked = computed(() => maskedEntityCount([props.entry])),
	risk = computed(() => guardrailRisk(props.entry)),
	classification = computed(() => asRecord(props.entry.classification)),
	provider = computed(() => String(props.entry.guardrail_provider ?? "presidio"));
</script>
<template>
	<section class="ld-evaluation">
		<button type="button" class="ld-evaluation__header" :aria-expanded="expanded" @click="expanded = !expanded">
			<LogDetailsGuardrailIconComponent :name="success ? 'check' : 'fail'" /><span class="ld-evaluation__badges"
				><strong>{{ guardrailName(entry) }}</strong
				><span class="ld-chip ld-chip--blue">{{
					(guardrailMode(entry.guardrail_mode) || "—").replace(/_/g, "-").toUpperCase()
				}}</span
				><span class="ld-chip" :class="success ? 'ld-chip--green' : 'ld-chip--red'">{{ success ? "PASSED" : "FAILED" }}</span
				><span
					v-if="(entry.patterns_checked !== undefined && entry.patterns_checked !== null) || masked > 0"
					class="ld-chip"
					:class="masked === 0 ? 'ld-chip--green' : 'ld-chip--amber'"
					>{{
						entry.patterns_checked !== undefined && entry.patterns_checked !== null
							? masked + "/" + entry.patterns_checked
							: masked
					}}
					matched</span
				><span v-if="typeof entry.confidence_score === 'number'" class="ld-chip"
					>{{ (entry.confidence_score * 100).toFixed(0) }}% conf</span
				><span
					v-if="risk !== null && success"
					class="ld-chip"
					:class="risk <= 3 ? 'ld-chip--green' : risk <= 6 ? 'ld-chip--amber' : 'ld-chip--red'"
					:title="'Risk score: ' + risk + '/10'"
					>Risk {{ risk }}/10</span
				></span
			><span class="ld-evaluation__right"
				><span class="ld-mono">{{ Math.round(Number(entry.duration ?? 0) * 1000) }}ms</span
				><span v-if="entry.detection_method" class="ld-chip">{{ String(entry.detection_method).split(",")[0].trim() }}</span
				><LogDetailsGuardrailIconComponent name="chevron" :expanded="expanded"
			/></span>
		</button>
		<div v-if="expanded" class="ld-evaluation__body">
			<div v-if="classification" class="ld-guardrail-classification">
				<h5>Classification</h5>
				<div v-if="classification.category" class="ld-kv">
					<strong>Category:</strong><span>{{ classification.category }}</span>
				</div>
				<div v-if="classification.article_reference" class="ld-kv">
					<strong>Reference:</strong><span class="ld-mono">{{ classification.article_reference }}</span>
				</div>
				<div v-if="typeof classification.confidence === 'number'" class="ld-kv">
					<strong>Confidence:</strong><span>{{ (classification.confidence * 100).toFixed(0) }}%</span>
				</div>
				<div v-if="classification.reason" class="ld-kv">
					<strong>Reason:</strong><span>{{ classification.reason }}</span>
				</div>
			</div>
			<div v-if="recordArray(entry.match_details).length" class="ld-guardrail-matches">
				<h5>Match Details ({{ recordArray(entry.match_details).length }})</h5>
				<div class="ld-table-scroll">
					<table class="ld-provider-table">
						<thead>
							<tr>
								<th>Type</th>
								<th>Method</th>
								<th>Action</th>
								<th>Detail</th>
							</tr>
						</thead>
						<tbody>
							<tr v-for="(match, index) in recordArray(entry.match_details)" :key="index">
								<td>{{ match.type }}</td>
								<td>
									<span class="ld-chip">{{ match.detection_method ?? "-" }}</span>
								</td>
								<td>
									<span class="ld-chip" :class="match.action_taken === 'BLOCK' ? 'ld-chip--red' : 'ld-chip--blue'">{{
										match.action_taken ?? "-"
									}}</span>
								</td>
								<td class="ld-mono">{{ match.category ? "[" + match.category + "] " : "" }}{{ match.snippet ?? "-" }}</td>
							</tr>
						</tbody>
					</table>
				</div>
			</div>
			<div v-if="masked > 0" class="ld-guardrail-masked">
				<h5>Masked Entities</h5>
				<div class="ld-inline ld-wrap">
					<span v-for="(count, key) in asRecord(entry.masked_entity_count)" :key="key" class="ld-chip ld-chip--blue"
						>{{ key }}: {{ count }}</span
					>
				</div>
			</div>
			<LogDetailsPresidioComponent
				v-if="provider === 'presidio' && Array.isArray(entry.guardrail_response)"
				:entities="entry.guardrail_response"
			/>
			<LogDetailsBedrockComponent
				v-if="provider === 'bedrock' && asRecord(entry.guardrail_response)"
				:response="entry.guardrail_response"
			/>
			<LogDetailsContentFilterComponent
				v-if="provider === 'litellm_content_filter' && entry.guardrail_response"
				:response="entry.guardrail_response"
			/>
			<LogDetailsGuardrailSectionComponent
				v-if="!['presidio', 'bedrock', 'litellm_content_filter'].includes(provider) && entry.guardrail_response"
				title="Raw Guardrail Response"
				:default-open="false"
			>
				<pre class="ld-guardrail-json">{{ safeJsonStringify(entry.guardrail_response, true) }}</pre>
			</LogDetailsGuardrailSectionComponent>
		</div>
	</section>
</template>
