<script setup lang="ts">
import UiCard from "../../platform/ui/UiCard.vue";
import { useMoneyFormatter } from "../../platform/stores/PriceDisplayStore";
import { stringValues, type KeyCatalog, type VirtualKey } from "../support/VirtualKeyModels";
import KeyBadge from "./KeyBadgeComponent.vue";
import KeyPermissionSummary from "./KeyPermissionSummaryComponent.vue";
import KeyOperationalSummary from "./KeyOperationalSummaryComponent.vue";
defineProps<{ keyData: VirtualKey; catalog: KeyCatalog; policyGuardrails: Record<string, string[]>; loadingPolicies: boolean }>();
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
				<KeyBadge v-for="model in keyData.models" :key="model" color="red">{{ model }}</KeyBadge>
				<p v-if="!keyData.models.length" class="vk-tremor-text">No models specified</p>
			</div></UiCard
		>
		<UiCard><KeyPermissionSummary :key-data="keyData" :catalog="catalog" /></UiCard>
		<UiCard
			><p class="vk-tremor-text vk-card-heading">Guardrails</p>
			<div v-if="stringValues(keyData.metadata.guardrails).length" class="vk-summary-badges">
				<KeyBadge v-for="guardrail in stringValues(keyData.metadata.guardrails)" :key="guardrail">{{ guardrail }}</KeyBadge>
			</div>
			<p v-else class="vk-tremor-text">No guardrails configured</p>
			<div v-if="keyData.metadata.disable_global_guardrails === true" class="vk-guards-disabled">
				<KeyBadge color="yellow">Global Guardrails Disabled</KeyBadge>
			</div></UiCard
		>
		<UiCard
			><p class="vk-tremor-text vk-card-heading">Policies</p>
			<div v-if="stringValues(keyData.metadata.policies).length" class="vk-policy-list">
				<div v-for="policy in stringValues(keyData.metadata.policies)" :key="policy">
					<KeyBadge color="purple">{{ policy }}</KeyBadge
					><small v-if="loadingPolicies">Loading guardrails...</small>
					<div v-else-if="policyGuardrails[policy]?.length" class="vk-policy-guards">
						<p>Resolved Guardrails:</p>
						<div class="vk-summary-badges">
							<KeyBadge v-for="guardrail in policyGuardrails[policy]" :key="guardrail" small>{{ guardrail }}</KeyBadge>
						</div>
					</div>
				</div>
			</div>
			<p v-else class="vk-tremor-text">No policies configured</p></UiCard
		>
		<KeyOperationalSummary :key-data="keyData" mode="logging" card />
		<KeyOperationalSummary :key-data="keyData" mode="rotation" card />
	</div>
</template>
