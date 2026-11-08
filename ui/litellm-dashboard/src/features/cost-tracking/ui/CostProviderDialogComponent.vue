<script setup lang="ts">
import { computed, ref, watch } from "vue";
import UiDialog from "../../platform/ui/UiDialog.vue";
import UiFormField from "../../platform/ui/UiFormField.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import ProviderLogoComponent from "../../providers/ui/ProviderLogoComponent.vue";
import { Providers, provider_map } from "../../providers/data/ProviderCatalogData";
import { getProviderLogoAndName } from "../../providers/logic/ProviderIdentityLogic";
import type { DiscountConfig, MarginConfig } from "../support/CostTrackingModels";
const props = defineProps<{ open: boolean; kind: "discount" | "margin"; config: DiscountConfig | MarginConfig }>();
const emit = defineEmits<{
	"update:open": [value: boolean];
	submit: [provider: string | undefined, percentage: string, fixed: string, type: "percentage" | "fixed"];
}>();
const selected = ref<string | null>(null),
	percentage = ref(""),
	fixed = ref(""),
	type = ref<"percentage" | "fixed">("percentage");
const providerHelp = computed(() =>
	props.kind === "margin"
		? "Select 'Global' to apply margin to all providers, or select a specific provider"
		: "Select the LLM provider you want to configure a discount for",
);
const providerPlaceholder = computed(() => (props.kind === "margin" ? "Select provider or 'Global'" : "Select provider"));
const title = computed(() => (props.kind === "margin" ? "Add Provider Margin" : "Add Provider Discount"));
const choices = computed(() => [
	...(props.kind === "margin" ? [{ value: "global", label: "Global (All Providers)" }] : []),
	...Object.entries(Providers).flatMap(([key, label]) => {
		const value = provider_map[key];
		return value && props.config[value] ? [] : [{ value: key, label }];
	}),
]);
function logo(key: string | number) {
	const value = provider_map[String(key)];
	return value ? getProviderLogoAndName(value).logo : "";
}
watch(
	() => props.open,
	(value) => {
		if (!value) {
			selected.value = null;
			percentage.value = "";
			fixed.value = "";
			type.value = "percentage";
		}
	},
);
</script>
<template>
	<UiDialog
		:open="open"
		:title="title"
		:width="1000"
		:show-footer="false"
		class="cost-provider-dialog"
		scroll-mode="overlay"
		@update:open="emit('update:open', $event)"
	>
		<template #title
			><span class="cost-provider-dialog-title">
				<span class="cost-provider-dialog-heading">{{ title }}</span>
			</span></template
		>
		<div class="cost-provider-dialog-content">
			<p>
				{{
					kind === "discount"
						? "Select a provider and set its discount percentage. Enter a value between 0% and 100% (e.g., 5 for a 5% discount)."
						: 'Select a provider (or "Global" for all providers) and configure the margin. You can use percentage-based or fixed amount.'
				}}
			</p>
			<UiFormField>
				<template #label
					><span
						>Provider <UiTooltip :title="providerHelp"><UiIcon name="InfoCircleOutlined" /></UiTooltip></span
				></template>
				<UiSelect v-model="selected" :options="choices" searchable size="large" :placeholder="providerPlaceholder"
					><template #option="{ option }"
						><div class="cost-provider-option">
							<ProviderLogoComponent
								v-if="option.value !== 'global' && logo(option.value)"
								:provider="option.label"
								:logo="logo(option.value)"
								image-class="cost-provider-logo"
								fallback-class="cost-provider-logo"
							/><span>{{ option.label }}</span>
						</div></template
					><template #value="{ option }"
						><span class="cost-provider-option"
							><ProviderLogoComponent
								v-if="option.value !== 'global' && logo(option.value)"
								:provider="option.label"
								:logo="logo(option.value)"
								image-class="cost-provider-logo"
								fallback-class="cost-provider-logo"
							/><span>{{ option.label }}</span></span
						></template
					></UiSelect
				>
			</UiFormField>
			<UiFormField v-if="kind === 'margin'">
				<template #label
					><span
						>Margin Type
						<UiTooltip title="Choose how to apply the margin: percentage-based or fixed amount"
							><UiIcon name="InfoCircleOutlined" /></UiTooltip></span
				></template>
				<div class="cost-radio-options">
					<label><input v-model="type" type="radio" value="percentage" />Percentage-based</label
					><label><input v-model="type" type="radio" value="fixed" />Fixed Amount</label>
				</div>
			</UiFormField>
			<UiFormField v-if="kind === 'discount' || type === 'percentage'">
				<template #label
					><span
						>{{ kind === "discount" ? "Discount Percentage" : "Margin Percentage" }}
						<UiTooltip
							:title="
								kind === 'discount'
									? 'Enter a percentage value (e.g., 5 for 5% discount)'
									: 'Enter a percentage value (e.g., 10 for 10% margin)'
							"
							><UiIcon name="InfoCircleOutlined" /></UiTooltip></span
				></template>
				<div class="cost-form-inline">
					<UiInput v-model="percentage" appearance="tremor" :placeholder="kind === 'margin' ? '10' : '5'" /><span>%</span>
				</div>
			</UiFormField>
			<UiFormField v-else>
				<template #label
					><span
						>Fixed Margin Amount
						<UiTooltip title="Enter a fixed amount in USD (e.g., 0.001 for $0.001 per request)"
							><UiIcon name="InfoCircleOutlined" /></UiTooltip></span
				></template>
				<div class="cost-form-inline"><span>$</span><UiInput v-model="fixed" appearance="tremor" placeholder="0.001" /></div>
			</UiFormField>
			<div class="cost-provider-form-actions">
				<UiButton
					appearance="tremor"
					variant="primary"
					:disabled="!selected || (kind === 'discount' || type === 'percentage' ? !percentage : !fixed)"
					@click="emit('submit', selected ?? undefined, percentage, fixed, type)"
					>{{ title }}</UiButton
				>
			</div>
		</div>
	</UiDialog>
</template>
