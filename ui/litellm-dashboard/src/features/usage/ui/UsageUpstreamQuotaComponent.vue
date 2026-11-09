<script setup lang="ts">
import { onBeforeUnmount, watch } from "vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiAlert from "../../platform/ui/UiAlert.vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiTag from "../../platform/ui/UiTag.vue";
import ProviderIdentityComponent from "../../providers/ui/ProviderIdentityComponent.vue";
import UiSpinner from "../../platform/ui/UiSpinner.vue";
import { createUpstreamQuotaStore } from "../stores/UpstreamQuotaStore";
import { useMoneyFormatter } from "../../platform/stores/PriceDisplayStore";
import UsageQuotaWindows from "./UsageQuotaWindowsComponent.vue";
const props = defineProps<{ enabled: boolean }>(),
	store = createUpstreamQuotaStore(),
	{ state } = store,
	money = useMoneyFormatter();
watch(
	() => props.enabled,
	(value) => {
		if (value) void store.load();
	},
	{ immediate: true },
);
onBeforeUnmount(() => store.dispose());
function kind(value: string) {
	return value === "subscription" ? "Subscription key" : value === "pay_as_you_go" ? "Pay-as-you-go key" : "Unrecognized key";
}
function balance(value: { used: number; limit: number; unit: string }) {
	if (value.unit === "次可用") return value.limit.toFixed(0) + " " + value.unit;
	const remaining = Math.max(0, value.limit - value.used);
	return value.unit === "USD" ? money(remaining, 2) + " remaining" : remaining.toFixed(2) + " " + value.unit + " remaining";
}
</script>
<template>
	<section
		v-if="enabled && (state.accounts.length || state.providers.length || state.builtInError !== null)"
		class="usage-upstream-quota"
		data-testid="upstream-account-quota"
	>
		<header>
			<div>
				<h4>Upstream account quota</h4>
				<p>Remaining quota and balance for subscription accounts and built-in provider keys.</p>
			</div>
			<UiButton :loading="state.refreshing" data-testid="upstream-quota-refresh" @click="store.load(true)"
				><template #icon><UiIcon name="ReloadOutlined" /></template>Refresh</UiButton
			>
		</header>
		<UiAlert v-if="state.builtInError" type="warning" title="Built-in provider quota unavailable">{{ state.builtInError }}</UiAlert>
		<div class="usage-quota-grid">
			<UiCard
				v-for="account in state.providers"
				:key="account.id"
				appearance="antd"
				:data-testid="'builtin-provider-quota-' + account.provider"
			>
				<template #title
					><div class="usage-quota-account-title">
						<div>
							<ProviderIdentityComponent :provider="account.provider" /><strong :title="account.label">{{
								account.label
							}}</strong>
						</div>
						<small v-if="account.models.length" :title="account.models.join(', ')">{{ account.models.join(", ") }}</small>
					</div></template
				><template #extra
					><div class="usage-quota-account-kind">
						<UiTag>{{ kind(account.account_kind) }}</UiTag
						><UiTag v-if="account.plan" color="blue">{{ account.plan }}</UiTag>
					</div></template
				>
				<UiAlert v-if="account.error" type="warning" title="Quota query failed">{{ account.error }}</UiAlert
				><UiAlert v-if="account.warning" type="info" :title="account.warning" />
				<UsageQuotaWindows v-if="account.windows.length" :windows="account.windows" />
				<div v-if="account.balances.length" class="usage-quota-balances">
					<div v-for="b in account.balances" :key="b.label + '-' + b.unit">
						<header>
							<strong>{{ b.label }}</strong
							><span
								>{{ b.unit }}
								{{ b.remaining.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }}
								remaining</span
							>
						</header>
						<small v-if="b.details?.length">{{ b.details.join(" · ") }}</small>
					</div>
				</div>
				<UiAlert
					v-if="!account.error && !account.windows.length && !account.balances.length && !account.warning"
					type="info"
					title="This account returned no quota details."
				/>
				<small class="usage-quota-updated">Updated {{ new Date(account.fetched_at).toLocaleString() }}</small>
			</UiCard>
			<UiCard v-for="account in state.accounts" :key="account.auth_index" appearance="antd">
				<template #title
					><div class="usage-quota-account-title">
						<div>
							<ProviderIdentityComponent :provider="account.provider" /><strong :title="account.email ?? account.filename">{{
								account.email ?? account.filename
							}}</strong>
						</div>
					</div></template
				><template v-if="state.quotas[account.auth_index]?.data?.plan" #extra
					><UiTag color="blue">{{ state.quotas[account.auth_index].data?.plan }}</UiTag></template
				>
				<div v-if="!state.quotas[account.auth_index]?.data" class="usage-quota-initial">
					<UiAlert v-if="state.quotas[account.auth_index]?.status === 'error'" type="warning" title="Quota unavailable">{{
						state.quotas[account.auth_index]?.error
					}}</UiAlert
					><UiSpinner v-else />
				</div>
				<div v-else class="usage-quota-details">
					<small v-if="state.quotas[account.auth_index].data?.subscription_expires_at"
						>Subscription expires
						{{ new Date(state.quotas[account.auth_index].data!.subscription_expires_at!).toLocaleString() }}</small
					><UsageQuotaWindows :windows="state.quotas[account.auth_index].data!.windows" />
					<div
						v-for="b in state.quotas[account.auth_index].data!.balances"
						:key="b.label + '-' + b.unit"
						class="usage-quota-balance-row"
					>
						<strong>{{ b.label }}</strong
						><span>{{ balance(b) }}</span>
					</div>
					<UiAlert
						v-if="
							!state.quotas[account.auth_index].data!.windows.length &&
							!state.quotas[account.auth_index].data!.balances.length
						"
						type="info"
						title="This provider returned no remaining quota details."
					/><small>Updated {{ new Date(state.quotas[account.auth_index].data!.fetched_at).toLocaleString() }}</small>
				</div>
			</UiCard>
		</div>
	</section>
</template>
