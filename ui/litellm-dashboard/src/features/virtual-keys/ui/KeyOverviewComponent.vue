<script setup lang="ts">
import UiCard from "../../platform/ui/UiCard.vue";
import { useMoneyFormatter } from "../../platform/stores/PriceDisplayStore";
import type { KeyCatalog, VirtualKey } from "../support/VirtualKeyModels";
import KeyBadge from "./KeyBadgeComponent.vue";
import ModelName from "../../providers/ui/ModelNameComponent.vue";
import KeyPermissionSummary from "./KeyPermissionSummaryComponent.vue";
import KeyOperationalSummary from "./KeyOperationalSummaryComponent.vue";
defineProps<{ keyData: VirtualKey; catalog: KeyCatalog }>();
const formatMoney = useMoneyFormatter();
</script>
<template>
	<div class="vk-overview-grid">
		<UiCard
			><p class="vk-tremor-text">Spend</p>
			<div class="vk-card-body">
				<h3 class="vk-tremor-title">{{ formatMoney(keyData.spend, 4) }}</h3>
				<p class="vk-tremor-text">of {{ keyData.max_budget !== null ? formatMoney(keyData.max_budget, 4) : "Unlimited" }}</p>
			</div></UiCard
		>
		<UiCard
			><p class="vk-tremor-text">Rate Limits</p>
			<div class="vk-card-body vk-tremor-text">
				<p>TPM: {{ keyData.tpm_limit !== null ? keyData.tpm_limit : "Unlimited" }}</p>
				<p>RPM: {{ keyData.rpm_limit !== null ? keyData.rpm_limit : "Unlimited" }}</p>
			</div></UiCard
		>
		<UiCard
			><p class="vk-tremor-text">Models</p>
			<div class="vk-card-body vk-summary-badges">
				<KeyBadge v-for="model in keyData.models" :key="model" color="red"
					><ModelName :model="model" :size="12" :truncate="true"
				/></KeyBadge>
				<p v-if="!keyData.models.length" class="vk-tremor-text">No models specified</p>
			</div></UiCard
		>
		<UiCard><KeyPermissionSummary :key-data="keyData" /></UiCard>
		<KeyOperationalSummary :key-data="keyData" mode="logging" card />
		<KeyOperationalSummary :key-data="keyData" mode="rotation" card />
	</div>
</template>
