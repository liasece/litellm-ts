<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, watch } from "vue";
import UiSpinner from "../../platform/ui/UiSpinner.vue";
import CliProxyTabs from "../../cliproxy/ui/CliProxyTabsComponent.vue";
import UiAlert from "../../platform/ui/UiAlert.vue";
import { createCliProxyStore } from "../../cliproxy/stores/CliProxyStore";
import CliProxyOverview from "../../cliproxy/ui/CliProxyOverviewComponent.vue";
import CliProxyConfigEditor from "../../cliproxy/ui/CliProxyConfigEditorComponent.vue";
import CliProxyAccounts from "../../cliproxy/ui/CliProxyAccountsComponent.vue";
import CliProxyLogViewer from "../../cliproxy/ui/CliProxyLogViewerComponent.vue";
import CliProxyAdvanced from "../../cliproxy/ui/CliProxyAdvancedComponent.vue";
import CliProxyDialogs from "../../cliproxy/ui/CliProxyDialogsComponent.vue";
import "../../cliproxy/ui/CliProxyStyles.css";
const store = createCliProxyStore();
const state = store.state;
const visitedTabs = reactive(new Set(["overview"]));
watch(
	() => state.activeTab,
	(tab) => visitedTabs.add(tab),
);
const tabs = computed(() => [
	{ key: "overview", label: "Overview" },
	{ key: "configuration", label: "Configuration" },
	{ key: "accounts", label: "OAuth accounts (" + state.accounts.length + ")" },
	{ key: "logs", label: "Logs" },
	{ key: "advanced", label: "Advanced" },
]);
function openRaw() {
	state.rawConfigDraft = state.configYaml;
	state.rawConfigOpen = true;
}
onMounted(store.start);
onBeforeUnmount(store.dispose);
</script>
<template>
	<div v-if="state.loading" class="cp-loading"><UiSpinner :size="32" /></div>
	<div v-else class="cliproxy-page">
		<div class="cp-page-heading">
			<h2>Subscription runtime</h2>
			<span class="cp-secondary">The runtime version ships with the application.</span>
		</div>
		<UiAlert v-if="state.status?.last_error" class="cp-mb-16" type="warning" :title="state.status.last_error" />
		<CliProxyTabs v-model="state.activeTab" :items="tabs" />
		<CliProxyOverview v-show="state.activeTab === 'overview'" :store="store" />
		<CliProxyConfigEditor
			v-if="visitedTabs.has('configuration')"
			v-show="state.activeTab === 'configuration'"
			:key="state.enabled + '-' + (state.status?.config_hash ?? 'config')"
			:enabled="state.enabled"
			:user-config="state.userConfig"
			:saving="state.busy === 'configuration apply'"
			@save="store.saveVisualConfig"
			@open-raw="openRaw"
		/>
		<CliProxyAccounts v-show="state.activeTab === 'accounts'" :store="store" />
		<CliProxyLogViewer
			v-if="visitedTabs.has('logs')"
			v-show="state.activeTab === 'logs'"
			:entries="state.logs"
			:refreshing="state.busy === 'logs refresh'"
			can-refresh
			can-clear
			@refresh="store.reloadLogs"
			@clear="state.logs = []"
		/>
		<CliProxyAdvanced v-show="state.activeTab === 'advanced'" :store="store" />
		<CliProxyDialogs :store="store" />
	</div>
</template>
