<script setup lang="ts">
import { computed } from "vue";
import { recordArray } from "../../../logic/PrettyMessagesRealtimeLogic";
import { safeJsonStringify } from "../../../logic/PrettyMessagesBlocksLogic";
import LogDetailsGuardrailSectionComponent from "./LogDetailsGuardrailSectionComponent.vue";
const props = defineProps<{ response: unknown }>();
const detections = computed(() => recordArray(props.response));
const groups = computed(() =>
	[
		{ type: "pattern", title: "Patterns Matched", label: "Pattern:", field: "pattern_name", summary: "patterns" },
		{ type: "blocked_word", title: "Blocked Words Detected", label: "Keyword:", field: "keyword", summary: "keywords" },
		{ type: "category_keyword", title: "Category Keywords Detected", label: "Category:", field: "category", summary: "categories" },
	].map((group) => ({ ...group, items: detections.value.filter((item) => item.type === group.type) })),
);
</script>
<template>
	<div v-if="typeof response === 'string' && response" class="ld-guardrail-error">
		<h5>Error</h5>
		<p>{{ response }}</p>
	</div>
	<div v-else-if="response" class="ld-stack">
		<div v-if="!detections.length" class="ld-guardrail-summary ld-secondary">No detections found</div>
		<template v-else
			><div class="ld-guardrail-summary ld-grid-two">
				<div>
					<div class="ld-kv">
						<strong>Total Detections:</strong><strong>{{ detections.length }}</strong>
					</div>
					<div class="ld-kv">
						<strong>Actions:</strong
						><span class="ld-inline ld-wrap"
							><span v-if="detections.some((item) => item.action === 'BLOCK')" class="ld-chip ld-chip--red"
								>{{ detections.filter((item) => item.action === "BLOCK").length }} blocked</span
							><span v-if="detections.some((item) => item.action === 'MASK')" class="ld-chip ld-chip--blue"
								>{{ detections.filter((item) => item.action === "MASK").length }} masked</span
							><span
								v-if="!detections.some((item) => item.action === 'BLOCK' || item.action === 'MASK')"
								class="ld-chip ld-chip--green"
								>passed</span
							></span
						>
					</div>
				</div>
				<div class="ld-kv">
					<strong>By Type:</strong
					><span class="ld-inline ld-wrap"
						><template v-for="group in groups" :key="group.type"
							><span v-if="group.items.length" class="ld-chip">{{ group.items.length }} {{ group.summary }}</span></template
						></span
					>
				</div>
			</div>
			<template v-for="group in groups" :key="group.type"
				><LogDetailsGuardrailSectionComponent v-if="group.items.length" :title="group.title" :count="group.items.length"
					><div class="ld-stack">
						<div v-for="(item, index) in group.items" :key="index" class="ld-guardrail-subcard ld-grid-two">
							<div>
								<div class="ld-kv">
									<strong>{{ group.label }}</strong
									><span>{{ item[group.field] || "unknown" }}</span>
								</div>
								<div v-if="group.type === 'blocked_word' && item.description" class="ld-kv">
									<strong>Description:</strong><span>{{ item.description }}</span>
								</div>
								<div v-if="group.type === 'category_keyword' && item.keyword" class="ld-kv">
									<strong>Keyword:</strong><span>{{ item.keyword }}</span>
								</div>
								<div v-if="group.type === 'category_keyword' && item.severity" class="ld-kv">
									<strong>Severity:</strong
									><span
										class="ld-chip"
										:class="
											item.severity === 'high' ? 'ld-chip--red' : item.severity === 'medium' ? 'ld-chip--amber' : ''
										"
										>{{ item.severity }}</span
									>
								</div>
							</div>
							<div class="ld-kv">
								<strong>Action:</strong
								><span class="ld-chip" :class="item.action === 'BLOCK' ? 'ld-chip--red' : 'ld-chip--blue'">{{
									item.action
								}}</span>
							</div>
						</div>
					</div></LogDetailsGuardrailSectionComponent
				></template
			><LogDetailsGuardrailSectionComponent title="Raw Detection Data" :default-open="false">
				<pre class="ld-guardrail-json">{{ safeJsonStringify(detections, true) }}</pre>
			</LogDetailsGuardrailSectionComponent></template
		>
	</div>
</template>
