<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { useAuthenticationStore } from "../../identity/stores/AuthenticationStore";
import UiTabs from "../../platform/ui/UiTabs.vue";
import UiDialog from "../../platform/ui/UiDialog.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import CostAccordionChevronComponent from "./CostAccordionChevronComponent.vue";
import DocsMenuComponent from "../../help/ui/DocsMenuComponent.vue";
import { createCostTrackingStore } from "../stores/CostTrackingStore";
import type { MarginValue } from "../support/CostTrackingModels";
import CostProviderTableComponent from "./CostProviderTableComponent.vue";
import CostProviderDialogComponent from "./CostProviderDialogComponent.vue";
import CostHowItWorksComponent from "./CostHowItWorksComponent.vue";
import PricingCalculatorComponent from "./PricingCalculatorComponent.vue";
import "./CostTrackingStyles.css";
const auth = useAuthenticationStore(),
	store = createCostTrackingStore(),
	opened = reactive({ discount: false, margin: false, pricing: true }),
	discountTab = ref("discounts"),
	discountDialog = ref(false),
	marginDialog = ref(false),
	removal = ref<{ kind: "discount" | "margin"; provider: string; name: string } | null>(null);
const proxyAdmin = computed(() => ["proxy_admin", "Admin"].includes(auth.userRole.value));
const docs = [
	{ label: "Custom pricing for models", href: "https://docs.litellm.ai/docs/proxy/custom_pricing" },
	{ label: "Spend tracking", href: "https://docs.litellm.ai/docs/proxy/cost_tracking" },
];
function toggleDiscount() {
	opened.discount = !opened.discount;
	if (!opened.discount) discountTab.value = "discounts";
}
async function submitDiscount(provider: string | undefined, percentage: string) {
	if (await store.createDiscount(provider, percentage)) discountDialog.value = false;
}
async function submitMargin(
	provider: string | undefined,
	percentageValue: string,
	fixedAmountValue: string,
	marginType: "percentage" | "fixed",
) {
	if (await store.createMargin({ selectedProvider: provider, percentageValue, fixedAmountValue, marginType })) marginDialog.value = false;
}
function changeDiscount(provider: string, value: MarginValue) {
	if (typeof value === "number") void store.changeDiscount(provider, String(value));
}
async function confirmRemoval() {
	const value = removal.value;
	if (!value) return;
	if (value.kind === "margin") await store.removeMargin(value.provider);
	else await store.removeDiscount(value.provider);
	removal.value = null;
}
onMounted(() => void store.initialize());
onBeforeUnmount(store.dispose);
</script>
<template>
	<div class="cost-tracking-page">
		<div class="cost-tracking-header">
			<div>
				<div class="cost-tracking-title">
					<h1>Cost Tracking Settings</h1>
					<DocsMenuComponent :items="docs" />
				</div>
				<p>Configure cost discounts and margins for different LLM providers. Changes are saved automatically.</p>
			</div>
		</div>
		<div class="cost-tracking-card">
			<section v-if="proxyAdmin" class="cost-accordion">
				<button type="button" class="cost-accordion-header" :aria-expanded="opened.discount" @click="toggleDiscount">
					<span
						><strong>Provider Discounts</strong
						><span>Apply percentage-based discounts to reduce costs for specific providers</span></span
					><CostAccordionChevronComponent :open="opened.discount" />
				</button>
				<div v-if="opened.discount" class="cost-accordion-body">
					<UiTabs
						v-model="discountTab"
						appearance="tremor"
						:items="[
							{ key: 'discounts', label: 'Discounts' },
							{ key: 'test', label: 'Test It' },
						]"
					>
						<div v-show="discountTab === 'discounts'" class="cost-accordion-inner">
							<div class="cost-add-provider">
								<UiButton appearance="tremor" variant="primary" @click="discountDialog = true"
									>+ Add Provider Discount</UiButton
								>
							</div>
							<div v-if="store.state.loading" class="cost-config-loading">Loading configuration...</div>
							<CostProviderTableComponent
								v-else
								kind="discount"
								:config="store.state.discounts"
								@change="changeDiscount"
								@remove="(provider, name) => (removal = { kind: 'discount', provider, name })"
							/>
						</div>
						<div v-show="discountTab !== 'discounts'" class="cost-discount-how"><CostHowItWorksComponent /></div>
					</UiTabs>
				</div>
			</section>
			<section v-if="proxyAdmin" class="cost-accordion">
				<button type="button" class="cost-accordion-header" :aria-expanded="opened.margin" @click="opened.margin = !opened.margin">
					<span
						><strong>Fee/Price Margin</strong
						><span>Add fees or margins to LLM costs for internal billing and cost recovery</span></span
					><CostAccordionChevronComponent :open="opened.margin" />
				</button>
				<div v-if="opened.margin" class="cost-accordion-body cost-accordion-inner">
					<div class="cost-add-provider">
						<UiButton appearance="tremor" variant="primary" @click="marginDialog = true">+ Add Provider Margin</UiButton>
					</div>
					<div v-if="store.state.loading" class="cost-config-loading">Loading configuration...</div>
					<CostProviderTableComponent
						v-else
						kind="margin"
						:config="store.state.margins"
						@change="store.changeMargin"
						@remove="(provider, name) => (removal = { kind: 'margin', provider, name })"
					/>
				</div>
			</section>
			<section class="cost-accordion">
				<button
					type="button"
					class="cost-accordion-header"
					:aria-expanded="opened.pricing"
					@click="opened.pricing = !opened.pricing"
				>
					<span
						><strong>Pricing Calculator</strong
						><span>Estimate LLM costs based on expected token usage and request volume</span></span
					><CostAccordionChevronComponent :open="opened.pricing" />
				</button>
				<div v-if="opened.pricing" class="cost-accordion-body cost-accordion-inner">
					<PricingCalculatorComponent :models="store.state.models" />
				</div>
			</section>
		</div>
		<CostProviderDialogComponent
			v-model:open="discountDialog"
			kind="discount"
			:config="store.state.discounts"
			@submit="submitDiscount"
		/><CostProviderDialogComponent v-model:open="marginDialog" kind="margin" :config="store.state.margins" @submit="submitMargin" />
		<UiDialog
			:open="!!removal"
			:width="416"
			:closable="false"
			:mask-closable="false"
			:title="'Remove Provider ' + (removal?.kind === 'margin' ? 'Margin' : 'Discount')"
			class="cost-remove-provider"
			@update:open="!$event && (removal = null)"
			><div class="cost-remove-provider-message">
				<UiIcon name="ExclamationCircleOutlined" />Are you sure you want to remove the {{ removal?.kind }} for {{ removal?.name }}?
			</div>
			<template #footer
				><UiButton @click="removal = null">Cancel</UiButton
				><UiButton danger variant="primary" @click="confirmRemoval">Remove</UiButton></template
			></UiDialog
		>
	</div>
</template>
