<script setup lang="ts">
import { computed, ref } from "vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import UiAlert from "../../platform/ui/UiAlert.vue";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import { usePriceDisplayStore } from "../../platform/stores/PriceDisplayStore";
import ProviderLogo from "../../providers/ui/ProviderLogoComponent.vue";
import ModelName from "../../providers/ui/ModelNameComponent.vue";
import { getProviderLogoAndName } from "../../providers/logic/ProviderIdentityLogic";
import { deploymentIconProps, modelPriceIdentity } from "../logic/ModelDataLogic";
import { modelOptions, type DisplayProxyModel } from "../support/ModelModels";
const props = defineProps<{ model: DisplayProxyModel }>();
const price = usePriceDisplayStore(),
	error = ref("");
const id = computed(() => props.model.model_info.id ?? props.model.model_name);
const currencies = computed(() =>
	[
		...new Set([
			"USD",
			"CNY",
			"EUR",
			"GBP",
			"JPY",
			"HKD",
			"SGD",
			...Object.keys(price.state.exchange?.rates ?? {}),
			price.state.settings.currency,
			price.state.settings.modelCurrencies[id.value],
		]),
	]
		.filter(Boolean)
		.sort(),
);
const items = computed(() => [
	{ label: "Provider", value: props.model.provider },
	{ label: "LiteLLM Model", value: props.model.litellm_model_name },
	{
		label: "Input / 1M",
		value: props.model.input_cost != null ? price.format(props.model.input_cost, 4, modelPriceIdentity(props.model)) : null,
	},
	{
		label: "Output / 1M",
		value: props.model.output_cost != null ? price.format(props.model.output_cost, 4, modelPriceIdentity(props.model)) : null,
	},
]);
function currency(value: unknown) {
	const next = typeof value === "string" ? value : "";
	const modelCurrencies = { ...price.state.settings.modelCurrencies };
	for (const key of [id.value, props.model.model_name]) {
		if (next) modelCurrencies[key] = next;
		else delete modelCurrencies[key];
	}
	try {
		price.save({ ...price.state.settings, modelCurrencies });
		error.value = "";
	} catch {
		error.value = "无法保存显示设置，请检查浏览器存储权限。";
	}
}
function date(value: string | null | undefined) {
	return value ? new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "-";
}
</script>
<template>
	<section class="model-overview">
		<div class="model-overview-grid">
			<div v-for="item in items" :key="item.label">
				<p>{{ item.label }}</p>
				<UiTooltip :title="String(item.value || '-')"
					><div class="model-overview-value" :class="{ 'model-unset': !item.value }">
						<template v-if="item.label === 'Provider' && item.value"
							><ProviderLogo :provider="model.provider" :logo="getProviderLogoAndName(model.provider).logo" /><span>{{
								item.value
							}}</span></template
						><ModelName
							v-else-if="item.label === 'LiteLLM Model' && item.value"
							v-bind="deploymentIconProps(model)"
							:name="String(item.value)"
							:size="24"
						/><span v-else>{{ item.value || "-" }}</span>
					</div></UiTooltip
				>
			</div>
		</div>
		<div class="model-currency-setting">
			<label
				>价格显示币种<UiSelect
					:model-value="price.state.settings.modelCurrencies[id] ?? ''"
					:options="[{ value: '', label: '跟随系统' }, ...modelOptions(currencies)]"
					searchable
					aria-label="价格显示币种"
					@update:model-value="currency" /></label
			><UiAlert v-if="error" type="error" :title="error" />
		</div>
		<div class="model-audit-info">
			<span
				><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
					/></svg
				>Created At {{ date(model.model_info.created_at) }}</span
			><span
				><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
					/></svg
				>Created By {{ model.model_info.created_by || "-" }}</span
			>
		</div>
	</section>
</template>
