<script setup lang="ts">
import { computed, ref } from "vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiSwitch from "../../platform/ui/UiSwitch.vue";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import ProviderLogo from "../../providers/ui/ProviderLogoComponent.vue";
import { getProviderLogoAndName } from "../../providers/logic/ProviderIdentityLogic";
import UsageChartLoader from "./UsageChartLoaderComponent.vue";
import { useMoneyFormatter } from "../../platform/stores/PriceDisplayStore";
import { formatNumberWithCommas } from "../../formatting/logic/NumberFormattingLogic";
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
		<div v-else class="usage-provider-table">
			<table class="usage-simple-table">
				<thead>
					<tr>
						<th>Provider</th>
						<th>Spend</th>
						<th>Requests</th>
						<th class="usage-success">Successful</th>
						<th class="usage-failed">Failed</th>
						<th>Tokens</th>
					</tr>
				</thead>
				<tbody>
					<tr v-for="p in rows" :key="p.provider">
						<td>
							<span class="usage-provider-name"
								><ProviderLogo v-if="p.provider" :provider="p.provider" :logo="getProviderLogoAndName(p.provider).logo" />{{
									p.provider
								}}</span
							>
						</td>
						<td>
							<div class="usage-provider-bar">
								<span>{{ money(p.spend, 2) }}</span>
								<div>
									<i :style="{ width: (rows[0]?.spend > 0 ? Math.max(2, (p.spend / rows[0].spend) * 100) : 0) + '%' }" />
								</div>
							</div>
						</td>
						<td>{{ p.requests.toLocaleString() }}</td>
						<td class="usage-success">{{ p.successful_requests.toLocaleString() }}</td>
						<td class="usage-failed">{{ p.failed_requests.toLocaleString() }}</td>
						<td>{{ formatNumberWithCommas(p.tokens, 0, false) }}</td>
					</tr>
				</tbody>
			</table>
		</div>
	</UiCard>
</template>
