<script setup lang="ts">
import { computed, ref } from "vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiHeroIcon from "../../platform/ui/UiHeroIcon.vue";
import ProviderLogoComponent from "../../providers/ui/ProviderLogoComponent.vue";
import { provider_map } from "../../providers/data/ProviderCatalogData";
import { getProviderLogoAndName } from "../../providers/logic/ProviderIdentityLogic";
import { useMoneyFormatter } from "../../platform/stores/PriceDisplayStore";
import { providerDisplayName } from "../logic/CostTrackingLogic";
import type { DiscountConfig, MarginConfig, MarginValue } from "../support/CostTrackingModels";
const props = defineProps<{ kind: "discount" | "margin"; config: DiscountConfig | MarginConfig }>();
const emit = defineEmits<{ change: [provider: string, value: MarginValue]; remove: [provider: string, name: string] }>();
const money = useMoneyFormatter(),
	editing = ref<string | null>(null),
	percentage = ref(""),
	fixed = ref("");
const rows = computed(() =>
	Object.entries(props.config)
		.map(([provider, value]) => ({ provider, value }))
		.sort((a, b) =>
			a.provider === "global"
				? -1
				: b.provider === "global"
					? 1
					: providerDisplayName(a.provider).localeCompare(providerDisplayName(b.provider)),
		),
);
function logo(provider: string) {
	return Object.values(provider_map).includes(provider) ? getProviderLogoAndName(provider).logo : "";
}
function start(provider: string, value: MarginValue) {
	editing.value = provider;
	percentage.value = typeof value === "number" ? String(value * 100) : value.percentage ? String(value.percentage * 100) : "";
	fixed.value = typeof value === "number" ? "" : value.fixed_amount ? String(value.fixed_amount) : "";
}
function cancel() {
	editing.value = null;
	percentage.value = "";
	fixed.value = "";
}
function save(provider: string) {
	const percent = percentage.value ? Number.parseFloat(percentage.value) : undefined,
		fixedValue = fixed.value ? Number.parseFloat(fixed.value) : undefined;
	if (props.kind === "discount") {
		if (percent !== undefined && !Number.isNaN(percent) && percent >= 0 && percent <= 100) emit("change", provider, percent / 100);
	} else if (percent !== undefined && !Number.isNaN(percent) && percent >= 0 && percent <= 1000) {
		emit(
			"change",
			provider,
			fixedValue !== undefined && !Number.isNaN(fixedValue) && fixedValue >= 0
				? { percentage: percent / 100, fixed_amount: fixedValue }
				: percent / 100,
		);
	} else if (fixedValue !== undefined && !Number.isNaN(fixedValue) && fixedValue >= 0)
		emit("change", provider, { fixed_amount: fixedValue });
	cancel();
}
function margin(value: MarginValue) {
	if (typeof value === "number") return (value * 100).toFixed(1) + "%";
	const parts: string[] = [];
	if (value.percentage !== undefined) parts.push((value.percentage * 100).toFixed(1) + "%");
	if (value.fixed_amount !== undefined) parts.push(money(value.fixed_amount, 6));
	return parts.join(" + ") || "0%";
}
</script>
<template>
	<div class="cost-provider-table-scroll">
		<table class="cost-provider-table">
			<thead>
				<tr>
					<th>Provider</th>
					<th :style="{ width: kind === 'margin' ? '350px' : '250px' }">
						{{ kind === "margin" ? "Margin" : "Discount Percentage" }}
					</th>
					<th style="width: 80px">Actions</th>
				</tr>
			</thead>
			<tbody>
				<tr v-for="row in rows" :key="row.provider">
					<td>
						<div class="cost-provider-name">
							<ProviderLogoComponent
								v-if="row.provider !== 'global' && logo(row.provider)"
								:provider="providerDisplayName(row.provider)"
								:logo="logo(row.provider)"
								image-class="cost-provider-logo"
								fallback-class="cost-provider-logo"
							/><span>{{ row.provider === "global" ? "Global (All Providers)" : providerDisplayName(row.provider) }}</span>
						</div>
					</td>
					<td>
						<div class="cost-provider-edit">
							<template v-if="editing === row.provider">
								<UiInput
									v-model="percentage"
									appearance="tremor"
									:placeholder="kind === 'margin' ? '10' : '5'"
									class="cost-percentage-input"
									autofocus
									@keydown.enter="save(row.provider)"
									@keydown.esc="cancel"
								/><span>%</span>
								<template v-if="kind === 'margin'"
									><span class="cost-plus">+</span><span>$</span
									><UiInput
										v-model="fixed"
										appearance="tremor"
										placeholder="0.001"
										class="cost-fixed-input"
										@keydown.enter="save(row.provider)"
										@keydown.esc="cancel"
								/></template>
								<button
									type="button"
									class="cost-icon-button cost-icon-green"
									:aria-label="'Save ' + row.provider"
									@click="save(row.provider)"
								>
									<UiHeroIcon name="CheckIcon" /></button
								><button type="button" class="cost-icon-button" aria-label="Cancel edit" @click="cancel">
									<UiHeroIcon name="XIcon" />
								</button>
							</template>
							<template v-else
								><span class="cost-provider-value">{{ margin(row.value) }}</span
								><button
									type="button"
									class="cost-icon-button cost-icon-blue"
									:aria-label="'Edit ' + row.provider"
									@click="start(row.provider, row.value)"
								>
									<UiHeroIcon name="PencilAltIcon" /></button
							></template>
						</div>
					</td>
					<td>
						<button
							type="button"
							class="cost-icon-button cost-icon-delete"
							:aria-label="'Remove ' + row.provider"
							@click="emit('remove', row.provider, providerDisplayName(row.provider))"
						>
							<UiHeroIcon name="TrashIcon" />
						</button>
					</td>
				</tr>
				<tr v-if="!rows.length">
					<td colspan="3" class="cost-provider-empty">
						No provider {{ kind === "margin" ? "margins" : "discounts" }} configured
					</td>
				</tr>
			</tbody>
		</table>
	</div>
</template>
