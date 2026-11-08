<script setup lang="ts">
import "../styles/UsageTablesStyles.css";
import { nextTick, onBeforeUnmount, ref } from "vue";
import notifications from "../../notifications/logic/NotificationManager";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import UiDialog from "../../platform/ui/UiDialog.vue";
import UsageChart from "./charts/UsageChartComponent.vue";
import { useMoneyFormatter } from "../../platform/stores/PriceDisplayStore";
import { virtualKeysApi } from "../../virtual-keys/api/VirtualKeysApi";
import { loadKeyCatalog } from "../../virtual-keys/data/KeyCatalogData";
import { emptyKeyCatalog, type VirtualKey } from "../../virtual-keys/support/VirtualKeyModels";
import KeyDetailDrawer from "../../virtual-keys/ui/KeyDetailDrawerComponent.vue";
import "../../virtual-keys/ui/styles/VirtualKeysStyles.css";
import type { KeyRanking } from "../support/UsageModels";
defineProps<{ rows: KeyRanking[]; showTags?: boolean }>();
const money = useMoneyFormatter(),
	mode = ref("table"),
	expanded = ref(new Set<string>()),
	key = ref<VirtualKey | null>(null),
	catalog = ref(emptyKeyCatalog()),
	open = ref(false),
	detailsOpen = ref(false);
let generation = 0;
function tags(row: KeyRanking) {
	const all = [...row.tags].sort((a, b) => b.usage - a.usage);
	return expanded.value.has(row.api_key) ? all : all.slice(0, 2);
}
function toggle(token: string) {
	const next = new Set(expanded.value);
	if (next.has(token)) next.delete(token);
	else next.add(token);
	expanded.value = next;
}
async function show(token: string) {
	const current = ++generation;
	try {
		const [detail, options] = await Promise.all([virtualKeysApi.keyInfo(token), loadKeyCatalog()]);
		if (current !== generation) return;
		key.value = detail;
		catalog.value = options;
		open.value = true;
		await nextTick();
		if (current === generation) detailsOpen.value = true;
	} catch (error: unknown) {
		if (current === generation) notifications.fromBackend(error instanceof Error ? error.message : "Error fetching key info");
	}
}
function close() {
	generation++;
	open.value = false;
	detailsOpen.value = false;
	key.value = null;
}
onBeforeUnmount(() => generation++);
</script>
<template>
	<div class="usage-key-mode">
		<div class="usage-segmented">
			<button aria-label="Table View" :class="{ active: mode === 'table' }" @click="mode = 'table'">Table</button
			><button aria-label="Chart View" :class="{ active: mode === 'chart' }" @click="mode = 'chart'">Chart</button>
		</div>
	</div>
	<div v-if="mode === 'table'" class="usage-key-table usage-data-table">
		<div class="usage-key-table-frame">
			<table>
				<thead>
					<tr>
						<th>Key ID</th>
						<th>Key Alias</th>
						<th v-if="showTags">Tags</th>
						<th>Spend</th>
					</tr>
				</thead>
				<tbody>
					<tr v-for="row in rows" :key="row.api_key">
						<td>
							<div class="usage-key-id-cell">
								<UiTooltip :title="row.api_key" class="usage-key-id-trigger"
									><button class="usage-key-id" @click="show(row.api_key)">
										<span>{{ row.api_key ? row.api_key.slice(0, 7) + "..." : "-" }}</span>
									</button></UiTooltip
								>
							</div>
						</td>
						<td>{{ row.key_alias || "-" }}</td>
						<td v-if="showTags">
							<span v-if="!row.tags.length">-</span>
							<div v-else class="usage-key-tags">
								<UiTooltip
									v-for="tag in tags(row)"
									:key="tag.tag"
									:title="'Tag Name: ' + tag.tag + '\nSpend: ' + money(tag.usage, 2)"
									><span>{{ tag.tag.slice(0, 7) }}...</span></UiTooltip
								><button
									v-if="row.tags.length > 2"
									:title="expanded.has(row.api_key) ? 'Show fewer tags' : 'Show all tags'"
									@click="toggle(row.api_key)"
								>
									<UiIcon :name="expanded.has(row.api_key) ? 'UpOutlined' : 'DownOutlined'" :size="12" />
								</button>
							</div>
						</td>
						<td>{{ money(row.spend, 2) }}</td>
					</tr>
					<tr v-if="!rows.length">
						<td :colspan="showTags ? 4 : 3" class="usage-no-logs">No logs found</td>
					</tr>
				</tbody>
			</table>
		</div>
	</div>
	<div v-else class="usage-ranking-scroll">
		<UsageChart
			v-if="rows.length"
			:data="
				rows.map((row) => ({
					...row,
					display_key_alias:
						row.key_alias && row.key_alias.length > 10 ? row.key_alias.slice(0, 10) + '...' : row.key_alias || '-',
				}))
			"
			index="display_key_alias"
			:categories="['spend']"
			horizontal
			ranking
			tooltip-tone="dark"
			:height="Math.max(40, rows.length * 40)"
			:y-axis-width="120"
			:format="(v) => money(v, 2)"
			@select="(row) => show(String(row.api_key))"
			><template #tooltip="{ row }"
				><div class="usage-key-tooltip">
					<p>Key Alias: {{ row.key_alias }}</p>
					<p>Key ID: {{ row.api_key }}</p>
					<p>Spend: {{ money(Number(row.spend), 2) }}</p>
				</div></template
			></UsageChart
		>
	</div>
	<UiDialog
		v-model:open="open"
		:width="1152"
		scroll-mode="overlay"
		centered
		:closable="false"
		:show-footer="false"
		aria-label="Virtual key details"
		class="usage-key-detail"
		data-usage-key-shell
		@cancel="close"
		><button class="usage-key-detail-close" aria-label="Close" @click="close"><UiIcon name="CloseOutlined" :size="24" /></button
	></UiDialog>
	<KeyDetailDrawer v-model:open="detailsOpen" :key-data="key" :catalog="catalog" @close="close" @deleted="close" />
</template>
