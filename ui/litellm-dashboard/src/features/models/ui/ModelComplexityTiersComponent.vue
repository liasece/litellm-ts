<script setup lang="ts">
import UiCard from "../../platform/ui/UiCard.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import { modelOptions } from "../support/ModelModels";
import { complexityDescriptions, type ComplexityTiers } from "../logic/AutoRouterLogic";
const tiers = defineModel<ComplexityTiers>({ required: true });
defineProps<{ models: string[] }>();
</script>
<template>
	<div class="model-complexity">
		<h4>
			Complexity Tier Configuration
			<UiTooltip
				content="Map each complexity tier to a model. Simple queries use cheaper/faster models, complex queries use more capable models."
				><UiIcon name="InfoCircleOutlined"
			/></UiTooltip>
		</h4>
		<p class="model-complexity-explanation">
			The complexity router automatically classifies requests by complexity using rule-based scoring (no API calls, &lt;1ms latency).
			Configure which model handles each tier.
		</p>
		<UiCard appearance="antd"
			><div v-for="(info, key, index) in complexityDescriptions" :key="key" class="model-complexity-tier">
				<hr v-if="index" class="model-ant-divider" />
				<div>
					<strong>{{ info.label }} Tier</strong
					><UiTooltip :title="info.description"><UiIcon name="InfoCircleOutlined" /></UiTooltip>
				</div>
				<p>Examples: {{ info.examples }}</p>
				<UiSelect
					v-model="tiers[key]"
					:options="modelOptions(models)"
					searchable
					:placeholder="'Select model for ' + info.label.toLowerCase() + ' queries'"
				/></div
		></UiCard>
		<hr class="model-ant-divider" />
		<UiCard appearance="antd" class="model-muted-card"
			><strong>How Classification Works</strong>
			<p>
				The router scores each request across 7 dimensions: token count, code presence, reasoning markers, technical terms, simple
				indicators, multi-step patterns, and question complexity. The weighted score determines the tier:
			</p>
			<ul>
				<li><strong>SIMPLE</strong>: Score &lt; 0.15</li>
				<li><strong>MEDIUM</strong>: Score 0.15 - 0.35</li>
				<li><strong>COMPLEX</strong>: Score 0.35 - 0.60</li>
				<li><strong>REASONING</strong>: Score &gt; 0.60 (or 2+ reasoning markers)</li>
			</ul></UiCard
		>
	</div>
</template>
