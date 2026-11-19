<script setup lang="ts">
import { computed } from "vue";
import { copyText } from "../../content/logic/ClipboardLogic";
import UiActiveFilters from "../../platform/ui/UiActiveFilters.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiHeaderFilterButton from "../../platform/ui/UiHeaderFilterButton.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiHeroIcon from "../../platform/ui/UiHeroIcon.vue";
import UiTable from "../../platform/ui/UiTable.vue";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import ModelHealthBadge from "./ModelHealthBadgeComponent.vue";
import ModelListCards from "./ModelListCardsComponent.vue";
import ModelFamilyLabel from "../../providers/ui/ModelFamilyLabelComponent.vue";
import ModelCostCell from "./ModelCostCellComponent.vue";
import ModelCredentialCell from "./ModelCredentialCellComponent.vue";
import ModelName from "../../providers/ui/ModelNameComponent.vue";
import UpstreamModelHint from "./UpstreamModelHintComponent.vue";
import { formatTokenCount } from "../support/UpstreamModelInfoModels";
import { deploymentIconProps, modelDisplayName } from "../logic/ModelDataLogic";
import { familyOfModel, groupByModelFamily, type ModelFamilyGroup } from "../../providers/logic/ModelFamilyGrouping";
import { modelString, modelStrings, type ModelCatalog, type DisplayProxyModel } from "../support/ModelModels";
import type { UiTableActiveFilter, UiTableFilterField } from "../../platform/ui/UiTableFilterModels";
import type { UiTableColumn, UiTableRow, UiTableSort } from "../../platform/ui/UiTypes";
import type { ModelsStore } from "../stores/ModelsStore";
import type { ModelHealthStore } from "../stores/ModelHealthStore";
const props = defineProps<{
	store: ModelsStore;
	catalog: ModelCatalog;
	health: ModelHealthStore;
	admin: boolean;
	userId: string;
	/** 订阅账号页的 `/ui` 前缀；订阅部署的 Credentials 列链到对应 Provider 的账号。 */
	subscriptionsBase?: string;
}>();
const emit = defineEmits<{
	select: [id: string];
	fallback: [model: DisplayProxyModel];
	override: [model: DisplayProxyModel];
	convert: [model: DisplayProxyModel];
	delete: [model: DisplayProxyModel];
	settings: [];
	credential: [name: string];
	healthDetail: [id: string];
	refresh: [];
}>();
const rows = props.store.displayed(props.catalog);
/**
 * 转换会把这条模型换成别名，先写别名再删部署，所以既要有可删的库内部署，
 * 也要有写路由配置的权限；配置模型（db_model 为 false）只能回配置文件处理。
 */
function convertible(model: DisplayProxyModel): boolean {
	return props.admin && model.model_info.db_model !== false && Boolean(modelString(model.model_info.override_model_name));
}
interface ModelColumn {
	key: string;
	label: string;
	/** 列宽下限：表头单行放得下、常规内容不截断；容器更宽时各列按下限等比放大。 */
	minWidth: number;
	sortable?: boolean;
	filters?: readonly UiTableFilterField[];
	tooltip?: string;
	sticky?: "left" | "right";
}
const columns: readonly ModelColumn[] = [
	// 下限按每列最长的真实内容与单行表头定：Costs 要放下三个价格芯片，
	// 而 Fallback / Override 常常只有「-」，按内容最长的列反而留下大块空白。
	{ key: "model_info.id", label: "Model ID", minWidth: 118 },
	{ key: "model_name", label: "Model Information", minWidth: 230, sortable: true },
	{ key: "fallback", label: "Fallback", minWidth: 152 },
	{ key: "override", label: "Model Override", minWidth: 126 },
	{
		key: "credentials",
		label: "Credentials",
		minWidth: 134,
		tooltip:
			"Reusable: A saved credential is attached to this model. Subscription: the provider account is managed on the Subscriptions page. Manual: Credentials are configured directly on the model.",
	},
	{ key: "health", label: "Health Status", minWidth: 116 },
	{
		key: "input_cost",
		label: "Costs",
		minWidth: 272,
		sortable: true,
		tooltip:
			"Cost per 1M tokens: input, output and cache read. The database icon appears when a price came from the upstream model info.",
	},
	{
		key: "limits",
		label: "Limits",
		minWidth: 126,
		tooltip: "Context window and max output tokens. Hover the database icon to see the values the upstream reported.",
	},
	// 表头保持单行：「Model Access Group」单行要 181px，短名 + 筛选图标实测 140px。
	{ key: "access_groups", label: "Access Group", minWidth: 142 },
	{ key: "actions", label: "Actions", minWidth: 88, sticky: "right" },
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
		label: "Access Group",
		control: {
			kind: "select",
			searchable: true,
			options: accessGroups.value.map((group) => ({ value: group, label: group })),
		},
	},
]);
/** 手机端没有表头：筛选与排序入口移到工具条，数据与列定义保持同一来源。 */
const mobileFilterFields = computed<readonly UiTableFilterField[]>(() => [...modelColumnFilters.value, ...accessGroupFilters.value]);
const mobileSortOptions = computed(() => [
	{ value: "model_name:asc", label: "Model Name \u2191" },
	{ value: "model_name:desc", label: "Model Name \u2193" },
	{ value: "costs:asc", label: "Costs \u2191" },
	{ value: "costs:desc", label: "Costs \u2193" },
]);
const mobileSortValue = computed(() =>
	props.store.state.sortBy ? (props.store.state.sortBy === "costs" ? "costs" : "model_name") + ":" + props.store.state.sortOrder : "",
);
function changeMobileSort(value: unknown): void {
	const [key, order] = typeof value === "string" ? value.split(":") : [];
	if (!key || (order !== "asc" && order !== "desc")) return;
	props.store.setSort(key === "costs" ? "input_cost" : key, order);
}
const tableColumns = computed<readonly UiTableColumn[]>(() =>
	columns.map((column) => ({
		key: column.key,
		label: column.label,
		minWidth: column.minWidth,
		sortable: column.sortable,
		initialSortOrder: column.key === "input_cost" ? "desc" : "asc",
		tooltip: column.tooltip,
		sticky: column.sticky,
		filters:
			column.key === "model_name" ? modelColumnFilters.value : column.key === "access_groups" ? accessGroupFilters.value : undefined,
	})),
);
const sortKey = computed(() => (props.store.state.sortBy === "costs" ? "input_cost" : props.store.state.sortBy));
/**
 * 列表按品牌家族成组排布：未识别品牌的条目在最前，其余按家族名排序，组内保留服务端排序。
 * 分页是服务端行为，所以分组范围是当前页。
 */
const familyGroups = computed<ModelFamilyGroup<DisplayProxyModel>[]>(() =>
	groupByModelFamily(rows.value, (model) => {
		const identity = deploymentIconProps(model);
		return familyOfModel(identity.model, identity.baseModel);
	}),
);
const familyByRowKey = computed(
	() => new Map(familyGroups.value.map((group) => [String(group.items[0].model_info.id ?? group.items[0].model_name), group])),
);
function familyBand(row: UiTableRow): ModelFamilyGroup<DisplayProxyModel> | undefined {
	return familyByRowKey.value.get(modelRowKey(row));
}
const orderedRows = computed<readonly DisplayProxyModel[]>(() => familyGroups.value.flatMap((group) => group.items));
const tableRows = computed<readonly UiTableRow[]>(() => orderedRows.value as unknown as readonly UiTableRow[]);
const activeFilters = computed<UiTableActiveFilter[]>(() => {
	const entries: UiTableActiveFilter[] = [];
	if (props.store.state.search)
		entries.push({
			key: "search",
			label: "Model Name",
			value: props.store.state.search,
			text: props.store.state.search,
			match: "fuzzy",
			iconModel: props.store.state.search,
		});
	if (props.store.state.group !== "all")
		entries.push({
			key: "group",
			label: "Public Model Name",
			value: props.store.state.group,
			text: props.store.state.group === "wildcard" ? "Wildcard Models (*)" : props.store.state.group,
			match: "exact",
			...(props.store.state.group === "wildcard" ? {} : { iconModel: props.store.state.group }),
		});
	if (props.store.state.accessGroup)
		entries.push({
			key: "accessGroup",
			label: "Access Group",
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
function changeSort(next: UiTableSort): void {
	props.store.setSort(next.key, next.order);
}
function modelRow(row: UiTableRow): DisplayProxyModel {
	return row as unknown as DisplayProxyModel;
}
function modelRowKey(row: UiTableRow): string {
	const model = modelRow(row);
	return String(model.model_info.id ?? model.model_name);
}
function toggleExpanded(id: string) {
	props.store.toggleExpanded(id);
}
function fallbackNames(model: DisplayProxyModel) {
	return modelStrings(model.model_info.fallbacks);
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
			<div class="model-mobile-controls">
				<button type="button" class="model-mobile-refresh" aria-label="Refresh models" @click="emit('refresh')">
					<UiHeroIcon name="RefreshIcon" :size="14" />
				</button>
				<UiHeaderFilterButton label="Models" :fields="mobileFilterFields" :active="activeFilters" @change="applyModelFilters" />
				<UiSelect
					class="model-mobile-sort"
					size="large"
					:model-value="mobileSortValue || null"
					:options="mobileSortOptions"
					placeholder="Sort models"
					aria-label="Sort models"
					@update:model-value="changeMobileSort"
				/>
			</div>
			<UiActiveFilters
				v-if="activeFilters.length"
				class="model-mobile-active"
				:filters="activeFilters"
				@remove="removeModelFilter"
				@clear="store.clearFilters"
			/>
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
		<UiTable
			class="model-desktop-table"
			:columns="tableColumns"
			:rows="tableRows"
			:row-key="modelRowKey"
			:loading="store.state.loading"
			loading-text="🚅 Loading models..."
			fixed-layout
			resizable
			manual-sort
			:column-widths="store.state.widths"
			:sort-by="store.state.sortBy ? sortKey : undefined"
			:sort-order="store.state.sortOrder"
			:active-filters="activeFilters"
			:empty-text="store.state.error || 'No models available'"
			@sort="changeSort"
			@column-resize="store.setColumnWidth"
			@filter-change="applyModelFilters"
			@remove-filter="removeModelFilter"
			@clear-filters="store.clearFilters"
		>
			<template #row="{ row }">
				<tr v-if="familyBand(row)" class="model-family-band">
					<th :colspan="tableColumns.length" scope="colgroup">
						<ModelFamilyLabel :family="familyBand(row)?.family ?? null" :count="familyBand(row)?.items.length ?? 0" />
					</th>
				</tr>
				<tr
					v-for="model in [modelRow(row)]"
					:key="model.model_info.id ?? model.model_name"
					class="ui-table__row ui-table__row--clickable"
					@click="select(model)"
				>
					<td>
						<UiTooltip :title="modelString(model.model_info.id)"
							><button class="model-id" @click.stop="select(model)">{{ model.model_info.id }}</button></UiTooltip
						>
					</td>
					<td>
						<div class="model-info-cell">
							<div>
								<div class="model-information-name">
									<ModelName
										v-bind="deploymentIconProps(model)"
										:name="modelDisplayName(model)"
										:size="24"
										:truncate="true"
									/><button
										class="model-icon-button"
										aria-label="Copy model name"
										@click.stop="copy(modelDisplayName(model))"
									>
										<UiIcon name="CopyOutlined" :size="12" />
									</button>
								</div>
								<ModelName
									v-if="model.litellm_model_name"
									class="model-secondary-name"
									:model="model.litellm_model_name"
									:provider="model.provider"
									:size="14"
									:truncate="true"
								/>
							</div>
						</div>
					</td>
					<td>
						<div class="model-inline model-muted">
							<span v-if="fallbackNames(model).length" class="model-fallback-list"
								><ModelName
									v-for="fallback in fallbackNames(model)"
									:key="fallback"
									class="model-fallback-name"
									:model="fallback"
									:size="14"
									:truncate="true" /></span
							><span v-else>-</span
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
							<ModelName
								v-if="model.model_info.override_model_name"
								class="model-fallback-name"
								:model="model.model_info.override_model_name"
								:size="14"
								:truncate="true"
							/><span v-else>-</span
							><button
								v-if="admin"
								class="model-icon-button"
								:aria-label="'Edit override for ' + model.model_name"
								@click.stop="emit('override', model)"
							>
								<UiIcon name="EditOutlined" :size="12" /></button
							><UiTooltip v-if="convertible(model)" title="Convert this model into an alias with the same target"
								><button
									class="model-icon-button model-convert-button"
									:aria-label="'Convert ' + model.model_name + ' to an alias'"
									@click.stop="emit('convert', model)"
								>
									<UiIcon name="SwapOutlined" :size="12" /></button
							></UiTooltip>
						</div>
					</td>
					<td>
						<ModelCredentialCell
							:model="model"
							:subscriptions-base="subscriptionsBase"
							@credential="emit('credential', $event)"
						/>
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
						<ModelCostCell :model="model" />
					</td>
					<td class="model-limits-cell">
						<p>
							Ctx: {{ formatTokenCount(model.context_window) }}
							<UpstreamModelHint
								:model="model.model_name"
								:record="model.upstream_model_info"
								field="max_input_tokens"
								:label="modelDisplayName(model)"
							/>
						</p>
						<p>
							Out: {{ formatTokenCount(model.max_output_tokens) }}
							<UpstreamModelHint
								:model="model.model_name"
								:record="model.upstream_model_info"
								field="max_output_tokens"
								:label="modelDisplayName(model)"
							/>
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
					<td class="model-table-actions ui-table__cell--sticky-right">
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
			</template>
		</UiTable>
		<div class="model-mobile-only">
			<div v-if="store.state.loading" class="model-cards-state">🚅 Loading models...</div>
			<div v-else-if="!rows.length" class="model-cards-state">{{ store.state.error || "No models available" }}</div>
			<ModelListCards
				v-else
				:groups="familyGroups"
				:health="health"
				:admin="admin"
				:user-id="userId"
				:subscriptions-base="subscriptionsBase"
				@select="emit('select', $event)"
				@fallback="emit('fallback', $event)"
				@override="emit('override', $event)"
				@convert="emit('convert', $event)"
				@delete="emit('delete', $event)"
				@credential="emit('credential', $event)"
			/>
		</div>
	</section>
</template>
