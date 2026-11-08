<script setup lang="ts">
import { computed, ref } from "vue";
import UiDialog from "../../platform/ui/UiDialog.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import { useApplicationStore } from "../../application/stores/ApplicationStore";
import notifications from "../../notifications/logic/NotificationManager";
import { generateExportData, generateMetadata, exportCsv, downloadUsage } from "../logic/UsageExportLogic";
import type { DateRangeValue } from "../../date-range/support/DateRangeModels";
import type { DailyActivityResponse, EntityType } from "../support/UsageModels";
import type { ExportFormat, ExportScope } from "../support/UsageExportModels";
const props = withDefaults(
	defineProps<{
		open: boolean;
		entityType: EntityType;
		data: DailyActivityResponse;
		dateRange: DateRangeValue;
		selectedFilters?: string[];
		customTitle?: string;
	}>(),
	{ selectedFilters: () => [], customTitle: undefined },
);
const emit = defineEmits<{ "update:open": [value: boolean] }>();
const app = useApplicationStore(),
	format = ref<ExportFormat>("csv"),
	scope = ref<ExportScope>("daily"),
	exporting = ref(false);
const label = computed(() => props.entityType.charAt(0).toUpperCase() + props.entityType.slice(1));
const aliases = computed(() => Object.fromEntries(app.state.teams.filter((t) => t.team_alias).map((t) => [t.team_id, t.team_alias!])));
const types = computed(() => [
	{
		value: "daily" as const,
		title: "Day-by-day breakdown by " + props.entityType,
		description: "Daily metrics for each " + props.entityType,
	},
	{
		value: "daily_with_keys" as const,
		title: "Day-by-day breakdown by " + props.entityType + " and key",
		description: "Daily metrics for each " + props.entityType + ", split by API key",
	},
	{
		value: "daily_with_models" as const,
		title: "Day-by-day by " + props.entityType + " and model",
		description: "Daily metrics split by model",
	},
]);
function close() {
	emit("update:open", false);
}
function setFormat(value: unknown) {
	if (value === "csv" || value === "json") format.value = value;
}
function save() {
	exporting.value = true;
	try {
		const rows = generateExportData(props.data, scope.value, label.value, aliases.value);
		if (format.value === "csv") downloadUsage(exportCsv(rows), "text/csv;charset=utf-8;", props.entityType, scope.value, "csv");
		else
			downloadUsage(
				JSON.stringify(
					{
						metadata: generateMetadata(props.entityType, props.dateRange, props.selectedFilters, scope.value, props.data),
						data: rows,
					},
					null,
					2,
				),
				"application/json",
				props.entityType,
				scope.value,
				"json",
			);
		notifications.success(label.value + " usage data exported successfully as " + format.value.toUpperCase());
		close();
	} catch {
		notifications.fromBackend("Failed to export data");
	} finally {
		exporting.value = false;
	}
}
</script>
<template>
	<UiDialog
		:open="open"
		scroll-mode="overlay"
		:title="customTitle || 'Export ' + label + ' Usage'"
		:width="480"
		:show-footer="false"
		class="usage-export-dialog"
		@update:open="emit('update:open', $event)"
		><div class="usage-export-form">
			<p class="usage-export-summary">
				{{ dateRange.from?.toLocaleDateString() }} - {{ dateRange.to?.toLocaleDateString()
				}}<template v-if="selectedFilters.length">
					· {{ selectedFilters.length }} filter{{ selectedFilters.length > 1 ? "s" : "" }}</template
				>
			</p>
			<fieldset>
				<legend>Export type</legend>
				<label v-for="type in types" :key="type.value"
					><span class="usage-export-radio"
						><input v-model="scope" type="radio" name="usage-export-scope" :value="type.value" /></span
					><span class="usage-export-option"
						><b>{{ type.title }}</b
						><small>{{ type.description }}</small></span
					></label
				>
			</fieldset>
			<div>
				<label class="usage-export-label">Format</label
				><UiSelect
					:model-value="format"
					:options="[
						{ value: 'csv', label: 'CSV (Excel, Google Sheets)' },
						{ value: 'json', label: 'JSON (includes metadata)' },
					]"
					@update:model-value="setFormat"
				/>
			</div>
			<footer>
				<UiButton :disabled="exporting" @click="close">Cancel</UiButton
				><UiButton variant="primary" :loading="exporting" :disabled="exporting" @click="save">{{
					exporting ? "Exporting..." : "Export " + format.toUpperCase()
				}}</UiButton>
			</footer>
		</div></UiDialog
	>
</template>
