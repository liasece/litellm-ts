<script setup lang="ts">
import UiButton from "../../platform/ui/UiButton.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiSwitch from "../../platform/ui/UiSwitch.vue";
import UiInputNumber from "../../platform/ui/UiInputNumber.vue";
import UiTag from "../../platform/ui/UiTag.vue";
import ProviderLogoComponent from "../../providers/ui/ProviderLogoComponent.vue";
import type { Account } from "../support/CliProxyModels";
import type { CliProxyStore } from "../stores/CliProxyStore";
import { getProviderBrand } from "../../providers/logic/ProviderBrands";
import CliProxyConfirm from "./CliProxyConfirmComponent.vue";
import CliProxyPasswordInput from "./CliProxyPasswordInputComponent.vue";
import ProviderIdentityComponent from "../../providers/ui/ProviderIdentityComponent.vue";
const props = defineProps<{ store: CliProxyStore }>();
const state = props.store.state;
const oauthProviders = [
	{ provider: "codex-device", label: "Codex device login", primary: true },
	{ provider: "codex", label: "Codex browser login" },
	{ provider: "claude", label: "Claude login" },
	{ provider: "antigravity", label: "Antigravity login" },
	{ provider: "kimi", label: "Kimi login" },
	{ provider: "xai", label: "xAI login" },
];
const brandFor = (provider: string) => getProviderBrand(provider);
const managedAccount = (account: Account) => state.commandCodeAccounts.find((item) => item.filename === account.filename);
const isTrashed = (account: Account) => account.filename.startsWith(".trash/");
function saveWeight(account: Account, event: FocusEvent) {
	const raw = (event.target as HTMLInputElement).value;
	void props.store.updateAccount(account, { weight: raw === "" ? null : Number(raw) });
}
function edit(account: Account) {
	const managed = managedAccount(account);
	if (managed) props.store.editCommandCodeAccount(managed);
}
</script>
<template>
	<div class="cp-stack cp-gap-8 cp-account-content">
		<UiCard appearance="antd" size="small" title="Add OAuth account" class="cp-card cp-card-small"
			><div class="cp-inline cp-wrap cp-gap-8">
				<UiButton
					v-for="provider in oauthProviders"
					:key="provider.provider"
					:variant="provider.primary ? 'primary' : 'default'"
					@click="store.startOAuth(provider.provider)"
				>
					<template #icon>
						<ProviderLogoComponent
							:provider="brandFor(provider.provider).label"
							:logo="brandFor(provider.provider).logo"
							alt=""
							image-class="provider-identity-logo"
							fallback-class="provider-identity-logo"
						/>
					</template>
					{{ provider.label }}
				</UiButton>
			</div>
			<p class="cp-secondary cp-mt-12 cp-no-margin-bottom">
				Device login is recommended for a remote deployment. Browser callback flows may require submitting a value requested in the
				session output.
			</p></UiCard
		>
		<UiCard appearance="antd" size="small" class="cp-card cp-card-small">
			<template #title>
				<span class="cp-card-title-with-logo">
					<ProviderLogoComponent
						:provider="brandFor('commandcode').label"
						:logo="brandFor('commandcode').logo"
						alt=""
						image-class="provider-identity-logo"
						fallback-class="provider-identity-logo"
					/>
					Add CommandCode account
				</span>
			</template>
			<div class="cp-inline cp-wrap cp-gap-8">
				<UiInput
					v-model="state.commandCodeLabel"
					placeholder="Label (optional)"
					class="cp-commandcode-label"
				/><CliProxyPasswordInput
					v-model="state.commandCodeKey"
					placeholder="CommandCode API key"
					class="cp-commandcode-key"
				/><UiButton
					variant="primary"
					:loading="state.busy === 'add commandcode account'"
					:disabled="state.commandCodeKey.trim().length === 0 || state.busy !== null"
					@click="store.addCommandCodeAccount"
					>Add</UiButton
				>
			</div>
			<p class="cp-secondary cp-mt-12 cp-no-margin-bottom">
				Stored in the LiteLLM config and materialized as a CPA auth file. Use Edit to rotate the key.
			</p></UiCard
		>
		<div class="cp-accounts-table-scroll">
			<table class="cp-accounts-table">
				<thead>
					<tr>
						<th>Provider</th>
						<th>Account</th>
						<th>File</th>
						<th>Enabled</th>
						<th>Weight</th>
						<th>Action</th>
					</tr>
				</thead>
				<tbody>
					<tr v-for="account in state.accounts" :key="account.auth_index">
						<td>
							<ProviderIdentityComponent :provider="account.provider" />
						</td>
						<td>{{ account.email ?? "—" }}</td>
						<td class="cp-account-filename" :title="account.filename">
							{{ account.filename }}<UiTag v-if="isTrashed(account)" color="orange" class="cp-ml-8">trashed</UiTag>
						</td>
						<td>
							<UiSwitch
								:model-value="!account.disabled"
								:disabled="isTrashed(account)"
								:label="'Enable ' + (account.email ?? account.filename)"
								@update:model-value="store.updateAccount(account, { disabled: !$event })"
							/>
						</td>
						<td>
							<UiInputNumber
								:min="1"
								:max="1000000"
								:model-value="account.weight"
								placeholder="default"
								:disabled="isTrashed(account)"
								class="cp-weight-input"
								@blur="saveWeight(account, $event)"
							/>
						</td>
						<td>
							<div class="cp-inline cp-gap-8">
								<UiButton v-if="managedAccount(account)" size="small" @click="edit(account)">Edit</UiButton
								><CliProxyConfirm
									v-if="managedAccount(account)"
									title="Delete this CommandCode account?"
									description="It will be removed from the LiteLLM config and its CPA auth file will be deleted."
									@confirm="store.removeAccount(account)"
									><UiButton size="small" danger>Delete</UiButton></CliProxyConfirm
								><CliProxyConfirm
									v-else-if="isTrashed(account)"
									title="Restore this account?"
									description="The token file will be moved back to the active auth directory."
									@confirm="store.removeAccount(account)"
									><UiButton size="small"
										><template #icon><UiIcon name="RollbackOutlined" /></template>Restore</UiButton
									></CliProxyConfirm
								><CliProxyConfirm
									v-else
									title="Move this account to .trash?"
									description="The token file is retained for recovery."
									@confirm="store.removeAccount(account)"
									><UiButton size="small" danger>Trash</UiButton></CliProxyConfirm
								>
							</div>
						</td>
					</tr>
					<tr v-if="state.accounts.length === 0">
						<td colspan="6" class="cp-table-empty">No data</td>
					</tr>
				</tbody>
			</table>
		</div>
	</div>
</template>
