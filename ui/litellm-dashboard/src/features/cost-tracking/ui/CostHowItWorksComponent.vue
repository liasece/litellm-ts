<script setup lang="ts">
import { computed, ref } from "vue";
import UiInput from "../../platform/ui/UiInput.vue";
import HighlightedCodeComponent from "../../content/ui/HighlightedCodeComponent.vue";
import { useMoneyFormatter } from "../../platform/stores/PriceDisplayStore";
import example from "../data/CostTrackingCodeExample.json";
const money = useMoneyFormatter(),
	responseCost = ref(""),
	discountAmount = ref("");
const calculated = computed(() => {
	const cost = Number.parseFloat(responseCost.value),
		discount = Number.parseFloat(discountAmount.value);
	if (Number.isNaN(cost) || Number.isNaN(discount) || cost === 0 || discount === 0) return null;
	const original = cost + discount;
	return {
		original: original.toFixed(10),
		cost: cost.toFixed(10),
		discount: discount.toFixed(10),
		percentage: ((discount / original) * 100).toFixed(2),
	};
});
</script>
<template>
	<div class="cost-how-it-works">
		<div>
			<p class="cost-how-heading">Cost Calculation</p>
			<p>Discounts are applied to provider costs: <code>final_cost = base_cost × (1 - discount%/100)</code></p>
		</div>
		<div>
			<p class="cost-how-heading">Example</p>
			<p>A 5% discount on a $10.00 request results in: $10.00 × (1 - 0.05) = $9.50</p>
		</div>
		<div>
			<p class="cost-how-heading">Valid Range</p>
			<p>Discount percentages must be between 0% and 100%</p>
		</div>
		<div class="cost-how-section">
			<p class="cost-how-heading">Validating Discounts</p>
			<p class="cost-how-before-code">Make a test request and check the response headers to verify discounts are applied:</p>
			<HighlightedCodeComponent :code="example.code" :tree="example.tree" />
			<p class="cost-how-after-code">Look for these headers in the response:</p>
			<div class="cost-response-headers">
				<div>
					<code>x-litellm-response-cost</code>
					<p>Final cost after discount</p>
				</div>
				<div>
					<code>x-litellm-response-cost-original</code>
					<p>Original cost before discount</p>
				</div>
				<div>
					<code>x-litellm-response-cost-discount-amount</code>
					<p>Amount discounted</p>
				</div>
			</div>
		</div>
		<div class="cost-how-section">
			<p class="cost-how-heading">Discount Calculator</p>
			<p class="cost-how-before-code">Enter values from your response headers to verify the discount:</p>
			<div class="cost-discount-calculator-inputs">
				<div>
					<label for="cost-response-value">Response Cost (x-litellm-response-cost)</label
					><UiInput id="cost-response-value" v-model="responseCost" appearance="tremor" placeholder="0.0171938125" />
				</div>
				<div>
					<label for="cost-discount-value">Discount Amount (x-litellm-response-cost-discount-amount)</label
					><UiInput id="cost-discount-value" v-model="discountAmount" appearance="tremor" placeholder="0.0009049375" />
				</div>
			</div>
			<div v-if="calculated" class="cost-discount-calculated">
				<p>Calculated Results</p>
				<div>
					<span>Original Cost:</span><code>{{ money(calculated.original, 4) }}</code>
				</div>
				<div>
					<span>Final Cost:</span><code>{{ money(calculated.cost, 4) }}</code>
				</div>
				<div>
					<span>Discount Amount:</span><code>{{ money(calculated.discount, 4) }}</code>
				</div>
				<div class="cost-discount-applied">
					<span>Discount Applied:</span><strong>{{ calculated.percentage }}%</strong>
				</div>
			</div>
		</div>
	</div>
</template>
