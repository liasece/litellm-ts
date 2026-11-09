<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch, type Component } from "vue";
import { useRoute } from "vue-router";
import { requestJson } from "../../platform/api/HttpApiClient";
import { useAuthenticationStore } from "../../identity/stores/AuthenticationStore";
import { useApplicationStore } from "../../application/stores/ApplicationStore";
import UiTabs from "../../platform/ui/UiTabs.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiAlert from "../../platform/ui/UiAlert.vue";
import FilterBarComponent from "../../filters/ui/FilterBarComponent.vue";
import PaginatedChoiceComponent from "../../selectors/ui/PaginatedChoiceComponent.vue";
import type { FilterOption, FilterValues } from "../../filters/support/FilterModels";
import { createLogsListStore } from "../stores/LogsListStore";
import { createLogsSettingsStore } from "../stores/LogsSettingsStore";
import { navigableSessionGroup } from "../logic/LogsIdentityLogic";
import { record } from "../logic/LogsPresentationLogic";
import { utcApiDate } from "../logic/LogsDateLogic";
import { ERROR_CODE_OPTIONS } from "../support/LogsConstants";
import type { LogEntry, SessionGroupRef } from "../support/LogsModels";
import LogsToolbarComponent from "./LogsToolbarComponent.vue";
import LogsPaginationComponent from "./LogsPaginationComponent.vue";
import LogsLiveBannerComponent from "./LogsLiveBannerComponent.vue";
import LogsTableComponent from "./LogsTableComponent.vue";
import LogsProviderWarningsComponent from "./LogsProviderWarningsComponent.vue";
import LogsSettingsDialogComponent from "./LogsSettingsDialogComponent.vue";
import KeyDetailDrawerComponent from "../../virtual-keys/ui/KeyDetailDrawerComponent.vue";
import { keyInfo } from "../../virtual-keys/api/VirtualKeysApi";
import type { VirtualKey } from "../../virtual-keys/support/VirtualKeyModels";
import "./LogsStyles.css";
const auth = useAuthenticationStore(),
	application = useApplicationStore(),
	route = useRoute();
const list = createLogsListStore({
	scope: () => ({ userId: auth.state.session?.user_id || "", role: auth.userRole.value }),
	search: window.location.search,
	writeUrl: (params) => {
		const search = params.toString(),
			url = window.location.pathname + (search ? "?" + search : "") + window.location.hash;
		if (url !== window.location.pathname + window.location.search + window.location.hash)
			window.history.replaceState(window.history.state, "", url);
	},
});
const settings = createLogsSettingsStore();
const selectedLog = ref<LogEntry | null>(null),
	selectedSession = ref<SessionGroupRef | null>(null),
	drawerOpen = ref(false),
	simulation = ref<SessionGroupRef | null>(null);
const auxiliary = import.meta.glob("./auxiliary/*Component.vue") as Record<string, () => Promise<{ default: Component }>>;
const detailFiles = import.meta.glob("./details/*Component.vue") as Record<string, () => Promise<{ default: Component }>>;
const details = detailFiles["./details/LogDetailsDrawerComponent.vue"]
	? defineAsyncComponent(detailFiles["./details/LogDetailsDrawerComponent.vue"])
	: null;
// The session drawer lives in details/session, which the details glob above does not match.
const simulationDrawer = defineAsyncComponent(() => import("./details/session/SessionSimulationDrawerComponent.vue"));
const auxiliaryComponents = Object.fromEntries(Object.entries(auxiliary).map(([name, load]) => [name, defineAsyncComponent(load)]));
const auxiliaryTabs = [
	{ key: "deleted-keys", file: "DeletedKeysComponent" },
	{ key: "deleted-teams", file: "DeletedTeamsComponent" },
];
const selectedKeyInfo = ref<VirtualKey | null>(null),
	selectedKeyHash = ref<string | null>(null),
	keyDrawerOpen = ref(false);
let keyGeneration = 0;
async function openKey(hash: string) {
	const current = ++keyGeneration;
	selectedKeyHash.value = hash;
	try {
		const info = await keyInfo(hash);
		if (current === keyGeneration) {
			selectedKeyInfo.value = info;
			keyDrawerOpen.value = true;
		}
	} catch (error: unknown) {
		if (current === keyGeneration)
			window.dispatchEvent(
				new CustomEvent("litellm-notification", {
					detail: { type: "error", message: error instanceof Error ? error.message : "Failed to load key" },
				}),
			);
	}
}
function closeKey() {
	keyGeneration++;
	selectedKeyHash.value = null;
	selectedKeyInfo.value = null;
	keyDrawerOpen.value = false;
}
const filterOptions = computed<FilterOption[]>(() => [
	{
		name: "Team ID",
		label: "Team ID",
		isSearchable: true,
		searchFn: async (term) =>
			application.state.teams.flatMap((team) => {
				const alias = record(team).team_alias,
					id = team.team_id;
				if (
					!id.toLowerCase().includes(term.toLowerCase()) &&
					!(typeof alias === "string" && alias.toLowerCase().includes(term.toLowerCase()))
				)
					return [];
				return [{ value: id, label: String(alias || id) + " (" + id + ")" }];
			}),
	},
	{
		name: "Status",
		label: "Status",
		options: [
			{ label: "In Progress", value: "in_progress" },
			{ label: "Success", value: "success" },
			{ label: "Failure", value: "failure" },
			{ label: "Aborted", value: "aborted" },
		],
	},
	{ name: "Model", label: "Model" },
	{ name: "Key Alias", label: "Key Alias" },
	{
		name: "End User",
		label: "End User",
		isSearchable: true,
		searchFn: async (term) => {
			const data = await requestJson("/customer/list");
			return Array.isArray(data)
				? data.flatMap((item) => {
						const id = record(item).user_id;
						return typeof id === "string" && id.toLowerCase().includes(term.toLowerCase()) ? [{ label: id, value: id }] : [];
					})
				: [];
		},
	},
	{
		name: "Error Code",
		label: "Error Code",
		isSearchable: true,
		searchFn: async (term) => {
			if (!term) return ERROR_CODE_OPTIONS;
			const options = ERROR_CODE_OPTIONS.filter((item) => item.label.toLowerCase().includes(term.toLowerCase()));
			return !ERROR_CODE_OPTIONS.some((item) => item.value === term.trim()) && term.trim()
				? [...options, { label: "Use custom code: " + term.trim(), value: term.trim() }]
				: options;
		},
	},
	{ name: "Key Hash", label: "Key Hash" },
	{ name: "Error Message", label: "Error Message" },
]);
const keyAliasSlot = "field-Key Alias";
function applyFilters(values: FilterValues) {
	list.applyFilters(values);
}
function selectLog(log: LogEntry) {
	selectedLog.value = log;
	selectedSession.value = navigableSessionGroup(log);
	drawerOpen.value = true;
}
function closeDrawer() {
	drawerOpen.value = false;
	selectedSession.value = null;
}
function selectSessionEvent(event: { request_id: string; timestamp: string; model?: string; status?: string }) {
	const group = simulation.value;
	if (!group) return;
	selectedLog.value = list.page.value.data.find((log) => log.request_id === event.request_id) ?? {
		request_id: event.request_id,
		startTime: event.timestamp,
		endTime: event.timestamp,
		model: event.model,
		status: event.status,
		call_type: "completion",
		spend: 0,
		total_tokens: 0,
		prompt_tokens: 0,
		completion_tokens: 0,
		metadata: event.status ? { status: event.status } : {},
		session_group_type: group.type,
		session_group_id: group.id,
	};
	selectedSession.value = group;
	simulation.value = null;
	drawerOpen.value = true;
}
function tab(value: string) {
	list.setTab(value === "request" ? "request logs" : value);
}
onMounted(() => {
	list.start();
	void settings.load();
});
onBeforeUnmount(() => {
	list.dispose();
	settings.dispose();
});
watch(
	() => route.fullPath,
	() => {
		list.restoreUrl(window.location.search);
	},
);
</script>
<template>
	<div class="logs-page">
		<UiTabs
			appearance="tremor"
			:model-value="list.state.activeTab === 'request logs' ? 'request' : list.state.activeTab"
			:items="[
				{ key: 'request', label: 'Request Logs' },
				{ key: 'deleted-keys', label: 'Deleted Keys' },
				{ key: 'deleted-teams', label: 'Deleted Teams' },
			]"
			@update:model-value="tab"
		>
			<div :hidden="list.state.activeTab !== 'request logs'">
				<div class="logs-heading">
					<h1>Request Logs</h1>
					<UiButton title="Spend Logs Settings" aria-label="Spend Logs Settings" @click="settings.show"
						><template #icon><UiIcon name="SettingOutlined" /></template
					></UiButton>
				</div>
				<LogsProviderWarningsComponent :logs="list.page.value.data" />
				<div :hidden="!!selectedKeyInfo">
					<FilterBarComponent
						:options="filterOptions"
						:values="list.state.filters"
						@apply="applyFilters"
						@reset="list.resetFilters"
					>
						<template #field-Model="{ value, update }"
							><PaginatedChoiceComponent
								kind="model"
								:model-value="value"
								placeholder="Select Model..."
								@update:model-value="update"
						/></template>
						<template #[keyAliasSlot]="{ value, update }"
							><PaginatedChoiceComponent
								kind="key-alias"
								:model-value="value"
								placeholder="Select Key Alias..."
								@update:model-value="update"
						/></template>
					</FilterBarComponent>
					<UiAlert v-if="list.state.error" type="error" style="margin-bottom: 16px">{{ list.state.error }}</UiAlert>
					<div class="logs-card">
						<div class="logs-controls">
							<div class="logs-controls-row" data-testid="logs-controls-row">
								<div class="logs-controls-toolbar">
									<LogsToolbarComponent
										:search-term="list.state.searchTerm"
										:start-time="list.state.startTime"
										:end-time="list.state.endTime"
										:custom-date="list.state.isCustomDate"
										:selected-interval="list.state.selectedTimeInterval"
										:live-tail-interval-ms="list.state.liveTailIntervalMs"
										:live-tail-enabled="list.state.liveTailEnabled"
										:fetching="list.state.fetching"
										@search="list.setSearch"
										@interval="list.selectInterval"
										@custom="list.setCustomDate"
										@live-enabled="list.setLiveEnabled"
										@live-interval="list.setLiveInterval"
										@refresh="list.refresh"
									/>
								</div>
								<LogsPaginationComponent
									:current-page="list.state.currentPage"
									:page-size="list.state.pageSize"
									:total="list.page.value.total"
									:total-pages="list.page.value.total_pages"
									:loading="list.state.loading"
									@page="list.setPage"
									@size="list.setPageSize"
								/>
							</div>
						</div>
						<LogsLiveBannerComponent
							:visible="list.liveActive.value"
							:interval-ms="list.state.liveTailIntervalMs"
							:connected="list.state.connected"
							@stop="list.setLiveEnabled(false)"
						/>
						<LogsTableComponent
							:data="list.page.value.data"
							:loading="list.state.loading"
							:sort-by="list.state.sortBy"
							:sort-order="list.state.sortOrder"
							:visible-columns="settings.columns.value"
							:live="list.liveActive.value"
							@sort="list.setSort"
							@select="selectLog"
							@key="openKey"
							@session="simulation = $event"
						/>
					</div>
				</div>
				<KeyDetailDrawerComponent
					v-model:open="keyDrawerOpen"
					:key-data="selectedKeyInfo"
					back-button-text="Back to Logs"
					@close="closeKey"
					@updated="list.refresh()"
					@deleted="closeKey"
				/>
			</div>
			<div v-for="item in auxiliaryTabs" :key="item.key" :hidden="list.state.activeTab !== item.key">
				<component
					:is="auxiliaryComponents['./auxiliary/' + item.file + '.vue']"
					:is-active="list.state.activeTab !== 'request logs'"
				/>
			</div>
		</UiTabs>
		<LogsSettingsDialogComponent :store="settings" />
		<component
			:is="details"
			v-if="details"
			:open="drawerOpen"
			:log="selectedLog"
			:session-group="selectedSession"
			:all-logs="list.page.value.data"
			:team-id="list.state.filters['Team ID'] || undefined"
			:start-time="utcApiDate(list.state.startTime)"
			:upstream-logs-enabled="settings.state.storeUpstream"
			@close="closeDrawer"
			@select="selectedLog = $event"
			@refresh="list.refresh"
			@open-settings="settings.show"
		/>
		<component
			:is="simulationDrawer"
			v-if="simulation"
			:key="simulation.type + '\0' + simulation.id"
			:open="true"
			:session-group="simulation"
			:team-id="list.state.filters['Team ID'] || undefined"
			@close="simulation = null"
			@open-log="selectSessionEvent"
		/>
	</div>
</template>
