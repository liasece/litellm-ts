<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from "vue";
import UiAlert from "../../platform/ui/UiAlert.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiEmptyState from "../../platform/ui/UiEmptyState.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiSpinner from "../../platform/ui/UiSpinner.vue";
import UiTag from "../../platform/ui/UiTag.vue";
import ModelName from "../../providers/ui/ModelNameComponent.vue";
import ProviderIdentityComponent from "../../providers/ui/ProviderIdentityComponent.vue";
import UsageQuotaWindows from "./UsageQuotaWindowsComponent.vue";
import { createUpstreamQuotaStore } from "../stores/UpstreamQuotaStore";
import { groupQuotaAccountRows, quotaAccountRows, type QuotaAccountRow } from "../logic/UsageQuotaRowsLogic";
import { useMoneyFormatter } from "../../platform/stores/PriceDisplayStore";
const props = defineProps<{ enabled: boolean }>(),
	store = createUpstreamQuotaStore(),
	{ state } = store,
	money = useMoneyFormatter();
// 进入页面先按缓存铺表再后台刷新，之后由 store 内的调度器定时轮询（间隔见 UPSTREAM_QUOTA_POLL_INTERVAL_MS）。
watch(
	() => props.enabled,
	(value) => {
		if (value) store.start();
	},
	{ immediate: true },
);
onBeforeUnmount(() => store.dispose());
const rows = computed(() =>
	quotaAccountRows({
		providers: state.providers,
		accounts: state.accounts,
		quotas: state.quotas,
		formatUsd: (value) => money(value, 2),
	}),
);
const groups = computed(() => groupQuotaAccountRows(rows.value));
// 点比进度条更亮并带呼吸动画（颜色与动画都在 UsageQuotaStyles.css 里）：
// 红=有窗口真正用完，黄=有窗口不高于 33%，绿=全部高于 33%。
function urgencyLabel(row: QuotaAccountRow): string {
	if (row.urgency === "critical") return "Quota exhausted · a window is used up";
	const lowest = row.lowestPercent === null ? "" : ` · lowest window ${Math.round(row.lowestPercent)}% remaining`;
	if (row.urgency === "warning") return "Quota low" + lowest;
	return "Quota healthy · all windows above 33%";
}
</script>
<template>
	<!-- 独立页面：没有数据时也要留住页头和刷新按钮，否则整页空白看不出是没配置还是没加载。 -->
	<section v-if="enabled" class="usage-upstream-quota" data-testid="upstream-account-quota">
		<header>
			<div>
				<h4>Upstream account quota</h4>
				<p>Remaining quota and balance for subscription accounts and built-in provider keys, grouped by upstream provider.</p>
			</div>
			<UiButton :loading="state.refreshing" data-testid="upstream-quota-refresh" @click="store.load(true)"
				><template #icon><UiIcon name="ReloadOutlined" /></template>Refresh</UiButton
			>
		</header>
		<UiAlert v-if="state.accountsError" type="warning" title="Subscription accounts unavailable">{{ state.accountsError }}</UiAlert>
		<UiAlert v-if="state.builtInError" type="warning" title="Built-in provider quota unavailable">{{ state.builtInError }}</UiAlert>
		<UiEmptyState
			v-if="!groups.length && !state.builtInError && !state.accountsError && state.refreshing"
			description="Loading upstream account quota…"
		/>
		<UiEmptyState v-else-if="!groups.length" description="No subscription accounts or built-in provider keys to report quota for" />
		<div v-else class="usage-quota-table-wrap">
			<table class="usage-quota-table">
				<colgroup>
					<col />
					<col />
					<!-- 只有 Quota windows 吃剩余宽度，其余列由内容决定。 -->
					<col class="usage-quota-col--windows" />
					<col />
					<col />
				</colgroup>
				<thead>
					<tr>
						<th scope="col">Account</th>
						<th scope="col">Type</th>
						<th scope="col">Quota windows</th>
						<th scope="col">Balances</th>
						<th scope="col">Updated</th>
					</tr>
				</thead>
				<tbody>
					<template v-for="group in groups" :key="group.provider">
						<tr class="usage-quota-band">
							<th colspan="5" scope="colgroup">
								<span class="usage-quota-band-label"
									><ProviderIdentityComponent :provider="group.provider" :tag="false" /><span
										class="usage-quota-band-count"
										:aria-label="group.rows.length + ' accounts'"
										>{{ group.rows.length }}</span
									></span
								>
							</th>
						</tr>
						<tr v-for="row in group.rows" :key="row.key" :data-testid="row.testid">
							<td class="usage-quota-cell--account">
								<div class="usage-quota-account">
									<div class="usage-quota-account-name">
										<strong :title="row.name">{{ row.name }}</strong>
										<span
											v-if="row.urgency"
											class="usage-quota-urgency"
											:class="'usage-quota-urgency--' + row.urgency"
											:title="urgencyLabel(row)"
											role="img"
											:aria-label="urgencyLabel(row)"
										/>
									</div>
									<small v-if="row.models.length" class="usage-quota-models" :title="row.models.join(', ')">
										<ModelName
											v-for="model in row.models"
											:key="model"
											class="usage-quota-model"
											:model="model"
											:provider="row.provider"
											:size="12"
										/>
									</small>
									<small v-if="row.warning" class="usage-quota-row-warning" :title="row.warning">{{ row.warning }}</small>
									<small v-if="row.error" class="usage-quota-row-error" :title="row.error">{{ row.error }}</small>
								</div>
							</td>
							<td class="usage-quota-cell--type">
								<div class="usage-quota-type">
									<UiTag>{{ row.kind }}</UiTag>
									<UiTag v-if="row.plan" color="blue">{{ row.plan }}</UiTag>
									<small v-if="row.expires">Expires {{ new Date(row.expires).toLocaleDateString() }}</small>
								</div>
							</td>
							<td class="usage-quota-cell--windows">
								<UsageQuotaWindows v-if="row.windows.length" :windows="row.windows" />
								<UiSpinner v-else-if="row.loading" />
								<span v-else-if="!row.error" class="usage-quota-muted">No quota details</span>
							</td>
							<td class="usage-quota-cell--balances">
								<div v-if="row.balances.length" class="usage-quota-balances">
									<div v-for="b in row.balances" :key="b.label + '-' + b.remaining">
										<small>{{ b.label }}</small
										><span>{{ b.remaining }}</span>
										<small v-if="b.details?.length">{{ b.details.join(" · ") }}</small>
									</div>
								</div>
								<span v-else class="usage-quota-muted">—</span>
							</td>
							<td class="usage-quota-cell--updated">
								<small v-if="row.updated" class="usage-quota-updated">{{ new Date(row.updated).toLocaleString() }}</small>
								<span v-else class="usage-quota-muted">—</span>
							</td>
						</tr>
					</template>
				</tbody>
			</table>
		</div>
	</section>
</template>
