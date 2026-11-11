<script setup lang="ts">
import { computed, ref } from "vue";
import UiTable from "../../platform/ui/UiTable.vue";
import { filterRowsByFields } from "../../platform/ui/UiTableFilterLogic";
import type { UiTableActiveFilter, UiTableFilterField } from "../../platform/ui/UiTableFilterModels";
import type { UiTableColumn, UiTableRow, UiTableSort } from "../../platform/ui/UiTypes";
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
const props = withDefaults(
	defineProps<{
		store: CliProxyStore;
		sources?: readonly string[];
		showCommandKeyForm?: boolean;
		/** 单 Provider 板块内账号表已限定来源，隐藏重复的 Provider 列与筛选。 */
		showProviderColumn?: boolean;
		/** 没有账号时不渲染空表：订阅页按 Provider 分板块，空板块只保留添加入口。 */
		hideTableWhenEmpty?: boolean;
	}>(),
	{ sources: undefined, showCommandKeyForm: undefined, showProviderColumn: true, hideTableWhenEmpty: false },
);
const state = props.store.state;
const allOauthProviders = [
	{ provider: "codex-device", label: "Codex device login", primary: true, source: "codex" },
	{ provider: "codex", label: "Codex browser login", source: "codex" },
	{ provider: "claude", label: "Claude login", source: "claude" },
	{ provider: "antigravity", label: "Antigravity login", source: "antigravity" },
	{ provider: "kimi", label: "Kimi login", source: "kimi" },
	{ provider: "xai", label: "xAI login", source: "xai" },
];
const oauthProviders = computed(() =>
	props.sources ? allOauthProviders.filter((provider) => props.sources!.includes(provider.source)) : allOauthProviders,
);
const showsCommandCode = computed(() => !props.sources || props.sources.includes("commandcode"));
const visibleAccounts = computed(() =>
	props.sources ? state.accounts.filter((account) => props.sources!.includes(account.provider.trim().toLowerCase())) : state.accounts,
);
const brandFor = (provider: string) => getProviderBrand(provider);
const managedAccount = (account: Account) => state.commandCodeAccounts.find((item) => item.filename === account.filename);
const isTrashed = (account: Account) => account.filename.startsWith(".trash/");
const rateLimitTitle = (account: Account): string => {
	const snapshot = account.rate_limit;
	if (!snapshot) return "";
	return Object.entries(snapshot.headers)
		.map(([key, value]) => key + ": " + value)
		.join("\n");
};
const activeFilters = ref<UiTableActiveFilter[]>([]);
const sort = ref<{ key: string; order: "asc" | "desc" | null }>({ key: "", order: null });
const providerFilter = computed<readonly UiTableFilterField[]>(() => [
	{
		key: "provider",
		label: "Provider",
		control: {
			kind: "select",
			searchable: true,
			options: [...new Set(visibleAccounts.value.map((account) => account.provider))].filter(Boolean).map((provider) => ({
				value: provider,
				label: provider,
			})),
		},
	},
]);
const accountFilter: readonly UiTableFilterField[] = [
	{ key: "account", label: "Account", control: { kind: "text", placeholder: "Filter by account email" } },
];
const fileFilter: readonly UiTableFilterField[] = [
	{ key: "file", label: "File", control: { kind: "text", placeholder: "Filter by auth file" } },
];
const enabledFilter: readonly UiTableFilterField[] = [
	{
		key: "enabled",
		label: "Enabled",
		control: {
			kind: "select",
			options: [
				{ value: "Enabled", label: "Enabled" },
				{ value: "Disabled", label: "Disabled" },
			],
		},
	},
];
const columns = computed<readonly UiTableColumn[]>(() => {
	const providerColumn: UiTableColumn[] = props.showProviderColumn
		? [{ key: "provider", label: "Provider", width: 160, sortable: true, filters: providerFilter.value }]
		: [];
	return [
		...providerColumn,
		{ key: "account", label: "Account", width: 220, sortable: true, filters: accountFilter },
		{ key: "file", label: "File", width: 320, sortable: true, filters: fileFilter },
		{ key: "enabled", label: "Enabled", width: 100, filters: enabledFilter },
		{ key: "status", label: "Status", width: 180, sortable: true },
		{ key: "weight", label: "Weight", width: 110, sortable: true, initialSortOrder: "desc" },
		{ key: "actions", label: "Action", width: 220, sticky: "right" },
	];
});
function accountValue(account: Account, key: string): string | number {
	if (key === "account") return account.email ?? "";
	if (key === "file") return account.filename;
	if (key === "enabled") return account.disabled ? "Disabled" : "Enabled";
	if (key === "weight") return account.weight ?? 0;
	if (key === "status") return account.status ?? account.last_error ?? "";
	if (key === "rate_limit") return account.rate_limit?.limited ? "Rate limited" : "";
	return account.provider ?? "";
}
const filteredAccounts = computed(() =>
	filterRowsByFields(visibleAccounts.value, activeFilters.value, (row, key) => accountValue(row as Account, key)),
);
const sortedAccounts = computed(() => {
	if (!sort.value.order) return filteredAccounts.value;
	const direction = sort.value.order === "asc" ? 1 : -1;
	return [...filteredAccounts.value].sort((a, b) => {
		const left = accountValue(a as Account, sort.value.key);
		const right = accountValue(b as Account, sort.value.key);
		if (typeof left === "number" && typeof right === "number") return (left - right) * direction;
		return String(left).localeCompare(String(right), undefined, { numeric: true }) * direction;
	});
});
const emptyText = computed(() => (activeFilters.value.length ? "No accounts match the current filters" : "No data"));
const tableVisible = computed(() => !props.hideTableWhenEmpty || visibleAccounts.value.length > 0);
function changeSort(next: UiTableSort): void {
	sort.value = { key: next.order ? next.key : "", order: next.order };
}
function accountRow(row: UiTableRow): Account {
	return row as unknown as Account;
}
function applyAccountFilters(entries: readonly UiTableActiveFilter[]): void {
	const next = activeFilters.value.filter((filter) => !entries.some((entry) => entry.key === filter.key));
	for (const entry of entries) {
		if (entry.value.trim()) next.push({ ...entry, value: entry.value.trim(), text: entry.text || entry.value.trim() });
	}
	activeFilters.value = next;
}
function removeAccountFilter(key: string): void {
	activeFilters.value = activeFilters.value.filter((filter) => filter.key !== key);
}
function clearAccountFilters(): void {
	activeFilters.value = [];
}
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
		<UiCard v-if="oauthProviders.length" appearance="antd" size="small" title="Add OAuth account" class="cp-card cp-card-small"
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
		<UiCard v-if="showsCommandCode && showCommandKeyForm !== false" appearance="antd" size="small" class="cp-card cp-card-small">
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
				Stored in the LiteLLM config and materialized as a subscription auth file. Use Edit to rotate the key.
			</p></UiCard
		>
		<UiTable
			v-if="tableVisible"
			:columns="columns"
			:rows="sortedAccounts"
			row-key="auth_index"
			:loading="state.loading"
			loading-text="🚅 Loading accounts..."
			fixed-layout
			manual-sort
			:sort-by="sort.order ? sort.key : undefined"
			:sort-order="sort.order ?? 'asc'"
			:active-filters="activeFilters"
			:empty-text="emptyText"
			@sort="changeSort"
			@filter-change="applyAccountFilters"
			@remove-filter="removeAccountFilter"
			@clear-filters="clearAccountFilters"
		>
			<template #row="{ row }">
				<tr v-for="account in [accountRow(row)]" :key="account.auth_index" class="ui-table__row">
					<td v-if="showProviderColumn"><ProviderIdentityComponent :provider="account.provider" /></td>
					<td>{{ account.email ?? "—" }}</td>
					<td class="cp-account-filename" :title="account.filename">
						{{ account.filename }}<UiTag v-if="isTrashed(account)" color="orange" class="cp-ml-8">trashed</UiTag>
					</td>
					<td :title="account.last_error ?? rateLimitTitle(account)">
						<UiTag v-if="account.status" color="red">{{ account.status }}</UiTag>
						<UiTag v-else-if="account.rate_limit?.limited" color="orange">rate limited</UiTag>
						<span v-else>—</span>
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
							:min="0"
							:max="1000000"
							:model-value="account.weight"
							placeholder="default"
							:disabled="isTrashed(account)"
							class="cp-weight-input"
							@blur="saveWeight(account, $event)"
						/>
					</td>
					<td class="ui-table__cell--sticky-right">
						<div class="cp-inline cp-gap-8">
							<UiButton v-if="managedAccount(account)" size="small" @click="edit(account)">Edit</UiButton
							><CliProxyConfirm
								v-if="managedAccount(account)"
								title="Delete this CommandCode account?"
								description="It will be removed from the LiteLLM config and its subscription auth file will be deleted."
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
			</template>
		</UiTable>
	</div>
</template>
