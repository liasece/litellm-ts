<script setup lang="ts">
import { computed } from "vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiTag from "../../platform/ui/UiTag.vue";
import { useMoneyFormatter } from "../../platform/stores/PriceDisplayStore";
import { keyTimestamp } from "../render/KeyTablePresentation";
import { stringValues, type KeyCatalog, type VirtualKey } from "../support/VirtualKeyModels";
import KeyBadge from "./KeyBadgeComponent.vue";
import KeyPermissionSummary from "./KeyPermissionSummaryComponent.vue";
import KeyOperationalSummary from "./KeyOperationalSummaryComponent.vue";
const props = defineProps<{ keyData: VirtualKey; catalog: KeyCatalog; lastRegeneratedAt?: Date | null; recentlyRegenerated?: boolean }>();
const formatMoney = useMoneyFormatter();
const settings = computed(() => [
	["Key ID", props.keyData.token_id || props.keyData.token],
	["Enabled", props.keyData.blocked === true ? "Disabled" : "Enabled"],
	["Key Alias", props.keyData.key_alias || "Not Set"],
	["Secret Key", props.keyData.key_name],
	["Team ID", props.keyData.team_id || "Not Set"],
	["Organization", props.keyData.organization_id ?? props.keyData.org_id ?? "Not Set"],
	["Created", keyTimestamp(props.keyData.created_at)],
]);
const lists = computed(() => [{ label: "Allowed Routes", values: stringValues(props.keyData.allowed_routes), empty: "" }]);
const metadata = computed(() => Object.fromEntries(Object.entries(props.keyData.metadata)));
</script>
<template>
	<UiCard class="vk-settings-card"
		><h2 class="vk-tremor-title">Key Settings</h2>
		<div class="vk-settings-list">
			<div v-for="[label, value] in settings" :key="String(label)">
				<h4>{{ label }}</h4>
				<p :class="{ 'vk-mono': label === 'Key ID' || label === 'Secret Key' }">{{ value }}</p>
			</div>
			<div v-if="lastRegeneratedAt">
				<h4>Last Regenerated</h4>
				<p>{{ keyTimestamp(lastRegeneratedAt) }} <KeyBadge v-if="recentlyRegenerated" color="green" small>Recent</KeyBadge></p>
			</div>
			<div>
				<h4>Expires</h4>
				<p>{{ keyData.expires ? keyTimestamp(keyData.expires) : "Never" }}</p>
			</div>
			<KeyOperationalSummary :key-data="keyData" mode="rotation" class="vk-settings-divider" />
			<div>
				<h4>Spend</h4>
				<p>{{ formatMoney(keyData.spend, 4) }}</p>
			</div>
			<div>
				<h4>Budget</h4>
				<p>{{ keyData.max_budget !== null ? formatMoney(keyData.max_budget, 2) : "Unlimited" }}</p>
			</div>
			<div v-for="list in lists" :key="list.label">
				<h4>{{ list.label }}</h4>
				<div v-if="list.values.length" class="vk-settings-values">
					<UiTag v-for="value in list.values" :key="value">{{ value }}</UiTag>
				</div>
				<p v-else-if="list.empty">{{ list.empty }}</p>
				<UiTag v-else color="green">All routes allowed</UiTag>
			</div>
			<div>
				<h4>Models</h4>
				<div v-if="keyData.models.length" class="vk-settings-values">
					<UiTag v-for="model in keyData.models" :key="model">{{ model }}</UiTag>
				</div>
				<p v-else>No models specified</p>
			</div>
			<div>
				<h4>Rate Limits</h4>
				<p>TPM: {{ keyData.tpm_limit !== null ? keyData.tpm_limit : "Unlimited" }}</p>
				<p>RPM: {{ keyData.rpm_limit !== null ? keyData.rpm_limit : "Unlimited" }}</p>
				<p>Max Parallel Requests: {{ keyData.max_parallel_requests !== null ? keyData.max_parallel_requests : "Unlimited" }}</p>
				<p>
					Model TPM Limits:
					{{ keyData.metadata.model_tpm_limit ? JSON.stringify(keyData.metadata.model_tpm_limit) : "Unlimited" }}
				</p>
				<p>
					Model RPM Limits:
					{{ keyData.metadata.model_rpm_limit ? JSON.stringify(keyData.metadata.model_rpm_limit) : "Unlimited" }}
				</p>
			</div>
			<div>
				<h4>Metadata</h4>
				<pre class="vk-settings-metadata">{{ JSON.stringify(metadata, null, 2) }}</pre>
			</div>
			<KeyPermissionSummary :key-data="keyData" class="vk-settings-divider" />
			<KeyOperationalSummary :key-data="keyData" mode="logging" class="vk-settings-divider" /></div
	></UiCard>
</template>
