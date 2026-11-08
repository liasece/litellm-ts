<script setup lang="ts">
import { ref, computed } from "vue";
import UiButton from "../../../platform/ui/UiButton.vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
import { GUARDRAIL_PRESETS } from "../../data/GuardrailGardenPresets";
import type { GuardrailCardInfo } from "../../data/GuardrailGardenData";
import GuardrailCreateDialogComponent from "../editor/GuardrailCreateDialogComponent.vue";
const props = defineProps<{ card: GuardrailCardInfo }>(),
	emit = defineEmits<{ back: []; created: [] }>(),
	open = ref(false),
	tab = ref("overview"),
	hidden = ref(false),
	details = computed(() => [
		{ property: "Provider", value: props.card.category === "litellm" ? "LiteLLM Content Filter" : "Partner Guardrail" },
		...(props.card.subcategory ? [{ property: "Subcategory", value: props.card.subcategory }] : []),
		...(props.card.category === "litellm"
			? [
					{ property: "Cost", value: "$0 / request" },
					{ property: "External Dependencies", value: "None" },
					{ property: "Latency", value: props.card.eval?.latency || "<1ms" },
				]
			: []),
	]),
	evaluations = computed(() =>
		props.card.eval
			? [
					{ metric: "Precision", value: props.card.eval.precision + "%" },
					{ metric: "Recall", value: props.card.eval.recall + "%" },
					{ metric: "F1 Score", value: props.card.eval.f1 + "%" },
					{ metric: "Test Cases", value: String(props.card.eval.testCases) },
					{ metric: "False Positives", value: "0" },
					{ metric: "False Negatives", value: "0" },
					{ metric: "Latency (p50)", value: props.card.eval.latency },
				]
			: [],
	);
</script>
<template>
	<div class="guardrail-garden-detail">
		<button type="button" class="guardrail-garden-back" @click="emit('back')">
			<UiIcon name="ArrowLeftOutlined" :size="11" /><span>{{ card.name }}</span>
		</button>
		<header>
			<img v-if="!hidden" :src="card.logo" alt="" @error="hidden = true" />
			<h1>{{ card.name }}</h1>
		</header>
		<p>{{ card.description }}</p>
		<div class="guardrail-garden-detail-actions"><UiButton @click="open = true">Create Guardrail</UiButton></div>
		<nav>
			<button type="button" :class="{ selected: tab === 'overview' }" @click="tab = 'overview'">Overview</button
			><button v-if="card.eval" type="button" :class="{ selected: tab === 'eval' }" @click="tab = 'eval'">Eval Results</button>
		</nav>
		<div v-if="tab === 'overview'" class="guardrail-garden-detail-overview">
			<div>
				<h2>Overview</h2>
				<p>{{ card.description }}</p>
				<h2>Guardrail Details</h2>
				<small>Details are as follows</small>
				<table>
					<thead>
						<tr>
							<th>Property</th>
							<th>{{ card.name }}</th>
						</tr>
					</thead>
					<tbody>
						<tr v-for="row in details" :key="row.property">
							<td>{{ row.property }}</td>
							<td>{{ row.value }}</td>
						</tr>
					</tbody>
				</table>
			</div>
			<aside>
				<section>
					<label>Guardrail ID</label>
					<p>litellm/{{ card.id }}</p>
				</section>
				<section>
					<label>Type</label>
					<p>{{ card.category === "litellm" ? "Content Filter" : "Partner" }}</p>
				</section>
				<section v-if="card.tags.length">
					<label>Tags</label>
					<div>
						<span v-for="tag in card.tags" :key="tag">{{ tag }}</span>
					</div>
				</section>
			</aside>
		</div>
		<div v-else class="guardrail-garden-evaluations">
			<h2>Eval Results</h2>
			<table>
				<thead>
					<tr>
						<th>Metric</th>
						<th>Value</th>
					</tr>
				</thead>
				<tbody>
					<tr v-for="row in evaluations" :key="row.metric">
						<td>{{ row.metric }}</td>
						<td>{{ row.value }}</td>
					</tr>
				</tbody>
			</table>
		</div>
		<GuardrailCreateDialogComponent v-model:open="open" :preset="GUARDRAIL_PRESETS[card.id]" @created="emit('created')" />
	</div>
</template>
