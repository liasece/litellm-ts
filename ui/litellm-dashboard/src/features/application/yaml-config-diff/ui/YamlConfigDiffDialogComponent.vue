<script setup lang="ts">
import UiDialog from "../../../platform/ui/UiDialog.vue";
import UiButton from "../../../platform/ui/UiButton.vue";
import UiTag from "../../../platform/ui/UiTag.vue";
import UiTable from "../../../platform/ui/UiTable.vue";
import type { UiTableColumn, UiTableRow } from "../../../platform/ui/UiTypes";
import message from "../../../notifications/logic/MessageManager";
import { yamlDiffKindLabels, formatYamlDiffValue, yamlDiffRowKey } from "../logic/YamlConfigDiffLogic";
import type { createYamlConfigDiffStore } from "../stores/YamlConfigDiffStore";
import "./YamlConfigDiffStyles.css";
const props = defineProps<{ store: ReturnType<typeof createYamlConfigDiffStore> }>();
const state = props.store.state;
const columns: UiTableColumn[] = [
	{ key: "section", label: "段", width: 160 },
	{ key: "key", label: "键", width: 180 },
	{ key: "diff_kind", label: "差异类型", width: 110 },
	{ key: "yaml_value", label: "yaml 值" },
	{ key: "db_value", label: "DB 值" },
	{ key: "action", label: "操作", width: 90 },
];
const rowKey = (row: UiTableRow) => yamlDiffRowKey({ section: row.section, key: row.key });
function kind(value: unknown) {
	return yamlDiffKindLabels[String(value)] ?? { label: String(value), color: "default" };
}
async function accept(row: UiTableRow) {
	try {
		await props.store.accept(String(row.section), String(row.key));
	} catch (error) {
		message.error("接受失败: " + (error instanceof Error ? error.message : String(error)));
	}
}
async function resolve() {
	try {
		await props.store.resolve();
	} catch (error) {
		message.error("操作失败: " + (error instanceof Error ? error.message : String(error)));
	}
}
</script>
<template>
	<UiDialog
		:open="state.open"
		title="检测到 yaml 配置与数据库不一致"
		:width="1100"
		scroll-mode="overlay"
		class="application-yaml-diff"
		@cancel="store.close"
		@update:open="!$event && store.close()"
	>
		<p class="application-yaml-diff-description">
			启动时检测到 yaml 配置文件与数据库中的设置存在以下差异。逐项点击「接受」可将 yaml 值覆盖到数据库并立即生效；
			处理完成后点击「处理冲突完成」保存当前 yaml 快照。
		</p>
		<UiTable
			:columns="columns"
			:rows="state.items"
			:row-key="rowKey"
			compact
			sticky-header
			:body-max-height="400"
			class="application-yaml-diff-table"
		>
			<template #cell-diff_kind="{ row }"
				><UiTag :color="kind(row.diff_kind).color">{{ kind(row.diff_kind).label }}</UiTag></template
			>
			<template #cell-yaml_value="{ row }"
				><code>{{ formatYamlDiffValue(row.yaml_value) }}</code></template
			>
			<template #cell-db_value="{ row }"
				><code>{{ formatYamlDiffValue(row.db_value) }}</code></template
			>
			<template #cell-action="{ row }"
				><UiButton size="small" :loading="state.acceptingKey === rowKey(row)" @click="accept(row)">接受</UiButton></template
			>
		</UiTable>
		<template #footer><UiButton variant="primary" :loading="state.resolving" @click="resolve">处理冲突完成</UiButton></template>
	</UiDialog>
</template>
