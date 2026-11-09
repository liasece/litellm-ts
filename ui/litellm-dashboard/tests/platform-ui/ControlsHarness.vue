<script setup lang="ts">
import { ref } from "vue";
import NotificationLayer from "../../src/features/notifications/ui/NotificationLayerComponent.vue";
import notificationManager from "../../src/features/notifications/logic/NotificationManager";
import KeyIdentityForm from "./KeyIdentityFormHarness.vue";
import UiInputNumber from "../../src/features/platform/ui/UiInputNumber.vue";
import UiHeroIcon from "../../src/features/platform/ui/UiHeroIcon.vue";
import UiIcon from "../../src/features/platform/ui/UiIcon.vue";
import UiAlert from "../../src/features/platform/ui/UiAlert.vue";
import UiButton from "../../src/features/platform/ui/UiButton.vue";
import UiDialog from "../../src/features/platform/ui/UiDialog.vue";
import UiDrawer from "../../src/features/platform/ui/UiDrawer.vue";
import UiInput from "../../src/features/platform/ui/UiInput.vue";
import UiPagination from "../../src/features/platform/ui/UiPagination.vue";
import UiSelect from "../../src/features/platform/ui/UiSelect.vue";
import UiTable from "../../src/features/platform/ui/UiTable.vue";
import UiTabs from "../../src/features/platform/ui/UiTabs.vue";
import UiTooltip from "../../src/features/platform/ui/UiTooltip.vue";
import type { UiTableRow, UiValue } from "../../src/features/platform/ui/UiTypes";

const tooltipTitle = ref<string | number | null>("Mutable help");
const password = ref<string | number | null>("synthetic fixture");
const provider = ref<UiValue | UiValue[] | null>(null);
const options = [
	{ value: "openai", label: "OpenAI" },
	{ value: "anthropic", label: "Anthropic" },
	{ value: "disabled", label: "Disabled provider", disabled: true },
];
const tremorTab = ref("first");
const narrowTab = ref("callbacks");
const resizeTab = ref("overview");
const disabledCurrent = ref<UiValue | UiValue[] | null>("current");
const normalCurrent = ref<UiValue | UiValue[] | null>("second");
const allDisabled = ref<UiValue | UiValue[] | null>("current");
const chineseAccepts = ref(0);
const alertCloses = ref(0);
const inlineClicks = ref(0);
const dialogOpen = ref(false);
const drawerOpen = ref(false);
const longOpen = ref(false);
const budget = ref<number | null>(null);
const formattedTokens = ref<number | null>(1000);
const formatTokens = (value: number | string | null | undefined) => (value == null ? "" : Number(value).toLocaleString("en-US"));
const remote = ref<UiValue | UiValue[] | null>(null);
const tags = ref<UiValue | UiValue[] | null>([]);
const endpoints = ref<UiValue | UiValue[] | null>(["https://api.deepseek.com"]);
const multiline = ref<string | number | null>("");
const selectedKeys = ref<(string | number)[]>([]);
const rows: UiTableRow[] = [
	{ id: 1, name: "Twenty", count: 20 },
	{ id: 2, name: "Three", count: 3 },
	{ id: 3, name: "Hundred", count: 100 },
];
const page = ref(1);
const pageSize = ref(10);
const draft = ref<string | number | null>("");
</script>

<template>
	<main style="padding: 24px; max-width: 1000px">
		<UiAlert data-testid="single-line-alert" title="Single message" />
		<UiAlert data-testid="two-line-alert"
			><template #title>First line<br />Second line</template></UiAlert
		>
		<UiAlert data-testid="custom-alert" title="Policy alert"
			><template #icon
				><span data-testid="custom-alert-icon"><UiIcon name="InfoCircleOutlined" /></span></template
			>Policy description</UiAlert
		>
		<UiAlert data-testid="default-alert">Default information</UiAlert>
		<UiAlert data-testid="action-alert" title="Service issue" closable style="width: 342px" @close="alertCloses++">
			<template #action><UiButton size="small" variant="link">Inspect alert</UiButton></template>
		</UiAlert>
		<UiAlert data-testid="description-action-alert" title="DeepSeek may be experiencing a service issue" style="width: 342px">
			One recent request returned a server error.
			<template #action><UiButton size="small" variant="link">Inspect description</UiButton></template>
		</UiAlert>
		<output data-testid="alert-closes">{{ alertCloses }}</output>
		<div data-testid="responsive-antd-buttons" style="display: flex; width: 200px">
			<span style="flex: 0 0 100px">Section title</span>
			<UiButton style="min-width: 0" data-testid="shrinkable-antd-button"><UiIcon name="DownloadOutlined" />Export data</UiButton>
		</div>
		<UiButton data-testid="inline-icon-button" @click="inlineClicks++"
			><UiIcon name="PlusOutlined" /><span data-testid="inline-icon-label">Use AI to add guardrails</span></UiButton
		>
		<output data-testid="inline-clicks">{{ inlineClicks }}</output>
		<UiButton appearance="tremor" variant="primary" data-testid="tremor-icon-sm"
			><template #icon><UiHeroIcon name="PlusIcon" /></template>Save</UiButton
		>
		<UiButton appearance="tremor" variant="text" size="small" data-testid="tremor-icon-xs"
			><template #icon><UiHeroIcon name="ArrowLeftIcon" /></template>Back</UiButton
		>
		<UiButton appearance="tremor" variant="primary" size="large" data-testid="tremor-icon-lg"
			><template #icon><UiHeroIcon name="PlusIcon" /></template>Save</UiButton
		>
		<UiButton appearance="tremor" data-testid="tremor-antd-icon"
			><template #icon><UiIcon name="CodeOutlined" :size="14" /></template>Get Code</UiButton
		>
		<UiButton appearance="tremor" loading data-testid="tremor-loading"
			><template #icon><UiHeroIcon name="PlusIcon" /></template>Saving</UiButton
		>
		<div data-testid="inherited-tremor-font" style="font-family: var(--ui-font-antd)">
			<UiTabs model-value="one" appearance="tremor" :items="[{ key: 'one', label: 'Nested overview' }]" />
			<UiSelect :options="[{ value: 'one', label: 'Nested option' }]" appearance="tremor" aria-label="Nested inherited choice" />
			<UiTable appearance="tremor" :columns="[{ key: 'name', label: 'Nested header' }]" :rows="[{ id: 1, name: 'Nested value' }]" />
		</div>
		<UiButton @click="chineseAccepts++">接受</UiButton>
		<UiButton variant="text">查看</UiButton>
		<UiButton appearance="tremor">保存</UiButton>
		<UiButton :auto-insert-space="false">取消</UiButton>
		<output data-testid="chinese-accepts">{{ chineseAccepts }}</output>
		<div data-testid="antd-navigation" style="width: 360px">
			<UiTabs
				model-value="overview"
				:items="[
					{ key: 'overview', label: 'Overview' },
					{ key: 'settings', label: 'Settings' },
				]"
			/>
			<p data-testid="after-antd-navigation">Panel content</p>
		</div>
		<div data-testid="responsive-antd-navigation" style="max-width: 600px; width: 100%">
			<UiTabs
				v-model="resizeTab"
				:items="[
					{ key: 'overview', label: 'Overview' },
					{ key: 'keys', label: 'Virtual Keys' },
					{ key: 'members', label: 'Member Permissions' },
					{ key: 'settings', label: 'Settings' },
				]"
			/>
		</div>
		<div data-testid="tremor-navigation" style="width: 360px">
			<UiTabs
				v-model="tremorTab"
				appearance="tremor"
				:items="[
					{ key: 'first', label: 'Overview' },
					{ key: 'second', label: 'Settings' },
				]"
			/>
		</div>
		<div data-testid="narrow-tremor-navigation" style="width: 320px">
			<UiTabs
				v-model="narrowTab"
				appearance="tremor"
				:items="[
					{ key: 'callbacks', label: 'Logging Callbacks' },
					{ key: 'cloudzero', label: 'CloudZero' },
					{ key: 'types', label: 'Alerting Types' },
					{ key: 'settings', label: 'Alerting Settings' },
					{ key: 'email', label: 'Email Alerts' },
				]"
			/>
			<output data-testid="narrow-tremor-page">{{ narrowTab }}</output>
		</div>
		<UiSelect
			v-model="disabledCurrent"
			:options="[
				{ value: 'current', label: 'Current worker', disabled: true },
				{ value: 'unavailable', label: 'Unavailable worker', disabled: true },
				{ value: 'other', label: 'Other worker' },
			]"
			aria-label="Disabled current worker"
		/>
		<output data-testid="disabled-current-value">{{ disabledCurrent }}</output>
		<UiSelect
			v-model="normalCurrent"
			:options="[
				{ value: 'first', label: 'First worker' },
				{ value: 'second', label: 'Second worker' },
				{ value: 'third', label: 'Third worker' },
			]"
			aria-label="Normal current worker"
		/>
		<output data-testid="normal-current-value">{{ normalCurrent }}</output>
		<UiSelect
			v-model="allDisabled"
			:options="[
				{ value: 'current', label: 'Only current worker', disabled: true },
				{ value: 'other', label: 'Only other worker', disabled: true },
			]"
			aria-label="All disabled workers"
		/>
		<output data-testid="all-disabled-value">{{ allDisabled }}</output>
		<label>Provider<UiSelect v-model="provider" :options="options" searchable clearable aria-label="Provider" /></label>
		<output data-testid="provider">{{ provider }}</output>
		<UiButton @click="dialogOpen = true">Open dialog</UiButton>
		<UiButton @click="drawerOpen = true">Open drawer</UiButton>
		<UiDialog v-model:open="dialogOpen" title="Edit model" @ok="dialogOpen = false">
			<UiInput v-model="draft" aria-label="Model name" />
			<UiSelect v-model="provider" :options="options" searchable aria-label="Dialog provider" />
		</UiDialog>
		<UiDrawer v-model:open="drawerOpen" title="Request details" class="request-details-fixture" style="padding: 0" data-panel="request"
			><UiInput v-model="draft" aria-label="Request note"
		/></UiDrawer>
		<UiTable
			v-model:selected-keys="selectedKeys"
			:columns="[
				{ key: 'name', label: 'Name' },
				{ key: 'count', label: 'Count', sortable: true },
			]"
			:rows="rows"
			selection="multiple"
			data-testid="numeric-table"
		/>
		<div data-testid="body-height-fixture" style="width: 260px">
			<UiTable
				:columns="[{ key: 'name', label: 'A header whose words wrap over multiple lines' }]"
				:rows="Array.from({ length: 10 }, (_, i) => ({ id: i, name: 'Body row ' + (i + 1) }))"
				:body-max-height="80"
				sticky-header
				class="body-height-fixture-table"
			/>
		</div>
		<output data-testid="selected">{{ selectedKeys.join(",") }}</output>
		<UiPagination v-model="page" v-model:page-size="pageSize" :total="53" :page-size-options="[10, 25]" show-size-changer />
		<output data-testid="pagination">{{ page }}/{{ pageSize }}</output>
		<div>
			<UiButton aria-label="Compact settings"
				><template #icon><UiIcon name="SettingOutlined" /></template></UiButton
			><UiButton size="small" aria-label="Small compact settings"
				><template #icon><UiIcon name="SettingOutlined" /></template></UiButton
			><UiButton size="large" variant="text" aria-label="Large compact settings"
				><template #icon><UiIcon name="SettingOutlined" /></template
			></UiButton>
		</div>
		<UiSelect
			v-model="remote"
			:options="[{ value: 'opaque-id', label: 'Research owner' }]"
			searchable
			:filterable="false"
			aria-label="Remote owner"
		/>
		<UiSelect v-model="tags" :options="[]" multiple searchable creatable :token-separators="[',']" aria-label="Custom tags" />
		<output data-testid="tags">{{ tags }}</output>
		<UiSelect
			v-model="endpoints"
			:options="[]"
			multiple
			searchable
			creatable
			placeholder="Enter API base"
			style="width: 300px"
			aria-label="Compact endpoint tags"
		/>
		<output data-testid="endpoint-tags">{{ endpoints }}</output>
		<UiInput
			v-model="multiline"
			multiline
			:auto-size="{ minRows: 2, maxRows: 4 }"
			class="custom-draft-size"
			style="width: 180px"
			aria-label="Auto sized draft"
		/>
		<UiButton @click="longOpen = true">Open long form</UiButton>
		<UiDialog v-model:open="longOpen" title="Long key form" scroll-mode="overlay" :show-footer="false"
			><UiButton @click="notificationManager.info('Fixture inside modal')">Notify inside modal</UiButton>
			<div style="height: 1600px">Long settings</div>
			<UiButton @click="longOpen = false">Save long form</UiButton></UiDialog
		>
		<UiButton @click="notificationManager.error('Fixture notification')">Notify error</UiButton>
		<div class="tremor-number-fixture" style="width: 400px">
			<UiInputNumber v-model="budget" appearance="tremor" :step="0.01" aria-label="Tremor budget" />
		</div>
		<UiInputNumber v-model="formattedTokens" :formatter="formatTokens" :min="0" :max="1000000" aria-label="Formatted tokens" />
		<output data-testid="formatted-tokens">{{ formattedTokens === null ? "empty" : formattedTokens }}</output>
		<KeyIdentityForm kind="create-fixture" class="create-key-fixture" /><KeyIdentityForm kind="edit-fixture" class="edit-key-fixture" />
		<UiInput v-model="password" appearance="tremor" type="password" aria-label="Provider password" />
		<UiInput v-model="password" type="password" aria-label="Native password" />
		<section aria-label="Tooltip content fixtures">
			<UiTooltip><UiButton>Undefined help</UiButton></UiTooltip>
			<UiTooltip title=""><UiButton>Empty help</UiButton></UiTooltip>
			<UiInput v-model="tooltipTitle" aria-label="Tooltip title" />
			<UiTooltip :title="String(tooltipTitle ?? '')"><UiButton>Dynamic help</UiButton></UiTooltip>
			<UiTooltip content="Forwarded help"><UiButton>Forwarded help trigger</UiButton></UiTooltip>
			<UiTooltip
				><UiButton>Slotted help trigger</UiButton><template #content><strong>Slotted help</strong></template></UiTooltip
			>
		</section>
		<NotificationLayer />
	</main>
</template>

<style>
.body-height-fixture-table .ui-table {
	table-layout: fixed;
}
.body-height-fixture-table th {
	white-space: normal;
	word-break: break-word;
}
</style>
