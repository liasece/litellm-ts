<script setup lang="ts">
import "../styles/UsageTablesStyles.css";
import { computed, nextTick, onBeforeUnmount, ref } from "vue";
import notifications from "../../notifications/logic/NotificationManager";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import UiDialog from "../../platform/ui/UiDialog.vue";
import UiTable from "../../platform/ui/UiTable.vue";
import type { UiTableColumn, UiTableRow } from "../../platform/ui/UiTypes";
import UsageChart from "./charts/UsageChartComponent.vue";
import { useMoneyFormatter } from "../../platform/stores/PriceDisplayStore";
import { virtualKeysApi } from "../../virtual-keys/api/VirtualKeysApi";
import { loadKeyCatalog } from "../../virtual-keys/data/KeyCatalogData";
import { emptyKeyCatalog, type VirtualKey } from "../../virtual-keys/support/VirtualKeyModels";
import KeyDetailDrawer from "../../virtual-keys/ui/KeyDetailDrawerComponent.vue";
import "../../virtual-keys/ui/styles/VirtualKeysStyles.css";
import type { KeyRanking } from "../support/UsageModels";
const props = defineProps<{ rows: KeyRanking[]; showTags?: boolean }>();
const money = useMoneyFormatter(),
	mode = ref("table"),
	columns = computed<readonly UiTableColumn[]>(() => [
		{ key: "api_key", label: "Key ID", width: 150 },
		{ key: "key_alias", label: "Key Alias", width: 140 },
		...(props.showTags ? [{ key: "tags", label: "Tags", width: 180 }] : []),
		{ key: "spend", label: "Spend", width: 90 },
	]),
	tableRows = computed<readonly UiTableRow[]>(() => props.rows as unknown as readonly UiTableRow[]),
	expanded = ref(new Set<string>()),
	key = ref<VirtualKey | null>(null),
	catalog = ref(emptyKeyCatalog()),
	open = ref(false),
	detailsOpen = ref(false);
let generation = 0;
function keyRow(row: UiTableRow): KeyRanking {
	return row as unknown as KeyRanking;
}
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
	<UiTable v-if="mode === 'table'" :columns="columns" :rows="tableRows" row-key="api_key" fixed-layout empty-text="No logs found">
		<template #cell-api_key="{ row }">
			<div class="usage-key-id-cell">
				<UiTooltip :title="keyRow(row).api_key" class="usage-key-id-trigger"
					><button class="usage-key-id" @click="show(keyRow(row).api_key)">
						<span>{{ keyRow(row).api_key ? keyRow(row).api_key.slice(0, 7) + "..." : "-" }}</span>
					</button></UiTooltip
				>
			</div>
		</template>
		<template #cell-key_alias="{ row }">{{ keyRow(row).key_alias || "-" }}</template>
		<template v-if="showTags" #cell-tags="{ row }">
			<span v-if="!keyRow(row).tags.length">-</span>
			<div v-else class="usage-key-tags">
				<UiTooltip
					v-for="tag in tags(keyRow(row))"
					:key="tag.tag"
					:title="'Tag Name: ' + tag.tag + '\nSpend: ' + money(tag.usage, 2)"
					><span>{{ tag.tag.slice(0, 7) }}...</span></UiTooltip
				><button
					v-if="keyRow(row).tags.length > 2"
					:title="expanded.has(keyRow(row).api_key) ? 'Show fewer tags' : 'Show all tags'"
					@click="toggle(keyRow(row).api_key)"
				>
					<UiIcon :name="expanded.has(keyRow(row).api_key) ? 'UpOutlined' : 'DownOutlined'" :size="12" />
				</button>
			</div>
		</template>
		<template #cell-spend="{ row }">{{ money(keyRow(row).spend, 2) }}</template>
	</UiTable>
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
