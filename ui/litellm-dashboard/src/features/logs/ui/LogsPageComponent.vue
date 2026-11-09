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
import type { UiTableActiveFilter, UiTableFilterChoice, UiTableFilterField } from "../../platform/ui/UiTableFilterModels";
import { createLogsListStore } from "../stores/LogsListStore";
import { createLogsSettingsStore } from "../stores/LogsSettingsStore";
import { FILTER_KEYS, type LogFilterState } from "../logic/LogsFilterLogic";
import { navigableSessionGroup } from "../logic/LogsIdentityLogic";
import { record } from "../logic/LogsPresentationLogic";
import { utcApiDate } from "../logic/LogsDateLogic";
import { ERROR_CODE_OPTIONS } from "../support/LogsConstants";
import type { LogEntry, SessionGroupRef } from "../support/LogsModels";
import { fetchChoicePage } from "../../selectors/api/PaginatedChoiceApi";
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
const STATUS_FILTER_OPTIONS: readonly UiTableFilterChoice[] = [
	{ label: "In Progress", value: "in_progress" },
	{ label: "Success", value: "success" },
	{ label: "Failure", value: "failure" },
	{ label: "Aborted", value: "aborted" },
];
const filterTexts = ref<Record<string, string>>({});

function statusLabel(value: string): string {
	return STATUS_FILTER_OPTIONS.find((option) => option.value === value)?.label ?? value;
}
function teamLabel(id: string): string {
	const team = application.state.teams.find((item) => item.team_id === id);
	return team?.team_alias || id;
}
function teamChoices(term: string): UiTableFilterChoice[] {
	const query = term.trim().toLowerCase();
	return application.state.teams.flatMap((team) => {
		const alias = typeof team.team_alias === "string" ? team.team_alias : "";
		if (query && !team.team_id.toLowerCase().includes(query) && !alias.toLowerCase().includes(query)) return [];
		return [{ value: team.team_id, label: alias || team.team_id, description: alias ? team.team_id : undefined }];
	});
}
async function modelChoices(term: string): Promise<UiTableFilterChoice[]> {
	const page = await fetchChoicePage("model", 1, 50, term);
	return page.options.map((option) => ({ value: option.value, label: option.label }));
}
async function customerChoices(term: string): Promise<UiTableFilterChoice[]> {
	const data = await requestJson("/customer/list");
	if (!Array.isArray(data)) return [];
	const query = term.trim().toLowerCase();
	return data.flatMap((item) => {
		const id = record(item).user_id;
		return typeof id === "string" && id.toLowerCase().includes(query) ? [{ label: id, value: id }] : [];
	});
}
const filterFields = computed<Record<string, readonly UiTableFilterField[]>>(() => ({
	status: [
		{ key: FILTER_KEYS.STATUS, label: "Status", control: { kind: "select", options: STATUS_FILTER_OPTIONS } },
		{
			key: FILTER_KEYS.ERROR_CODE,
			label: "Error Code",
			control: { kind: "select", searchable: true, creatable: true, options: ERROR_CODE_OPTIONS },
		},
		{ key: FILTER_KEYS.ERROR_MESSAGE, label: "Error Message", control: { kind: "text", placeholder: "Filter error message" } },
	],
	team_name: [
		{
			key: FILTER_KEYS.TEAM_ID,
			label: "Team ID",
			control: {
				kind: "remote",
				placeholder: "Search teams…",
				initialOptions: teamChoices(""),
				search: async (term) => teamChoices(term),
			},
		},
	],
	key_hash: [{ key: FILTER_KEYS.KEY_HASH, label: "Key Hash", control: { kind: "text", placeholder: "Filter key hash" } }],
	key_name: [{ key: FILTER_KEYS.KEY_ALIAS, label: "Key Alias", control: { kind: "text", placeholder: "Filter key alias" } }],
	model: [
		{
			key: FILTER_KEYS.MODEL,
			label: "Model",
			control: { kind: "remote", placeholder: "Search models…", search: modelChoices },
		},
	],
	request_id: [{ key: FILTER_KEYS.REQUEST_ID, label: "Request ID", control: { kind: "text", placeholder: "Filter request ID" } }],
	user: [{ key: FILTER_KEYS.USER_ID, label: "User ID", control: { kind: "text", placeholder: "Filter user ID" } }],
	end_user: [
		{
			key: FILTER_KEYS.END_USER,
			label: "End User",
			control: { kind: "remote", placeholder: "Search end users…", search: customerChoices },
		},
	],
}));
const activeFilters = computed<UiTableActiveFilter[]>(() => {
	const filters = list.state.filters;
	const entries: UiTableActiveFilter[] = [];
	const add = (key: keyof LogFilterState, label: string, text?: string, match: "fuzzy" | "exact" = "exact") => {
		const value = filters[key];
		if (!value) return;
		entries.push({ key, label, value, text: text || filterTexts.value[key] || value, match });
	};
	add(FILTER_KEYS.STATUS, "Status", statusLabel(filters[FILTER_KEYS.STATUS]));
	add(FILTER_KEYS.ERROR_CODE, "Error Code");
	add(FILTER_KEYS.ERROR_MESSAGE, "Error Message", undefined, "fuzzy");
	add(FILTER_KEYS.TEAM_ID, "Team ID", teamLabel(filters[FILTER_KEYS.TEAM_ID]));
	add(FILTER_KEYS.KEY_HASH, "Key Hash", undefined, "fuzzy");
	add(FILTER_KEYS.KEY_ALIAS, "Key Alias", undefined, "fuzzy");
	add(FILTER_KEYS.MODEL, "Model");
	add(FILTER_KEYS.REQUEST_ID, "Request ID", undefined, "fuzzy");
	add(FILTER_KEYS.USER_ID, "User ID", undefined, "fuzzy");
	add(FILTER_KEYS.END_USER, "End User");
	return entries;
});
function applyLogFilters(entries: readonly UiTableActiveFilter[]): void {
	const next: Partial<LogFilterState> = {};
	for (const entry of entries) {
		next[entry.key as keyof LogFilterState] = entry.value;
		if (entry.value) filterTexts.value[entry.key] = entry.text || entry.value;
		else delete filterTexts.value[entry.key];
	}
	list.applyFilters(next);
}
function removeLogFilter(key: string): void {
	delete filterTexts.value[key];
	list.applyFilters({ [key]: "" } as Partial<LogFilterState>);
}
function clearLogFilters(): void {
	filterTexts.value = {};
	list.clearFilters();
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
					<UiAlert v-if="list.state.error" type="error" style="margin-bottom: 16px">{{ list.state.error }}</UiAlert>
					<div class="logs-card">
						<div class="logs-controls">
							<div class="logs-controls-row" data-testid="logs-controls-row">
								<div class="logs-controls-toolbar">
									<LogsToolbarComponent
										:start-time="list.state.startTime"
										:end-time="list.state.endTime"
										:custom-date="list.state.isCustomDate"
										:selected-interval="list.state.selectedTimeInterval"
										:live-tail-interval-ms="list.state.liveTailIntervalMs"
										:live-tail-enabled="list.state.liveTailEnabled"
										:fetching="list.state.fetching"
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
							:filter-fields="filterFields"
							:active-filters="activeFilters"
							@sort="list.setSort"
							@select="selectLog"
							@key="openKey"
							@session="simulation = $event"
							@filter-change="applyLogFilters"
							@remove-filter="removeLogFilter"
							@clear-filters="clearLogFilters"
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
