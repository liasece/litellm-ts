<script setup lang="ts">
import { computed } from "vue";
import UiTable from "../../platform/ui/UiTable.vue";
import UiTag from "../../platform/ui/UiTag.vue";
import type { UiTableColumn, UiTableRow } from "../../platform/ui/UiTypes";
import { privacyBreakdownLabel, privacyBreakdownNote, privacyCount, privacyKindTone, privacyShare } from "../logic/PrivacyLogic";
import type { PrivacyBreakdownRow } from "../support/PrivacyModels";
defineOptions({ name: "PrivacyBreakdownComponent" });
const props = defineProps<{ dimension: "client" | "provider" | "kind"; rows: readonly PrivacyBreakdownRow[]; emptyText: string }>();
const total = computed(() => props.rows.reduce((sum, row) => sum + row.occurrences, 0));
const columns = computed<readonly UiTableColumn[]>(() => [
	{ key: "name", label: props.dimension === "client" ? "客户端" : props.dimension === "provider" ? "提供方" : "类型", width: "38%" },
	{ key: "occurrences", label: "处数", width: "20%", align: "right" },
	{ key: "detail", label: "明细", width: "42%", align: "right" },
]);
const tableRows = computed<readonly UiTableRow[]>(() =>
	props.rows.map((row) => ({
		id: row.name,
		name: privacyBreakdownLabel(props.dimension, row.name),
		occurrences: privacyCount(row.occurrences),
		detail: privacyBreakdownNote(props.dimension, row) + " · " + privacyShare(row.occurrences, total.value),
	})),
);
</script>
<template>
	<UiTable :columns="columns" :rows="tableRows" row-key="id" :empty-text="emptyText" compact>
		<template #cell-name="{ row }">
			<UiTag v-if="dimension === 'kind'" :color="privacyKindTone(String(row.id))">{{ row.name }}</UiTag>
			<template v-else>{{ row.name }}</template>
		</template>
	</UiTable>
</template>
