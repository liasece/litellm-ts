<script setup lang="ts">
import UiDialog from "../../platform/ui/UiDialog.vue";
import UiFormField from "../../platform/ui/UiFormField.vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiSwitch from "../../platform/ui/UiSwitch.vue";
import UiCheckbox from "../../platform/ui/UiCheckbox.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiAlert from "../../platform/ui/UiAlert.vue";
import UiSpinner from "../../platform/ui/UiSpinner.vue";
import { LOGS_OPTIONAL_COLUMNS, type LogsOptionalColumnId } from "../support/LogsModels";
import type { LogsSettingsStore } from "../stores/LogsSettingsStore";
const retentionHelp =
	"Set the maximum retention period for spend logs (e.g., '7d' for 7 days, '30d' for 30 days). Leave empty for no limit.";
const props = defineProps<{ store: LogsSettingsStore }>();
function description(name: string, fallback: string) {
	return props.store.state.fields.find((field) => field.field_name === name)?.field_description || fallback;
}
function toggleColumn(id: LogsOptionalColumnId, on: boolean) {
	props.store.setColumns(on ? [...props.store.columns.value, id] : props.store.columns.value.filter((value) => value !== id));
}
</script>
<template>
	<UiDialog
		:open="store.state.open"
		@update:open="store.setOpen"
		title="Spend Logs Settings"
		class="logs-settings-dialog"
		scroll-mode="overlay"
		@ok="store.save"
	>
		<UiAlert v-if="store.state.error" type="error" style="margin-bottom: 16px">{{ store.state.error }}</UiAlert>
		<div v-if="store.state.loading" style="text-align: center; padding: 24px"><UiSpinner /></div>
		<template v-else>
			<UiFormField horizontal>
				<template #label
					><span class="logs-settings-label"
						><span>Store Prompts in Spend Logs</span
						><UiTooltip
							:content="
								description(
									'store_prompts_in_spend_logs',
									'When enabled, prompts will be stored in spend logs for tracking and analysis purposes.',
								)
							"
							><UiIcon name="QuestionCircleOutlined" /></UiTooltip></span
				></template>
				<div class="logs-settings-switch">
					<UiSwitch
						:model-value="store.state.storePrompts"
						@update:model-value="store.setPrompts"
						label="Store Prompts in Spend Logs"
					/>
				</div>
			</UiFormField>
			<UiFormField horizontal>
				<template #label
					><span class="logs-settings-label"
						><span>Store Upstream Logs in Spend Logs</span
						><UiTooltip
							:content="
								description(
									'store_upstream_logs_in_spend_logs',
									'When enabled, the transformed request sent to the provider and the provider response will be stored in spend logs.',
								)
							"
							><UiIcon name="QuestionCircleOutlined" /></UiTooltip></span
				></template>
				<div class="logs-settings-switch">
					<UiSwitch
						:model-value="store.state.storeUpstream"
						@update:model-value="store.setUpstream"
						label="Store Upstream Logs in Spend Logs"
					/>
				</div>
			</UiFormField>
			<UiFormField horizontal>
				<template #label
					><span class="logs-settings-label"
						><span>Maximum Spend Logs Retention Period (Optional)</span
						><UiTooltip :content="description('maximum_spend_logs_retention_period', retentionHelp)"
							><UiIcon name="QuestionCircleOutlined" /></UiTooltip></span
				></template>
				<UiInput :model-value="store.state.retention" @update:model-value="store.setRetention" placeholder="e.g., 7d, 30d"
					><template #prefix><UiIcon name="ClockCircleOutlined" /></template
				></UiInput>
			</UiFormField>
			<div class="logs-extra-columns-title">Additional columns</div>
			<UiFormField label="Show extra columns" horizontal>
				<template #label
					><span class="logs-settings-label"
						><span>Show extra columns</span
						><UiTooltip
							content="These columns are hidden by default to keep the request log table compact. Changes apply immediately and are stored in this browser only."
							><UiIcon name="QuestionCircleOutlined" /></UiTooltip></span
				></template>
				<div class="logs-extra-columns">
					<UiCheckbox
						v-for="column in LOGS_OPTIONAL_COLUMNS"
						:key="column.id"
						:model-value="store.columns.value.includes(column.id)"
						@update:model-value="toggleColumn(column.id, $event)"
						>{{ column.label }}</UiCheckbox
					>
				</div>
			</UiFormField>
		</template>
		<template #footer
			><UiButton :disabled="store.state.loading || store.state.saving" @click="store.setOpen(false)">Cancel</UiButton
			><UiButton variant="primary" :loading="store.state.saving" :disabled="store.state.loading" @click="store.save">{{
				store.state.saving ? "Saving..." : "Save Settings"
			}}</UiButton></template
		>
	</UiDialog>
</template>
<style>
.logs-settings-dialog .ui-dialog__title {
	font-size: 16px;
	font-weight: 600;
	line-height: 24px;
}
.logs-settings-dialog .ui-form-field--horizontal {
	display: flex;
	flex-wrap: wrap;
	gap: 0;
}
.logs-settings-dialog .ui-form-field__label {
	flex: none;
	display: inline-block;
	padding: 0;
	overflow: hidden;
	white-space: nowrap;
	text-align: right;
	vertical-align: middle;
}
.logs-settings-label {
	position: relative;
	display: inline-flex;
	align-items: center;
	height: 32px;
	max-width: 100%;
}
.logs-settings-label::after {
	content: ":";
	margin: 0 8px 0 2px;
}
.logs-settings-label .ui-popover-anchor {
	display: flex;
	align-items: center;
	margin-left: 4px;
	line-height: 0;
	color: #00000073;
}
.logs-settings-dialog .ui-form-field__control {
	flex: 1;
	min-width: 0;
	min-height: 32px;
	display: flex;
	align-items: center;
}
@media (max-width: 575px) {
	.logs-settings-dialog .ui-form-field__label {
		width: 100%;
		padding: 0 0 8px;
		white-space: initial;
		text-align: left;
	}
	.logs-settings-label {
		white-space: normal;
	}
	.logs-settings-label::after {
		visibility: hidden;
	}
	.logs-settings-dialog .ui-form-field__control {
		flex-basis: 100%;
	}
}
.logs-extra-columns-title {
	margin: 8px 0 12px;
	font-size: 14px;
	line-height: 20px;
	font-weight: 500;
	color: #111827;
}
.logs-extra-columns .ui-checkbox {
	padding-right: 8px;
}
.logs-extra-columns {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 4px;
}
</style>
