<script setup lang="ts">
import { computed } from "vue";
import { copyText } from "../../content/logic/ClipboardLogic";
import UiButton from "../../platform/ui/UiButton.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiActiveFilters from "../../platform/ui/UiActiveFilters.vue";
import UiHeaderFilterButton from "../../platform/ui/UiHeaderFilterButton.vue";
import UiHeroIcon from "../../platform/ui/UiHeroIcon.vue";
import UiTableSortLabel from "../../platform/ui/UiTableSortLabel.vue";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import UiSpinner from "../../platform/ui/UiSpinner.vue";
import ModelHealthBadge from "./ModelHealthBadgeComponent.vue";
import { usePriceDisplayStore } from "../../platform/stores/PriceDisplayStore";
import { getModelLogoAndName } from "../../providers/logic/ProviderIdentityLogic";
import { modelDisplayName, modelPriceIdentity } from "../logic/ModelDataLogic";
import { modelString, modelStrings, type ModelCatalog, type DisplayProxyModel } from "../support/ModelModels";
import type { UiTableActiveFilter, UiTableFilterField } from "../../platform/ui/UiTableFilterModels";
import type { ModelsStore } from "../stores/ModelsStore";
import type { ModelHealthStore } from "../stores/ModelHealthStore";
const props = defineProps<{ store: ModelsStore; catalog: ModelCatalog; health: ModelHealthStore; admin: boolean; userId: string }>();
const emit = defineEmits<{
	select: [id: string];
	fallback: [model: DisplayProxyModel];
	override: [model: DisplayProxyModel];
	delete: [model: DisplayProxyModel];
	settings: [];
	credential: [name: string];
	healthDetail: [id: string];
}>();
const price = usePriceDisplayStore(),
	rows = props.store.displayed(props.catalog);
interface ModelColumn {
	key: string;
	label: string;
	width: number;
	sortable?: boolean;
	filters?: readonly UiTableFilterField[];
}
const columns: readonly ModelColumn[] = [
	{ key: "model_info.id", label: "Model ID", width: 130 },
	{ key: "model_name", label: "Model Information", width: 250, sortable: true },
	{ key: "fallback", label: "Fallback", width: 180 },
	{ key: "override", label: "Model Override", width: 180 },
	{ key: "credentials", label: "Credentials", width: 180 },
	{ key: "health", label: "Health Status", width: 120 },
	{ key: "input_cost", label: "Costs", width: 120, sortable: true },
	{ key: "access_groups", label: "Model Access Group", width: 180 },
];
const groups = computed(() => [...new Set(props.store.state.rows.map((model) => model.model_name))].sort());
const accessGroups = computed(() => [...new Set(props.store.state.rows.flatMap((model) => model.model_info.access_groups ?? []))].sort());
const modelColumnFilters = computed<readonly UiTableFilterField[]>(() => [
	{ key: "search", label: "Model Name", control: { kind: "text", placeholder: "Search model names…" } },
	{
		key: "group",
		label: "Public Model Name",
		control: {
			kind: "select",
			searchable: true,
			options: [
				{ value: "wildcard", label: "Wildcard Models (*)" },
				...groups.value.map((group) => ({ value: group, label: group })),
			],
		},
	},
]);
const accessGroupFilters = computed<readonly UiTableFilterField[]>(() => [
	{
		key: "accessGroup",
		label: "Model Access Group",
		control: {
			kind: "select",
			searchable: true,
			options: accessGroups.value.map((group) => ({ value: group, label: group })),
		},
	},
]);
const activeFilters = computed<UiTableActiveFilter[]>(() => {
	const entries: UiTableActiveFilter[] = [];
	if (props.store.state.search)
		entries.push({
			key: "search",
			label: "Model Name",
			value: props.store.state.search,
			text: props.store.state.search,
			match: "fuzzy",
		});
	if (props.store.state.group !== "all")
		entries.push({
			key: "group",
			label: "Public Model Name",
			value: props.store.state.group,
			text: props.store.state.group === "wildcard" ? "Wildcard Models (*)" : props.store.state.group,
			match: "exact",
		});
	if (props.store.state.accessGroup)
		entries.push({
			key: "accessGroup",
			label: "Model Access Group",
			value: props.store.state.accessGroup,
			text: props.store.state.accessGroup,
			match: "exact",
		});
	return entries;
});
function applyModelFilters(entries: readonly UiTableActiveFilter[]): void {
	for (const entry of entries) {
		if (entry.key === "search") props.store.search(entry.value);
		if (entry.key === "group") props.store.setGroup(entry.value || "all");
		if (entry.key === "accessGroup") props.store.setAccessGroup(entry.value);
	}
}
function removeModelFilter(key: string): void {
	if (key === "search") props.store.search("");
	if (key === "group") props.store.setGroup("all");
	if (key === "accessGroup") props.store.setAccessGroup("");
}
const teamOptions = computed(() => [
	{ value: "personal", label: "Personal" },
	...props.catalog.teams.map((team) => ({ value: team.team_id, label: team.team_alias || team.team_id })),
]);
const teamName = computed(() =>
	props.store.state.team === "personal"
		? "Personal"
		: props.catalog.teams.find((team) => team.team_id === props.store.state.team)?.team_alias || props.store.state.team,
);
const tableWidth = computed(() => columns.reduce((sum, col) => sum + (props.store.state.widths[col.key] ?? col.width), 0) + 120);
function sortState(column: ModelColumn): "asc" | "desc" | false {
	const key = column.key === "input_cost" ? "costs" : column.key;
	return column.sortable && props.store.state.sortBy === key ? props.store.state.sortOrder : false;
}
function ariaSort(column: ModelColumn): "ascending" | "descending" | "none" | undefined {
	if (!column.sortable) return undefined;
	const key = column.key === "input_cost" ? "costs" : column.key;
	if (props.store.state.sortBy !== key) return "none";
	return props.store.state.sortOrder === "asc" ? "ascending" : "descending";
}
function changeSort(key: string, order: "asc" | "desc" | false): void {
	props.store.setSort(key, order || null);
}
function resize(event: PointerEvent, key: string, width: number) {
	event.preventDefault();
	event.stopPropagation();
	const start = event.clientX;
	function move(next: PointerEvent) {
		props.store.setColumnWidth(key, width + next.clientX - start);
	}
	function end() {
		document.removeEventListener("pointermove", move);
		document.removeEventListener("pointerup", end);
	}
	document.addEventListener("pointermove", move);
	document.addEventListener("pointerup", end, { once: true });
}
function toggleExpanded(id: string) {
	props.store.toggleExpanded(id);
}
function fallbackNames(model: DisplayProxyModel) {
	return modelStrings(model.model_info.fallbacks);
}
function linkCredential(name: unknown) {
	const value = modelString(name);
	if (value) emit("credential", value);
}
function select(model: DisplayProxyModel) {
	const id = model.model_info.id;
	if (id) emit("select", id);
}
function copy(value: string) {
	void copyText(value).catch(() => undefined);
}
async function all() {
	await props.health.all();
}
</script>
<template>
	<section class="model-list-card">
		<div class="model-scope">
			<div class="model-scope__row">
				<div class="model-scope__choice">
					<label>Current Team:</label>
					<div class="model-team-select">
						<UiSelect
							:model-value="store.state.team"
							:options="teamOptions"
							size="large"
							aria-label="Current Team"
							@update:model-value="store.team(modelString($event))"
						>
							<template #selected="{ option }"
								><span
									class="model-choice-dot"
									:class="option.value === 'personal' ? 'model-dot-blue' : 'model-dot-green'"
								/>{{ option.label }}</template
							>
							<template #option="{ option }"
								><span
									class="model-choice-dot"
									:class="option.value === 'personal' ? 'model-dot-blue' : 'model-dot-green'"
								/>{{ option.label }}</template
							>
						</UiSelect>
					</div>
				</div>
				<div class="model-scope__choice">
					<label>View:</label>
					<div class="model-view-select">
						<UiSelect
							:model-value="store.state.viewMode"
							:options="[
								{ value: 'current_team', label: 'Current Team Models' },
								{ value: 'all', label: 'All Available Models' },
							]"
							size="large"
							aria-label="View"
							@update:model-value="store.setView(modelString($event))"
						>
							<template #selected="{ option }"
								><span
									class="model-choice-dot"
									:class="option.value === 'current_team' ? 'model-dot-purple' : 'model-dot-gray'"
								/>{{ option.label }}</template
							>
						</UiSelect>
					</div>
				</div>
			</div>
			<p v-if="store.state.viewMode === 'current_team'" class="model-scope__hint">
				<UiIcon name="InfoCircleOutlined" :size="12" />
				<span
					>To access these models: Create a Virtual Key<template v-if="store.state.team !== 'personal'">
						and select Team as "{{ teamName }}"</template
					>
					on the <a href="/public?login=success&page=api-keys">Virtual Keys page</a></span
				>
			</p>
		</div>
		<div class="model-toolbar">
			<div class="model-toolbar__row">
				<div class="model-inline">
					<UiButton :loading="health.state.allLoading" @click="all">Run All Checks</UiButton
					><UiButton aria-label="Model settings" title="Model Settings" @click="emit('settings')"
						><template #icon><UiIcon name="SettingOutlined" /></template
					></UiButton>
				</div>
			</div>
			<div class="model-pagination">
				<span>{{
					store.state.total > 0
						? "Showing " +
							((store.state.page - 1) * store.state.size + 1) +
							" - " +
							Math.min(store.state.page * store.state.size, store.state.total) +
							" of " +
							store.state.total +
							" results"
						: "Showing 0 results"
				}}</span>
				<div>
					<button :disabled="store.state.page === 1 || store.state.loading" @click="store.page(store.state.page - 1)">
						Previous</button
					><button
						:disabled="store.state.page >= Math.max(1, Math.ceil(store.state.total / store.state.size)) || store.state.loading"
						@click="store.page(store.state.page + 1)"
					>
						Next
					</button>
				</div>
			</div>
		</div>
		<UiActiveFilters v-if="activeFilters.length" :filters="activeFilters" @remove="removeModelFilter" @clear="store.clearFilters" />
		<div class="model-table-overflow">
			<table class="model-list-table" :style="{ width: tableWidth + 'px', minWidth: '100%' }">
				<colgroup>
					<col
						v-for="column in columns"
						:key="column.key"
						:style="{ width: (store.state.widths[column.key] ?? column.width) + 'px' }"
					/>
					<col style="width: 120px" />
				</colgroup>
				<thead>
					<tr>
						<th v-for="column in columns" :key="column.key" :aria-sort="ariaSort(column)">
							<div class="model-table-header">
								<UiTableSortLabel
									v-if="column.sortable"
									:label="column.label"
									:state="sortState(column)"
									:initial="column.key === 'input_cost' ? 'desc' : 'asc'"
									@change="changeSort(column.key, $event)"
								/>
								<span v-else class="model-table-header__label"
									>{{ column.label
									}}<UiTooltip
										v-if="column.key === 'credentials'"
										content="Reusable: A saved credential is attached to this model. Manual: Credentials are configured directly on the model."
										><UiIcon name="InfoCircleOutlined" :size="12" /></UiTooltip
								></span>
								<UiHeaderFilterButton
									v-if="column.key === 'model_name'"
									:label="column.label"
									:fields="modelColumnFilters"
									:active="activeFilters.filter((filter) => filter.key === 'search' || filter.key === 'group')"
									@change="applyModelFilters"
								/>
								<UiHeaderFilterButton
									v-if="column.key === 'access_groups'"
									:label="column.label"
									:fields="accessGroupFilters"
									:active="activeFilters.filter((filter) => filter.key === 'accessGroup')"
									@change="applyModelFilters"
								/>
							</div>
							<span
								class="model-column-resize"
								@pointerdown="resize($event, column.key, store.state.widths[column.key] ?? column.width)"
							/>
						</th>
						<th class="model-table-actions">Actions</th>
					</tr>
				</thead>
				<tbody>
					<tr v-if="!rows.length">
						<td colspan="9" class="model-table-empty">
							<UiSpinner v-if="store.state.loading" /><span v-else>{{ store.state.error || "No models available" }}</span>
						</td>
					</tr>
					<tr v-for="model in rows" :key="model.model_info.id ?? model.model_name" @click="select(model)">
						<td>
							<UiTooltip :title="modelString(model.model_info.id)"
								><button class="model-id" @click.stop="select(model)">{{ model.model_info.id }}</button></UiTooltip
							>
						</td>
						<td>
							<div class="model-info-cell">
								<img
									v-if="getModelLogoAndName(model.provider, model.litellm_model_name || model.model_name).logo"
									:src="getModelLogoAndName(model.provider, model.litellm_model_name || model.model_name).logo"
									alt=""
									class="model-provider-logo"
								/>
								<div>
									<div class="model-information-name">
										{{ modelDisplayName(model)
										}}<button
											class="model-icon-button"
											aria-label="Copy model name"
											@click.stop="copy(modelDisplayName(model))"
										>
											<UiIcon name="CopyOutlined" :size="12" />
										</button>
									</div>
									<p class="model-secondary-name">{{ model.litellm_model_name }}</p>
								</div>
							</div>
						</td>
						<td>
							<div class="model-inline model-muted">
								<span>{{ fallbackNames(model).join(", ") || "-" }}</span
								><button
									v-if="admin"
									class="model-icon-button"
									:aria-label="'Edit fallbacks for ' + model.model_name"
									@click.stop="emit('fallback', model)"
								>
									<UiIcon name="EditOutlined" :size="12" />
								</button>
							</div>
						</td>
						<td>
							<div class="model-inline model-muted">
								<span>{{ model.model_info.override_model_name || "-" }}</span
								><button
									v-if="admin"
									class="model-icon-button"
									:aria-label="'Edit override for ' + model.model_name"
									@click.stop="emit('override', model)"
								>
									<UiIcon name="EditOutlined" :size="12" />
								</button>
							</div>
						</td>
						<td>
							<button
								v-if="model.litellm_params.litellm_credential_name"
								class="model-link model-inline"
								@click.stop="linkCredential(model.litellm_params.litellm_credential_name)"
							>
								<UiIcon name="SyncOutlined" />{{ model.litellm_params.litellm_credential_name }}</button
							><span v-else class="model-inline model-muted"><UiIcon name="EditOutlined" />Manual</span>
						</td>
						<td>
							<ModelHealthBadge
								:model-id="modelString(model.model_info.id)"
								:status="health.state.statuses[modelString(model.model_info.id)]"
								@check="health.one(modelString(model.model_info.id))"
								@detail="emit('healthDetail', modelString(model.model_info.id))"
							/>
						</td>
						<td class="model-cost-cell">
							<p>In: {{ model.input_cost == null ? "-" : price.format(model.input_cost, 4, modelPriceIdentity(model)) }}</p>
							<p>
								Out: {{ model.output_cost == null ? "-" : price.format(model.output_cost, 4, modelPriceIdentity(model)) }}
							</p>
							<p v-if="model.cache_read_input_cost != null">
								Cache read: {{ price.format(model.cache_read_input_cost, 4, modelPriceIdentity(model)) }}
							</p>
						</td>
						<td>
							<div class="model-access-badges">
								<span
									v-for="group in store.state.expanded.includes(modelString(model.model_info.id))
										? model.model_info.access_groups
										: model.model_info.access_groups?.slice(0, 1)"
									:key="group"
									class="model-badge model-badge--blue"
									>{{ group }}</span
								><button
									v-if="(model.model_info.access_groups?.length ?? 0) > 2"
									class="model-badge model-badge--gray"
									@click.stop="toggleExpanded(modelString(model.model_info.id))"
								>
									{{
										store.state.expanded.includes(modelString(model.model_info.id))
											? "−"
											: "+" + ((model.model_info.access_groups?.length ?? 0) - 1)
									}}
								</button>
							</div>
						</td>
						<td class="model-table-actions">
							<UiTooltip
								:title="
									model.model_info.db_model === false
										? 'Config model cannot be deleted on the dashboard. Please delete it from the config file.'
										: 'Delete model'
								"
								><button
									class="model-icon-button model-delete-button"
									:disabled="model.model_info.db_model === false || (!admin && model.model_info.created_by !== userId)"
									:aria-label="'Delete ' + model.model_name"
									@click.stop="emit('delete', model)"
								>
									<UiHeroIcon name="TrashIcon" :size="20" /></button
							></UiTooltip>
						</td>
					</tr>
				</tbody>
			</table>
		</div>
	</section>
</template>
