<script setup lang="ts">
import UiButton from "../../platform/ui/UiButton.vue";
import UiCard from "../../platform/ui/UiCard.vue";
import ProviderIdentityComponent from "../../providers/ui/ProviderIdentityComponent.vue";
import UiSpinner from "../../platform/ui/UiSpinner.vue";
import UiAlert from "../../platform/ui/UiAlert.vue";
import type { Account, AccountQuotaState } from "../support/CliProxyModels";
import { accountIdentity } from "../logic/AccountIdentityLogic";
defineProps<{ account: Account; quotaState: AccountQuotaState }>();
defineEmits<{ refresh: [] }>();
const quotaColor = (remaining: number | null) =>
	remaining !== null && remaining < 20 ? "#ff4d4f" : remaining !== null && remaining < 50 ? "#faad14" : "#52c41a";
const date = (value: string) => new Date(value).toLocaleString();
const exhaustedClass = (remaining: number | null) => (remaining !== null && remaining <= 0 ? "cp-quota-window-name--exhausted" : "");
</script>
<template>
	<UiCard
		appearance="antd"
		size="small"
		class="cp-card cp-card-small cp-quota-card"
		data-cliproxy-quota-card="true"
		:data-provider="account.provider"
	>
		<template #title
			><div class="cp-quota-heading">
				<div class="cp-inline cp-gap-8">
					<ProviderIdentityComponent :provider="account.provider" /><strong
						class="cp-ellipsis"
						:title="accountIdentity(account, quotaState.data?.email) ?? account.filename"
						>{{ accountIdentity(account, quotaState.data?.email) ?? account.filename }}</strong
					>
				</div>
				<span class="cp-secondary cp-xs cp-ellipsis cp-quota-filename">{{ account.filename }}</span>
			</div></template
		>
		<template #extra
			><UiButton size="small" :loading="quotaState.status === 'loading'" @click="$emit('refresh')">Refresh</UiButton></template
		>
		<div v-if="quotaState.status === 'loading' && !quotaState.data" class="cp-quota-empty"><UiSpinner /></div>
		<div v-else-if="quotaState.status === 'idle'" class="cp-quota-empty">
			<span class="cp-secondary">Quota has not been queried yet.</span
			><UiButton @click="$emit('refresh')">Load subscription quota</UiButton>
		</div>
		<UiAlert
			v-else-if="quotaState.status === 'error' && !quotaState.data"
			type="error"
			title="Quota query failed"
			class="cp-alert-with-description"
			>{{ quotaState.error }}<UiButton size="small" danger @click="$emit('refresh')">Retry</UiButton></UiAlert
		>
		<div v-if="quotaState.data" class="cp-stack cp-gap-16">
			<div class="cp-inset">
				<div class="cp-between">
					<span class="cp-secondary">Subscription plan</span><strong>{{ quotaState.data.plan ?? "—" }}</strong>
				</div>
				<div v-if="quotaState.data.subscription_expires_at" class="cp-between cp-mt-4">
					<span class="cp-secondary">Expires</span><span>{{ date(quotaState.data.subscription_expires_at) }}</span>
				</div>
			</div>
			<div v-for="window in quotaState.data.windows" :key="window.id">
				<div class="cp-between cp-mb-4">
					<strong :class="exhaustedClass(window.remaining_percent)">{{ window.label }}</strong
					><span>{{ window.remaining_percent === null ? "—" : Math.round(window.remaining_percent) + "% remaining" }}</span>
				</div>
				<div
					class="cp-progress"
					role="progressbar"
					:aria-label="window.label"
					:aria-valuenow="window.remaining_percent ?? 0"
					aria-valuemin="0"
					aria-valuemax="100"
				>
					<div
						:style="{
							width: (window.remaining_percent === null ? 0 : Math.round(window.remaining_percent)) + '%',
							backgroundColor: quotaColor(window.remaining_percent),
						}"
					/>
				</div>
				<span v-if="window.resets_at" class="cp-secondary cp-xs">Resets {{ date(window.resets_at) }}</span>
			</div>
			<div v-for="balance in quotaState.data.balances" :key="balance.label + '-' + balance.unit" class="cp-between cp-balance">
				<strong>{{ balance.label }}</strong
				><span>{{
					balance.unit === "次可用"
						? balance.limit.toFixed(0) + " " + balance.unit
						: balance.used.toFixed(2) + " / " + balance.limit.toFixed(2) + " " + balance.unit
				}}</span>
			</div>
			<UiAlert
				v-if="quotaState.data.windows.length === 0 && quotaState.data.balances.length === 0"
				title="This provider returned no quota windows or balances."
			/>
			<UiAlert
				v-if="quotaState.status === 'error'"
				type="warning"
				title="Refresh failed; showing the previous result."
				class="cp-alert-with-description"
				>{{ quotaState.error }}</UiAlert
			>
			<div>
				<span class="cp-secondary cp-xs">Updated {{ date(quotaState.data.fetched_at) }}</span>
			</div>
		</div>
	</UiCard>
</template>
