<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import UiCard from "../../platform/ui/UiCard.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import UiAlert from "../../platform/ui/UiAlert.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiSpinner from "../../platform/ui/UiSpinner.vue";
import ProviderLogoComponent from "../../providers/ui/ProviderLogoComponent.vue";
import { getProviderLogoAndName } from "../../providers/logic/ProviderIdentityLogic";
import { createCliProxyStore } from "../../cliproxy/stores/CliProxyStore";
import SubscriptionKeys from "./SubscriptionKeysComponent.vue";
import CliProxyAccounts from "../../cliproxy/ui/CliProxyAccountsComponent.vue";
import CliProxyDialogs from "../../cliproxy/ui/CliProxyDialogsComponent.vue";
import CliProxyQuotaCard from "../../cliproxy/ui/CliProxyQuotaCardComponent.vue";
import "../../cliproxy/ui/CliProxyStyles.css";
import {
	SUBSCRIPTION_PROVIDER_ACCOUNT_SOURCES,
	SUBSCRIPTION_PROVIDER_SLUGS,
	providerSlugFromValue,
} from "../logic/SubscriptionProviderLogic";

const route = useRoute(),
	router = useRouter(),
	store = createCliProxyStore(),
	state = store.state;
const providers = SUBSCRIPTION_PROVIDER_SLUGS.map((slug) => {
	const identity = getProviderLogoAndName(slug);
	return { value: slug, label: identity.displayName, logo: identity.logo };
});
const selected = computed(() => {
	const value = providerSlugFromValue(route.query.provider ?? "");
	return providers.some((provider) => provider.value === value) ? value : providers[0].value;
});
const selectedProvider = computed(() => providers.find((provider) => provider.value === selected.value)!);
const source = computed(() => SUBSCRIPTION_PROVIDER_ACCOUNT_SOURCES[selected.value] ?? "");
const providerAccounts = computed(() => state.accounts.filter((account) => account.provider.trim().toLowerCase() === source.value));
const quotaRefreshing = computed(() =>
	providerAccounts.value.some((account) => state.quotaStates[account.auth_index]?.status === "loading"),
);
const accountCount = computed(() => providerAccounts.value.filter((account) => !account.filename.startsWith(".trash/")).length);
function refreshQuota() {
	void Promise.all(
		providerAccounts.value.filter((account) => !account.filename.startsWith(".trash/")).map((account) => store.loadQuota(account)),
	);
}
function select(value: unknown) {
	const slug = providerSlugFromValue(value);
	if (!providers.some((provider) => provider.value === slug)) return;
	void router.replace({ query: { ...route.query, page: "subscriptions", provider: slug } });
}
onMounted(store.start);
onBeforeUnmount(store.dispose);
</script>
<template>
	<div v-if="state.loading" class="cp-loading"><UiSpinner :size="32" /></div>
	<div v-else class="cliproxy-page subscriptions-page">
		<div class="cp-page-heading">
			<h2>Subscriptions</h2>
			<span class="cp-secondary"
				>First-party subscription accounts for Codex, Claude, Kimi, Antigravity, xAI, CommandCode and OpenCode Go. Model deployments
				use these accounts; API keys and base URLs stay out of the model configuration.</span
			>
		</div>
		<UiAlert v-if="state.status?.last_error" class="cp-mb-16" type="warning" :title="state.status.last_error" />
		<UiCard appearance="antd" class="cp-card cp-mb-16" data-subscription-provider-picker="true">
			<div class="cp-inline cp-wrap cp-gap-12 cp-between">
				<div class="cp-inline cp-gap-8">
					<ProviderLogoComponent
						:provider="selectedProvider.label"
						:logo="selectedProvider.logo"
						alt=""
						image-class="provider-identity-logo"
						fallback-class="provider-identity-logo"
					/>
					<UiSelect
						class="subscription-provider-select"
						:model-value="selected"
						:options="providers"
						:aria-label="'Subscription provider'"
						@update:model-value="select"
					/>
				</div>
				<div class="cp-inline cp-gap-8">
					<span class="cp-secondary">{{ accountCount }} active {{ accountCount === 1 ? "account" : "accounts" }}</span>
					<UiButton size="small" :loading="quotaRefreshing" :disabled="providerAccounts.length === 0" @click="refreshQuota"
						>Refresh quota</UiButton
					>
				</div>
			</div>
		</UiCard>
		<SubscriptionKeys
			v-if="selected === 'opencode-go' || selected === 'commandcode'"
			:provider="selected"
			@changed="store.refreshAccounts()"
		/>
		<CliProxyAccounts :store="store" :sources="source ? [source] : []" :show-command-key-form="false" />
		<div class="cp-between cp-wrap cp-gap-12 cp-quota-toolbar cp-mt-16">
			<div>
				<strong>{{ selectedProvider.label }} quota</strong
				><span class="cp-secondary cp-xs cp-block">Plan and remaining usage for this subscription's managed accounts.</span>
			</div>
		</div>
		<UiAlert v-if="providerAccounts.length === 0" title="No accounts for this subscription" class="cp-alert-with-description"
			>Add an account with the buttons above, then refresh its quota.</UiAlert
		>
		<div v-else class="cp-quota-grid">
			<CliProxyQuotaCard
				v-for="account in providerAccounts"
				:key="account.auth_index"
				:account="account"
				:quota-state="state.quotaStates[account.auth_index] ?? { status: 'idle' }"
				@refresh="store.loadQuota(account)"
			/>
		</div>
		<CliProxyDialogs :store="store" />
	</div>
</template>
<style scoped>
.subscription-provider-select {
	min-width: 260px;
}
</style>
