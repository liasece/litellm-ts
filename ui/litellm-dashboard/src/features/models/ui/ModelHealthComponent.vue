<script setup lang="ts">
import { computed, ref } from "vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiTag from "../../platform/ui/UiTag.vue";
import UiTable from "../../platform/ui/UiTable.vue";
import { filterRowsByFields } from "../../platform/ui/UiTableFilterLogic";
import type { UiTableActiveFilter, UiTableFilterField } from "../../platform/ui/UiTableFilterModels";
import type { UiTableColumn, UiTableRow, UiTableSort } from "../../platform/ui/UiTypes";
import UiHeroIcon from "../../platform/ui/UiHeroIcon.vue";
import UiDialog from "../../platform/ui/UiDialog.vue";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import { deploymentIconProps, modelDisplayName } from "../logic/ModelDataLogic";
import ModelName from "../../providers/ui/ModelNameComponent.vue";
import { modelString, type DisplayProxyModel, type ModelCatalog } from "../support/ModelModels";
import type { ModelHealthStore } from "../stores/ModelHealthStore";
const healthColumns: readonly {
	key: string;
	label: string;
	width: number;
	sortable: boolean;
	filters?: readonly UiTableFilterField[];
	sticky?: "right";
}[] = [
	{
		key: "id",
		label: "Model ID",
		width: 150,
		sortable: true,
		filters: [{ key: "id", label: "Model ID", control: { kind: "text", placeholder: "Filter model ID" } }],
	},
	{
		key: "model",
		label: "Model Name",
		width: 150,
		sortable: true,
		filters: [{ key: "model", label: "Model Name", control: { kind: "text", placeholder: "Filter model name" } }],
	},
	{
		key: "team",
		label: "Team Alias",
		width: 150,
		sortable: true,
		filters: [{ key: "team", label: "Team Alias", control: { kind: "text", placeholder: "Filter team alias" } }],
	},
	{
		key: "status",
		label: "Health Status",
		width: 150,
		sortable: true,
		filters: [
			{
				key: "status",
				label: "Health Status",
				control: {
					kind: "select",
					options: [
						{ value: "healthy", label: "Healthy" },
						{ value: "unhealthy", label: "Unhealthy" },
						{ value: "checking", label: "Checking" },
						{ value: "unknown", label: "Unknown" },
						{ value: "none", label: "Not checked" },
					],
				},
			},
		],
	},
	{ key: "error", label: "Error Details", width: 220, sortable: false },
	{ key: "lastCheck", label: "Last Check", width: 150, sortable: true },
	{ key: "lastSuccess", label: "Last Success", width: 150, sortable: true },
	{ key: "actions", label: "Actions", width: 120, sortable: false, sticky: "right" },
] as const;
const props = defineProps<{ models: DisplayProxyModel[]; catalog: ModelCatalog; health: ModelHealthStore }>();
defineEmits<{ select: [id: string] }>();
const selected = ref<string[]>([]),
	detail = ref<{ id: string; success: boolean } | null>(null),
	warning = ref(false),
	sortKey = ref(""),
	sortOrder = ref<"asc" | "desc" | null>(null),
	activeFilters = ref<UiTableActiveFilter[]>([]);
const ids = computed(() => props.models.map((model) => modelString(model.model_info.id)).filter(Boolean));
const tableColumns: readonly UiTableColumn[] = healthColumns.map((column) => ({
	key: column.key,
	label: column.label,
	width: column.width,
	sortable: column.sortable,
	initialSortOrder: column.key === "lastCheck" || column.key === "lastSuccess" ? "desc" : "asc",
	filters: column.filters,
	sticky: column.sticky,
}));
function modelRow(row: UiTableRow): DisplayProxyModel {
	return row as unknown as DisplayProxyModel;
}
function modelId(row: UiTableRow): string {
	return modelString(modelRow(row).model_info.id);
}
function selectionLabel(row: UiTableRow): string {
	return "Select " + modelRow(row).model_name;
}
function selectModel(keys: (string | number)[]): void {
	selected.value = keys.map(String);
}
function all(checked: boolean) {
	selected.value = checked ? [...ids.value] : [];
}
async function run() {
	if (!ids.value.length) {
		warning.value = true;
		return;
	}
	if (selected.value.length > 0 && selected.value.length < ids.value.length) await props.health.selected(selected.value);
	else await props.health.all();
}
function healthValue(model: DisplayProxyModel, key: string): string {
	const id = modelString(model.model_info.id),
		status = props.health.state.statuses[id];
	if (key === "id") return id;
	if (key === "model") return modelDisplayName(model);
	if (key === "team")
		return (
			props.catalog.teams.find((team) => team.team_id === model.model_info.team_id)?.team_alias ||
			modelString(model.model_info.team_id)
		);
	if (key === "status") return status?.status ?? "none";
	return String(status?.[key === "lastCheck" ? "lastCheck" : "lastSuccess"] ?? "None");
}
const filteredModels = computed(() => filterRowsByFields(props.models, activeFilters.value, (model, key) => healthValue(model, key)));
const rows = computed(() => {
	if (!sortKey.value || !sortOrder.value) return filteredModels.value;
	const direction = sortOrder.value === "asc" ? 1 : -1;
	const statusRank = { healthy: 0, checking: 1, unknown: 2, unhealthy: 3, none: 4 } as Record<string, number>;
	return [...filteredModels.value].sort((a, b) => {
		const left = sortKey.value === "status" ? (statusRank[healthValue(a, "status")] ?? 4) : healthValue(a, sortKey.value);
		const right = sortKey.value === "status" ? (statusRank[healthValue(b, "status")] ?? 4) : healthValue(b, sortKey.value);
		if (typeof left === "number" && typeof right === "number") return (left - right) * direction;
		return String(left).localeCompare(String(right), undefined, { numeric: true }) * direction;
	});
});
function changeSort(next: UiTableSort): void {
	sortKey.value = next.order ? next.key : "";
	sortOrder.value = next.order;
}
const emptyText = computed(() => (activeFilters.value.length ? "No models match the current filters" : "No deployments available"));
function applyHealthFilters(entries: readonly UiTableActiveFilter[]): void {
	const next = activeFilters.value.filter((filter) => !entries.some((entry) => entry.key === filter.key));
	for (const entry of entries) {
		if (entry.value.trim())
			next.push({
				...entry,
				value: entry.value.trim(),
				text: entry.text || entry.value.trim(),
				...(entry.key === "model" ? { iconModel: entry.value.trim() } : {}),
			});
	}
	activeFilters.value = next;
}
function removeHealthFilter(key: string): void {
	activeFilters.value = activeFilters.value.filter((filter) => filter.key !== key);
}
function clearHealthFilters(): void {
	activeFilters.value = [];
}
const selectedModel = computed(() => props.models.find((model) => model.model_info.id === detail.value?.id));
const selectedStatus = computed(() => props.health.state.statuses[detail.value?.id ?? ""]);
function status(id: string) {
	return props.health.state.statuses[id];
}
</script>
<template>
	<section class="model-health">
		<header class="model-health-heading">
			<div>
				<h3 class="model-title">Model Health Status</h3>
				<p class="model-text">Run health checks on individual models to verify they are working correctly</p>
			</div>
			<div class="model-inline">
				<UiButton v-if="selected.length" appearance="tremor" variant="text" size="small" @click="all(false)"
					>Clear Selection</UiButton
				><UiButton
					appearance="tremor"
					size="small"
					:disabled="Object.values(health.state.statuses).some((value) => value.loading)"
					@click="run"
					>{{ selected.length > 0 && selected.length < ids.length ? "Run Selected Checks" : "Run All Checks" }}</UiButton
				>
			</div>
		</header>
		<UiTable
			class="model-health-table"
			:columns="tableColumns"
			:rows="rows"
			:row-key="modelId"
			selection="multiple"
			:selected-keys="selected"
			:selection-label="selectionLabel"
			:active-filters="activeFilters"
			:empty-text="emptyText"
			fixed-layout
			manual-sort
			:sort-by="sortKey || undefined"
			:sort-order="sortOrder ?? 'asc'"
			@update:selected-keys="selectModel"
			@sort="changeSort"
			@filter-change="applyHealthFilters"
			@remove-filter="removeHealthFilter"
			@clear-filters="clearHealthFilters"
		>
			<template #cell-id="{ row }">
				<button class="model-id model-mono" @click="$emit('select', modelId(row))">
					{{ modelRow(row).model_info.id }}
				</button>
			</template>
			<template #cell-model="{ row }">
				<ModelName
					v-bind="deploymentIconProps(modelRow(row))"
					:name="modelDisplayName(modelRow(row))"
					:size="16"
					variant="strong"
				/>
			</template>
			<template #cell-team="{ row }">
				<span class="model-health-team" :class="{ 'model-health-team--empty': !modelRow(row).model_info.team_id }">
					{{
						catalog.teams.find((team) => team.team_id === modelRow(row).model_info.team_id)?.team_alias ||
						modelRow(row).model_info.team_id ||
						"-"
					}}
				</span>
			</template>
			<template #cell-status="{ row }">
				<span v-if="status(modelId(row))?.loading" class="model-muted">Checking...</span>
				<div v-else class="model-inline">
					<UiTag
						appearance="tremor"
						:color="
							status(modelId(row))?.status === 'healthy'
								? 'emerald'
								: status(modelId(row))?.status === 'unhealthy'
									? 'red'
									: 'gray'
						"
						>{{ status(modelId(row))?.status || "none" }}</UiTag
					><button
						v-if="status(modelId(row))?.status === 'healthy' && status(modelId(row))?.successResponse"
						class="model-icon-button model-success"
						aria-label="View response details"
						@click="detail = { id: modelId(row), success: true }"
					>
						<UiHeroIcon name="InformationCircleIcon" :size="16" />
					</button>
				</div>
			</template>
			<template #cell-error="{ row }">
				<div v-if="status(modelId(row))?.error" class="model-inline model-error">
					<UiTooltip :title="status(modelId(row))?.error"
						><span class="model-health-error">{{ status(modelId(row))?.error }}</span></UiTooltip
					><button
						v-if="status(modelId(row))?.fullError !== status(modelId(row))?.error"
						class="model-icon-button"
						aria-label="View full error details"
						@click="detail = { id: modelId(row), success: false }"
					>
						<UiHeroIcon name="InformationCircleIcon" :size="16" />
					</button>
				</div>
				<span v-else class="model-health-no-errors">No errors</span>
			</template>
			<template #cell-lastCheck="{ row }">
				<span class="model-health-last-date">{{
					status(modelId(row))?.loading ? "Check in progress..." : status(modelId(row))?.lastCheck || "None"
				}}</span>
			</template>
			<template #cell-lastSuccess="{ row }">
				<span class="model-health-last-date">{{ status(modelId(row))?.lastSuccess || "None" }}</span>
			</template>
			<template #cell-actions="{ row }">
				<button
					class="model-run-health"
					data-testid="run-health-check-btn"
					:aria-label="'Run health check for ' + modelRow(row).model_name"
					:disabled="status(modelId(row))?.loading"
					@click="health.one(modelId(row))"
				>
					<UiHeroIcon
						:name="status(modelId(row))?.status && status(modelId(row))?.status !== 'none' ? 'RefreshIcon' : 'PlayIcon'"
						:size="16"
					/>
				</button>
			</template>
		</UiTable>
		<UiDialog
			:open="!!detail"
			:title="
				'Health Check ' + (detail?.success ? 'Response' : 'Error') + ' - ' + (selectedModel ? modelDisplayName(selectedModel) : '')
			"
			:width="800"
			scroll-mode="overlay"
			:show-footer="false"
			@update:open="!$event && (detail = null)"
			><div class="model-health-detail">
				<p>{{ detail?.success ? "Status:" : "Error:" }}</p>
				<div :class="detail?.success ? 'model-health-result-success' : 'model-health-result-error'">
					{{ detail?.success ? "Health check passed successfully" : selectedStatus?.error }}
				</div>
				<p>{{ detail?.success ? "Response Details:" : "Full Error Details:" }}</p>
				<pre>{{ detail?.success ? JSON.stringify(selectedStatus?.successResponse, null, 2) : selectedStatus?.fullError }}</pre>
				<div class="model-text-right"><UiButton @click="detail = null">Close</UiButton></div>
			</div></UiDialog
		><UiDialog v-model:open="warning" title="No deployments available" :show-footer="false" scroll-mode="overlay"
			><p>Add a deployment before running health checks.</p>
			<div class="model-text-right"><UiButton variant="primary" @click="warning = false">OK</UiButton></div></UiDialog
		>
	</section>
</template>

<style scoped>
.model-health-heading {
	display: flex;
	align-items: center;
	justify-content: space-between;
	margin-bottom: 24px;
}
.model-health-heading .model-text {
	margin-top: 4px;
	color: #4b5563;
}
.model-health-heading > .model-inline {
	gap: 12px;
}
.model-run-health {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	padding: 8px;
	border-radius: 6px;
	color: #4f46e5;
}
.model-run-health:hover {
	color: #4338ca;
	background: #eef2ff;
}
.model-run-health:disabled {
	color: #9ca3af;
	background: #f3f4f6;
	cursor: not-allowed;
}
.model-health-error {
	max-width: 200px;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font-size: 14px;
	line-height: 20px;
}
.model-health-detail {
	font-size: 12.4px;
	line-height: 18.4px;
}
.model-health-detail > p {
	font-weight: 500;
	margin-bottom: 8px;
}
.model-health-result-success,
.model-health-result-error {
	border: 1px solid;
	border-radius: 6px;
	padding: 12px;
	margin-bottom: 16px;
}
.model-health-result-success {
	background: #f0fdf4;
	border-color: #bbf7d0;
	color: #166534;
}
.model-health-result-error {
	background: #fef2f2;
	border-color: #fecaca;
	color: #991b1b;
}
.model-health-detail pre {
	padding: 12px;
	background: #f9fafb;
	border: 1px solid #e5e7eb;
	border-radius: 6px;
	max-height: 384px;
	overflow: auto;
	white-space: pre-wrap;
	font-size: 14px;
	line-height: 20px;
	color: #1f2937;
	margin-bottom: 16px;
}
.model-health-heading .ui-button {
	padding: 4px 12px;
	font-size: 14px;
	line-height: 20px;
}
.model-health-table .ui-checkbox {
	min-height: 22px;
}
.model-health-team,
.model-health-no-errors,
.model-health-last-date {
	font-size: 14px;
	line-height: 20px;
}
.model-health-team--empty,
.model-health-no-errors {
	color: #9ca3af;
}
.model-health-table .model-health-last-date {
	color: #4b5563;
}
</style>
