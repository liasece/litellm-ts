<script setup lang="ts">
import { computed, ref } from "vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiTag from "../../platform/ui/UiTag.vue";
import UiHeroIcon from "../../platform/ui/UiHeroIcon.vue";
import UiCheckbox from "../../platform/ui/UiCheckbox.vue";
import UiDialog from "../../platform/ui/UiDialog.vue";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import { modelDisplayName } from "../logic/ModelDataLogic";
import { modelString, type DisplayProxyModel, type ModelCatalog } from "../support/ModelModels";
import type { ModelHealthStore } from "../stores/ModelHealthStore";
const healthColumns = [
	{ key: "id", label: "Model ID", sortable: true },
	{ key: "model", label: "Model Name", sortable: true },
	{ key: "team", label: "Team Alias", sortable: true },
	{ key: "status", label: "Health Status", sortable: true },
	{ key: "error", label: "Error Details", sortable: false },
	{ key: "lastCheck", label: "Last Check", sortable: true },
	{ key: "lastSuccess", label: "Last Success", sortable: true },
	{ key: "actions", label: "Actions", sortable: false },
] as const;
const props = defineProps<{ models: DisplayProxyModel[]; catalog: ModelCatalog; health: ModelHealthStore }>();
defineEmits<{ select: [id: string] }>();
const selected = ref<string[]>([]),
	detail = ref<{ id: string; success: boolean } | null>(null),
	warning = ref(false),
	sortKey = ref(""),
	descending = ref(false);
const ids = computed(() => props.models.map((model) => modelString(model.model_info.id)).filter(Boolean));
const allSelected = computed(() => ids.value.length > 0 && ids.value.every((id) => selected.value.includes(id)));
function toggle(id: string, checked: boolean) {
	selected.value = checked ? [...new Set([...selected.value, id])] : selected.value.filter((value) => value !== id);
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
const rows = computed(() =>
	[...props.models].sort((a, b) => {
		if (!sortKey.value) return 0;
		function value(model: DisplayProxyModel) {
			const id = modelString(model.model_info.id),
				status = props.health.state.statuses[id];
			if (sortKey.value === "id") return id;
			if (sortKey.value === "model") return modelDisplayName(model);
			if (sortKey.value === "team") return modelString(model.model_info.team_id);
			if (sortKey.value === "status")
				return String(
					({ healthy: 0, checking: 1, unknown: 2, unhealthy: 3 } as Record<string, number>)[status?.status ?? "none"] ?? 4,
				);
			return status?.[sortKey.value === "lastCheck" ? "lastCheck" : "lastSuccess"] ?? "None";
		}
		return value(a).localeCompare(value(b), undefined, { numeric: true }) * (descending.value ? -1 : 1);
	}),
);
function sort(key: string) {
	descending.value = key === sortKey.value ? !descending.value : false;
	sortKey.value = key;
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
		<div class="model-table-overflow model-health-table-wrap">
			<table class="model-simple-table model-health-table" :style="{ width: healthColumns.length * 150 + 'px' }">
				<thead>
					<tr>
						<th v-for="column in healthColumns" :key="column.key">
							<div class="model-health-sort">
								<UiCheckbox
									v-if="column.key === 'id'"
									:model-value="allSelected"
									:indeterminate="selected.length > 0 && !allSelected"
									label="Select all models"
									@update:model-value="all"
								/>
								<button v-if="column.sortable" class="model-health-sort-button" @click="sort(column.key)">
									<span>{{ column.label }}</span>
									<UiHeroIcon
										:name="
											sortKey === column.key
												? descending
													? 'ChevronDownIcon'
													: 'ChevronUpIcon'
												: 'SwitchVerticalIcon'
										"
										:size="16"
										class="model-health-sort-icon"
										:class="{ 'is-active': sortKey === column.key }"
									/>
								</button>
								<span v-else>{{ column.label }}</span>
							</div>
						</th>
					</tr>
				</thead>
				<tbody>
					<tr v-for="model in rows" :key="model.model_info.id ?? model.model_name">
						<td>
							<div class="model-inline">
								<UiCheckbox
									:model-value="selected.includes(modelString(model.model_info.id))"
									:label="'Select ' + model.model_name"
									@update:model-value="toggle(modelString(model.model_info.id), $event)"
								/><button class="model-id model-mono" @click="$emit('select', modelString(model.model_info.id))">
									{{ model.model_info.id }}
								</button>
							</div>
						</td>
						<td>
							<strong>{{ modelDisplayName(model) }}</strong>
						</td>
						<td class="model-health-team" :class="{ 'model-health-team--empty': !model.model_info.team_id }">
							{{
								catalog.teams.find((team) => team.team_id === model.model_info.team_id)?.team_alias ||
								model.model_info.team_id ||
								"-"
							}}
						</td>
						<td>
							<span v-if="status(modelString(model.model_info.id))?.loading" class="model-muted">Checking...</span>
							<div v-else class="model-inline">
								<UiTag
									appearance="tremor"
									:color="
										status(modelString(model.model_info.id))?.status === 'healthy'
											? 'emerald'
											: status(modelString(model.model_info.id))?.status === 'unhealthy'
												? 'red'
												: 'gray'
									"
									>{{ status(modelString(model.model_info.id))?.status || "none" }}</UiTag
								><button
									v-if="
										status(modelString(model.model_info.id))?.status === 'healthy' &&
										status(modelString(model.model_info.id))?.successResponse
									"
									class="model-icon-button model-success"
									aria-label="View response details"
									@click="detail = { id: modelString(model.model_info.id), success: true }"
								>
									<UiHeroIcon name="InformationCircleIcon" :size="16" />
								</button>
							</div>
						</td>
						<td>
							<div v-if="status(modelString(model.model_info.id))?.error" class="model-inline model-error">
								<UiTooltip :title="status(modelString(model.model_info.id))?.error"
									><span class="model-health-error">{{
										status(modelString(model.model_info.id))?.error
									}}</span></UiTooltip
								><button
									v-if="
										status(modelString(model.model_info.id))?.fullError !==
										status(modelString(model.model_info.id))?.error
									"
									class="model-icon-button"
									aria-label="View full error details"
									@click="detail = { id: modelString(model.model_info.id), success: false }"
								>
									<UiHeroIcon name="InformationCircleIcon" :size="16" />
								</button>
							</div>
							<span v-else class="model-health-no-errors">No errors</span>
						</td>
						<td class="model-health-last-date">
							{{
								status(modelString(model.model_info.id))?.loading
									? "Check in progress..."
									: status(modelString(model.model_info.id))?.lastCheck || "None"
							}}
						</td>
						<td class="model-health-last-date">{{ status(modelString(model.model_info.id))?.lastSuccess || "None" }}</td>
						<td>
							<button
								class="model-run-health"
								data-testid="run-health-check-btn"
								:aria-label="'Run health check for ' + model.model_name"
								:disabled="status(modelString(model.model_info.id))?.loading"
								@click="health.one(modelString(model.model_info.id))"
							>
								<UiHeroIcon
									:name="
										status(modelString(model.model_info.id))?.status &&
										status(modelString(model.model_info.id))?.status !== 'none'
											? 'RefreshIcon'
											: 'PlayIcon'
									"
									:size="16"
								/>
							</button>
						</td>
					</tr>
					<tr v-if="!rows.length">
						<td colspan="8" class="model-table-empty">No deployments available</td>
					</tr>
				</tbody>
			</table>
		</div>
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
.model-health-table-wrap {
	border: 1px solid #dcddeb;
	border-radius: 8px;
	position: relative;
}
.model-health-table {
	min-width: 100%;
	table-layout: fixed;
}
.model-health-table th {
	width: 150px;
}
.model-health-table th:last-child,
.model-health-table td:last-child {
	position: sticky;
	right: 0;
	width: 120px;
	background: white;
	box-shadow: -4px 0 8px -6px rgb(0 0 0 / 10%);
}
.model-health-table th,
.model-health-table td {
	padding: 8px 16px;
}
.model-health-table tbody td {
	height: 48px;
}
.model-health-table th button {
	font: inherit;
	color: inherit;
	white-space: nowrap;
}
.model-health-table td > strong {
	font-size: 14px;
	line-height: 20px;
	font-weight: 500;
	color: inherit;
}
.model-health-table .model-id {
	width: 15ch;
	max-width: 15ch;
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
.model-health-sort {
	display: flex;
	align-items: center;
	gap: 8px;
}
.model-health-sort-button {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
	flex: 1;
	min-width: 0;
	padding: 0;
}
.model-health-sort-icon {
	color: #9ca3af;
}
.model-health-sort-icon.is-active {
	color: #3b82f6;
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
.model-health-table tbody tr:first-child td {
	border-top: 0;
}
</style>
