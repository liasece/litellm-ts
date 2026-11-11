<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, watch } from "vue";
import { useRoute } from "vue-router";
import { getServerRootPath } from "../../platform/support/ApiEnvironmentSupport";
import UiAlert from "../../platform/ui/UiAlert.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiSpinner from "../../platform/ui/UiSpinner.vue";
import ProviderLogoComponent from "../../providers/ui/ProviderLogoComponent.vue";
import { getProviderLogoAndName } from "../../providers/logic/ProviderIdentityLogic";
import { createCliProxyStore } from "../../cliproxy/stores/CliProxyStore";
import type { Account } from "../../cliproxy/support/CliProxyModels";
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
	store = createCliProxyStore(),
	state = store.state;
/** OpenCode Go uses the encrypted saved-key form; CommandCode manages its own account list. */
const KEYED_PROVIDER_SLUGS = new Set(["opencode-go"]);
const providers = SUBSCRIPTION_PROVIDER_SLUGS.map((slug) => {
	const identity = getProviderLogoAndName(slug);
	return {
		value: slug,
		label: identity.displayName,
		logo: identity.logo,
		source: SUBSCRIPTION_PROVIDER_ACCOUNT_SOURCES[slug] ?? "",
	};
});
const accountsBySource = computed(() => {
	const grouped: Record<string, Account[]> = {};
	for (const provider of providers) grouped[provider.source] = [];
	for (const account of state.accounts) {
		const source = account.provider.trim().toLowerCase();
		if (Object.hasOwn(grouped, source)) grouped[source].push(account);
	}
	return grouped;
});
const accountsFor = (source: string): Account[] => accountsBySource.value[source] ?? [];
const activeAccountsFor = (source: string): Account[] => accountsFor(source).filter((account) => !account.filename.startsWith(".trash/"));
const accountSummary = (source: string): string => {
	const count = activeAccountsFor(source).length;
	return `${count} active ${count === 1 ? "account" : "accounts"}`;
};
const quotaRefreshing = (source: string): boolean =>
	activeAccountsFor(source).some((account) => state.quotaStates[account.auth_index]?.status === "loading");
function refreshQuota(source: string) {
	void Promise.all(activeAccountsFor(source).map((account) => store.loadQuota(account)));
}
const sectionId = (slug: string) => "subscription-provider-" + slug;
/** 模型页通过 ?provider= 深链到某个 Provider 板块，列表本身始终展示全部 Provider。 */
const targetProvider = computed(() => {
	const value = route.query.provider;
	const slug = providerSlugFromValue(Array.isArray(value) ? value[0] : value);
	return providers.some((provider) => provider.value === slug) ? slug : "";
});
function revealTargetProvider() {
	const slug = targetProvider.value;
	if (state.loading || !slug) return;
	void nextTick(() => document.getElementById(sectionId(slug))?.scrollIntoView({ behavior: "smooth", block: "start" }));
}
watch([() => state.loading, targetProvider], revealTargetProvider);
onMounted(store.start);
onMounted(revealTargetProvider);
onBeforeUnmount(store.dispose);
</script>
<template>
	<div v-if="state.loading" class="cp-loading"><UiSpinner :size="32" /></div>
	<div v-else class="cliproxy-page subscriptions-page">
		<div class="cp-page-heading">
			<div class="cp-between cp-wrap cp-gap-12">
				<h2>Subscriptions</h2>
				<a :href="getServerRootPath().replace(/\/+$/, '') + '/ui/subscriptions/runtime'">Manage runtime</a>
			</div>
			<span class="cp-secondary"
				>First-party subscription accounts for Codex, Claude, Kimi, Antigravity, xAI, CommandCode and OpenCode Go. Model deployments
				use these accounts; API keys and base URLs stay out of the model configuration.</span
			>
		</div>
		<UiAlert v-if="state.status?.last_error" class="cp-mb-16" type="warning" :title="state.status.last_error" />
		<div class="subscription-provider-list">
			<section
				v-for="provider in providers"
				:id="sectionId(provider.value)"
				:key="provider.value"
				class="subscription-provider"
				:class="{ 'subscription-provider--target': provider.value === targetProvider }"
				:data-subscription-provider="provider.value"
			>
				<div class="subscription-provider-heading">
					<div class="cp-inline cp-gap-8 cp-min-width">
						<ProviderLogoComponent
							:provider="provider.label"
							:logo="provider.logo"
							alt=""
							image-class="provider-identity-logo"
							fallback-class="provider-identity-logo"
						/>
						<div class="subscription-provider-title">
							<h3>{{ provider.label }}</h3>
							<span class="cp-secondary cp-xs">{{ accountSummary(provider.source) }}</span>
						</div>
					</div>
					<UiButton
						size="small"
						:loading="quotaRefreshing(provider.source)"
						:disabled="activeAccountsFor(provider.source).length === 0"
						@click="refreshQuota(provider.source)"
						>Refresh quota</UiButton
					>
				</div>
				<SubscriptionKeys
					v-if="KEYED_PROVIDER_SLUGS.has(provider.value)"
					:provider="provider.value"
					@changed="store.refreshAccounts()"
				/>
				<CliProxyAccounts
					:store="store"
					:sources="[provider.source]"
					:show-command-key-form="provider.value === 'commandcode'"
					:show-provider-column="false"
					:hide-table-when-empty="true"
				/>
				<div v-if="activeAccountsFor(provider.source).length" class="subscription-provider-quota">
					<div class="cp-quota-toolbar">
						<div>
							<strong>Quota</strong>
							<span class="cp-secondary cp-xs cp-block"
								>Plan and remaining usage for this subscription's managed accounts.</span
							>
						</div>
					</div>
					<div class="cp-quota-grid">
						<CliProxyQuotaCard
							v-for="account in activeAccountsFor(provider.source)"
							:key="account.auth_index"
							:account="account"
							:quota-state="state.quotaStates[account.auth_index] ?? { status: 'idle' }"
							@refresh="store.loadQuota(account)"
						/>
					</div>
				</div>
				<UiAlert
					v-else-if="accountsFor(provider.source).length === 0"
					class="cp-alert-with-description subscription-provider-empty"
					title="No accounts for this subscription"
					>Add an account with the controls above, then refresh its quota.</UiAlert
				>
			</section>
		</div>
		<CliProxyDialogs :store="store" />
	</div>
</template>
<style scoped>
.subscription-provider-list {
	display: flex;
	flex-direction: column;
	gap: 16px;
}
.subscription-provider {
	padding: 16px;
	border: 1px solid #f0f0f0;
	border-radius: 8px;
	background: #fff;
	scroll-margin-top: 16px;
}
.subscription-provider--target {
	border-color: #91caff;
	box-shadow: 0 0 0 3px rgba(22, 119, 255, 0.06);
}
.subscription-provider-heading {
	display: flex;
	align-items: center;
	justify-content: space-between;
	flex-wrap: wrap;
	gap: 12px;
	margin-bottom: 12px;
}
.subscription-provider-title {
	min-width: 0;
}
.subscription-provider h3 {
	margin: 0;
	font-size: 16px;
	line-height: 24px;
}
.subscription-provider-quota {
	margin-top: 16px;
}
.subscription-provider-empty {
	margin-top: 12px;
}
</style>
