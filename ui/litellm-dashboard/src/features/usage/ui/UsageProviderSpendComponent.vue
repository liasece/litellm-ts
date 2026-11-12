<script setup lang="ts">
import { computed, ref } from "vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiSwitch from "../../platform/ui/UiSwitch.vue";
import UiTable from "../../platform/ui/UiTable.vue";
import type { UiTableColumn, UiTableRow } from "../../platform/ui/UiTypes";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import ProviderLogo from "../../providers/ui/ProviderLogoComponent.vue";
import { getProviderLogoAndName } from "../../providers/logic/ProviderIdentityLogic";
import UsageChartLoader from "./UsageChartLoaderComponent.vue";
import UsageTokensCell from "./UsageTokensCellComponent.vue";
import { useMoneyFormatter } from "../../platform/stores/PriceDisplayStore";
import type { ProviderRanking } from "../support/UsageModels";
const props = defineProps<{ providerSpend: ProviderRanking[]; loading: boolean; isDateChanging: boolean }>();
const includeZero = ref(false),
	includeUnknown = ref(false),
	money = useMoneyFormatter();
const rows = computed(() =>
	props.providerSpend
		.filter((p) => (p.provider?.toLowerCase() === "unknown" ? includeUnknown.value : includeZero.value || p.spend > 0))
		.sort((a, b) => b.spend - a.spend),
);
const tableRows = computed<readonly UiTableRow[]>(() => rows.value as unknown as readonly UiTableRow[]);
const columns: readonly UiTableColumn[] = [
	{ key: "provider", label: "Provider", width: 200 },
	{ key: "spend", label: "Spend", width: 220 },
	{ key: "requests", label: "Requests", width: 120 },
	{ key: "successful_requests", label: "Successful", width: 130, cellClass: "usage-success" },
	{ key: "failed_requests", label: "Failed", width: 100, cellClass: "usage-failed" },
	{
		key: "tokens",
		label: "Tokens",
		width: 150,
		tooltip: "Cache read, input (excluding cache reads) and output tokens, plus the cache hit rate.",
	},
];
function providerRow(row: UiTableRow): ProviderRanking {
	return row as unknown as ProviderRanking;
}
</script>
<template>
	<UiCard appearance="tremor" class="usage-panel">
		<header class="usage-panel-heading">
			<h2>Spend by Provider</h2>
			<div class="usage-provider-toggles">
				<div class="usage-provider-toggle">
					<label>Show Zero Spend</label><UiSwitch v-model="includeZero" appearance="tremor" />
				</div>
				<div class="usage-provider-toggle">
					<div class="usage-provider-unknown">
						<label>Show Unknown</label>
						<UiTooltip title="Requests that failed to route to a provider">
							<UiIcon name="InfoCircleOutlined" :size="11" />
						</UiTooltip>
					</div>
					<UiSwitch v-model="includeUnknown" appearance="tremor" />
				</div>
			</div>
		</header>
		<UsageChartLoader v-if="loading" :is-date-changing="isDateChanging" />
		<UiTable v-else :columns="columns" :rows="tableRows" row-key="provider" fixed-layout empty-text="No logs found">
			<template #cell-provider="{ row }">
				<span class="usage-provider-name"
					><ProviderLogo
						v-if="providerRow(row).provider"
						:provider="providerRow(row).provider"
						:logo="getProviderLogoAndName(providerRow(row).provider).logo"
					/>{{ providerRow(row).provider }}</span
				>
			</template>
			<template #cell-spend="{ row }">
				<div class="usage-provider-bar">
					<span>{{ money(providerRow(row).spend, 2) }}</span>
					<div>
						<i
							:style="{
								width: (rows[0]?.spend > 0 ? Math.max(2, (providerRow(row).spend / rows[0].spend) * 100) : 0) + '%',
							}"
						/>
					</div>
				</div>
			</template>
			<template #cell-requests="{ row }">{{ providerRow(row).requests.toLocaleString() }}</template>
			<template #cell-successful_requests="{ row }">{{ providerRow(row).successful_requests.toLocaleString() }}</template>
			<template #cell-failed_requests="{ row }">{{ providerRow(row).failed_requests.toLocaleString() }}</template>
			<template #cell-tokens="{ row }"><UsageTokensCell :metrics="providerRow(row).metrics" /></template>
		</UiTable>
	</UiCard>
</template>
