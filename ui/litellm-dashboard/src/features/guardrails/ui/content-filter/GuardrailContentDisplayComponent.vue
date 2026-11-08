<script setup lang="ts">
import UiCard from "../../../platform/ui/UiCard.vue";
import UiTag from "../../../platform/ui/UiTag.vue";
import UiTable from "../../../platform/ui/UiTable.vue";
import GuardrailContentTablesComponent from "./GuardrailContentTablesComponent.vue";
import type { GuardrailContentDraft } from "../../support/GuardrailModels";
defineProps<{ content: GuardrailContentDraft }>();
</script>
<template>
	<div class="guardrail-content-display">
		<UiCard v-if="content.categories.length"
			><header>
				<strong>Content Categories</strong
				><UiTag appearance="tremor" color="blue">{{ content.categories.length }} categories configured</UiTag>
			</header>
			<UiTable
				:rows="content.categories.map((row) => ({ ...row }))"
				:columns="[
					{ key: 'display_name', label: 'Category' },
					{ key: 'severity_threshold', label: 'Severity Threshold', width: 180 },
					{ key: 'action', label: 'Action', width: 150 },
				]"
				compact
				><template #cell-display_name="{ row }"
					><div>
						<strong>{{ row.display_name }}</strong>
					</div>
					<div v-if="row.display_name !== row.category">
						<small class="guardrail-content-cell-sub">{{ row.category }}</small>
					</div></template
				><template #cell-severity_threshold="{ value }"
					><UiTag :color="value === 'high' ? 'red' : value === 'medium' ? 'orange' : 'yellow'">{{
						String(value).toUpperCase()
					}}</UiTag></template
				><template #cell-action="{ value }"
					><UiTag :color="value === 'BLOCK' ? 'red' : 'blue'">{{ String(value) }}</UiTag></template
				></UiTable
			></UiCard
		><UiCard v-if="content.patterns.length"
			><header>
				<strong>Pattern Detection</strong
				><UiTag appearance="tremor" color="blue">{{ content.patterns.length }} patterns configured</UiTag>
			</header>
			<GuardrailContentTablesComponent :patterns="content.patterns" /></UiCard
		><UiCard v-if="content.keywords.length"
			><header>
				<strong>Blocked Keywords</strong
				><UiTag appearance="tremor" color="blue">{{ content.keywords.length }} keywords configured</UiTag>
			</header>
			<GuardrailContentTablesComponent :keywords="content.keywords"
		/></UiCard>
	</div>
</template>
