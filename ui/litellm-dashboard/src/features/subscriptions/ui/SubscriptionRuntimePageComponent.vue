<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, watch } from "vue";
import UiSpinner from "../../platform/ui/UiSpinner.vue";
import CliProxyTabs from "../../cliproxy/ui/CliProxyTabsComponent.vue";
import UiAlert from "../../platform/ui/UiAlert.vue";
import { createCliProxyStore } from "../../cliproxy/stores/CliProxyStore";
import CliProxyOverview from "../../cliproxy/ui/CliProxyOverviewComponent.vue";
import CliProxyAccounts from "../../cliproxy/ui/CliProxyAccountsComponent.vue";
import CliProxyLogViewer from "../../cliproxy/ui/CliProxyLogViewerComponent.vue";
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
	{ key: "accounts", label: "Accounts (" + state.accounts.length + ")" },
	{ key: "logs", label: "Logs" },
]);
onMounted(store.start);
onBeforeUnmount(store.dispose);
</script>
<template>
	<div v-if="state.loading" class="cp-loading"><UiSpinner :size="32" /></div>
	<div v-else class="cliproxy-page">
		<div class="cp-page-heading">
			<h2>Subscription runtime</h2>
			<span class="cp-secondary">Subscription execution runs inside LiteLLM; accounts, quota, models and logs are managed here.</span>
		</div>
		<UiAlert v-if="state.status?.last_error" class="cp-mb-16" type="warning" :title="state.status.last_error" />
		<CliProxyTabs v-model="state.activeTab" :items="tabs" />
		<CliProxyOverview v-show="state.activeTab === 'overview'" :store="store" />
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
		<CliProxyDialogs :store="store" />
	</div>
</template>
