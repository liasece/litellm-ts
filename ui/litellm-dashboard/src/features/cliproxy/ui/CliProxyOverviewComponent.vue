<script setup lang="ts">
import { computed } from "vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiTag from "../../platform/ui/UiTag.vue";
import UiAlert from "../../platform/ui/UiAlert.vue";
import { cliProxyApi } from "../api/CliProxyApi";
import type { CliProxyStore } from "../stores/CliProxyStore";
import CliProxyQuotaCard from "./CliProxyQuotaCardComponent.vue";
import CliProxyLogViewer from "./CliProxyLogViewerComponent.vue";
const props = defineProps<{ store: CliProxyStore }>();
const state = props.store.state;
const stateColor = computed(() =>
	state.status?.state === "running"
		? "green"
		: ["starting", "updating"].includes(state.status?.state ?? "")
			? "blue"
			: state.status?.state === "stopped"
				? "default"
				: "red",
);
const quotaRefreshing = computed(() => state.accounts.some((account) => state.quotaStates[account.auth_index]?.status === "loading"));
</script>
<template>
	<div class="cp-stack cp-gap-16">
		<UiCard appearance="antd" size="small" class="cp-card cp-card-small"
			><div class="cp-status-grid">
				<div class="cp-status-cell">
					<span class="cp-secondary cp-xs cp-block">State</span
					><UiTag :color="stateColor" class="cp-mt-4">{{ state.status?.state ?? "unknown" }}</UiTag>
				</div>
				<div class="cp-status-cell">
					<span class="cp-secondary cp-xs cp-block">Health</span
					><UiTag :color="state.status?.health === 'healthy' ? 'green' : 'red'" class="cp-mt-4">{{
						state.status?.health ?? "unknown"
					}}</UiTag>
				</div>
				<div class="cp-status-cell">
					<span class="cp-secondary cp-xs cp-block">Version</span
					><strong class="cp-block cp-mt-4 cp-ellipsis">{{ state.status?.version ?? "Not installed" }}</strong>
				</div>
				<div class="cp-status-cell">
					<span class="cp-secondary cp-xs cp-block">Process</span
					><strong class="cp-block cp-mt-4 cp-ellipsis">{{
						state.status?.pid ? "PID " + state.status.pid : "Not running"
					}}</strong>
				</div>
			</div></UiCard
		>
		<UiCard
			appearance="antd"
			size="small"
			title="Runtime and updates"
			class="cp-card cp-card-small"
			data-cliproxy-runtime-operations="true"
		>
			<div class="cp-runtime-grid">
				<div class="cp-runtime-controls">
					<div class="cp-mb-8">
						<strong>Service controls</strong
						><span class="cp-secondary cp-xs cp-block cp-mt-2">Manage the private child process without stopping LiteLLM.</span>
					</div>
					<div class="cp-inline cp-wrap cp-gap-8">
						<UiButton
							size="small"
							variant="primary"
							:disabled="state.status?.state === 'running' || state.busy !== null"
							:loading="state.busy === 'start'"
							@click="store.runOperation('start', () => cliProxyApi('/subscriptions/start', { method: 'POST' }))"
							>Start</UiButton
						><UiButton
							size="small"
							:disabled="state.status?.state !== 'running' || state.busy !== null"
							:loading="state.busy === 'restart'"
							@click="store.runOperation('restart', () => cliProxyApi('/subscriptions/restart', { method: 'POST' }))"
							>Restart</UiButton
						><UiButton
							size="small"
							danger
							:disabled="state.status?.state === 'stopped' || state.busy !== null"
							:loading="state.busy === 'stop'"
							@click="store.runOperation('stop', () => cliProxyApi('/subscriptions/stop', { method: 'POST' }))"
							>Stop</UiButton
						>
					</div>
				</div>
			</div>
			<UiAlert v-if="state.status?.operation" class="cp-mt-16" :title="'Operation in progress: ' + state.status.operation" />
		</UiCard>
		<div class="cp-between cp-wrap cp-gap-12 cp-quota-toolbar">
			<div>
				<strong>Subscription quota</strong
				><span class="cp-secondary cp-xs cp-block"
					>Current plan and remaining usage for every managed CLI subscription account.</span
				>
			</div>
			<UiButton size="small" :loading="quotaRefreshing" :disabled="state.accounts.length === 0" @click="store.refreshAllQuotas"
				>Refresh all</UiButton
			>
		</div>
		<UiAlert v-if="state.accounts.length === 0" title="No OAuth accounts" class="cp-alert-with-description"
			>Add an account in the OAuth accounts tab before querying subscription quota.</UiAlert
		>
		<div v-else class="cp-quota-grid">
			<CliProxyQuotaCard
				v-for="account in state.accounts"
				:key="account.auth_index"
				:account="account"
				:quota-state="state.quotaStates[account.auth_index] ?? { status: 'idle' }"
				@refresh="store.loadQuota(account)"
			/>
		</div>
		<CliProxyLogViewer
			:entries="state.logs"
			compact
			:refreshing="state.busy === 'logs refresh'"
			can-refresh
			can-view-all
			@refresh="store.reloadLogs"
			@view-all="state.activeTab = 'logs'"
		/>
	</div>
</template>
