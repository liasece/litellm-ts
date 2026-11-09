<script setup lang="ts">
import { computed, ref } from "vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiHeroIcon from "../../platform/ui/UiHeroIcon.vue";
import UiTable from "../../platform/ui/UiTable.vue";
import type { UiTableColumn, UiTableRow } from "../../platform/ui/UiTypes";
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
const columns = computed<readonly UiTableColumn[]>(() => [
	{ key: "provider", label: "Provider", width: 300 },
	{ key: "value", label: props.kind === "margin" ? "Margin" : "Discount Percentage", width: props.kind === "margin" ? 350 : 250 },
	{ key: "actions", label: "Actions", width: 100, sticky: "right" },
]);
const tableRows = computed<readonly UiTableRow[]>(() => rows.value as unknown as readonly UiTableRow[]);
const emptyText = computed(() => `No provider ${props.kind === "margin" ? "margins" : "discounts"} configured`);
type ProviderRow = { provider: string; value: MarginValue };
function providerRow(row: UiTableRow): ProviderRow {
	return row as unknown as ProviderRow;
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
	<UiTable :columns="columns" :rows="tableRows" row-key="provider" fixed-layout :empty-text="emptyText">
		<template #row="{ row }">
			<tr v-for="item in [providerRow(row)]" :key="item.provider" class="ui-table__row">
				<td>
					<div class="cost-provider-name">
						<ProviderLogoComponent
							v-if="item.provider !== 'global' && logo(item.provider)"
							:provider="providerDisplayName(item.provider)"
							:logo="logo(item.provider)"
							image-class="cost-provider-logo"
							fallback-class="cost-provider-logo"
						/><span>{{ item.provider === "global" ? "Global (All Providers)" : providerDisplayName(item.provider) }}</span>
					</div>
				</td>
				<td>
					<div class="cost-provider-edit">
						<template v-if="editing === item.provider">
							<UiInput
								v-model="percentage"
								appearance="tremor"
								:placeholder="kind === 'margin' ? '10' : '5'"
								class="cost-percentage-input"
								autofocus
								@keydown.enter="save(item.provider)"
								@keydown.esc="cancel"
							/><span>%</span>
							<template v-if="kind === 'margin'"
								><span class="cost-plus">+</span><span>$</span
								><UiInput
									v-model="fixed"
									appearance="tremor"
									placeholder="0.001"
									class="cost-fixed-input"
									@keydown.enter="save(item.provider)"
									@keydown.esc="cancel"
							/></template>
							<button
								type="button"
								class="cost-icon-button cost-icon-green"
								:aria-label="'Save ' + item.provider"
								@click="save(item.provider)"
							>
								<UiHeroIcon name="CheckIcon" /></button
							><button type="button" class="cost-icon-button" aria-label="Cancel edit" @click="cancel">
								<UiHeroIcon name="XIcon" />
							</button>
						</template>
						<template v-else
							><span class="cost-provider-value">{{ margin(item.value) }}</span
							><button
								type="button"
								class="cost-icon-button cost-icon-blue"
								:aria-label="'Edit ' + item.provider"
								@click="start(item.provider, item.value)"
							>
								<UiHeroIcon name="PencilAltIcon" /></button
						></template>
					</div>
				</td>
				<td class="ui-table__cell--sticky-right">
					<button
						type="button"
						class="cost-icon-button cost-icon-delete"
						:aria-label="'Remove ' + item.provider"
						@click="emit('remove', item.provider, providerDisplayName(item.provider))"
					>
						<UiHeroIcon name="TrashIcon" />
					</button>
				</td>
			</tr>
		</template>
	</UiTable>
</template>
