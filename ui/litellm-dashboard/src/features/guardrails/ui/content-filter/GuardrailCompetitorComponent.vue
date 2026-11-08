<script setup lang="ts">
import { computed, ref, watch } from "vue";
import UiCard from "../../../platform/ui/UiCard.vue";
import UiSelect from "../../../platform/ui/UiSelect.vue";
import UiSwitch from "../../../platform/ui/UiSwitch.vue";
import UiInputNumber from "../../../platform/ui/UiInputNumber.vue";
import GuardrailFieldComponent from "../common/GuardrailFieldComponent.vue";
import { guardrailsApi } from "../../api/GuardrailsApi";
import { useAuthenticationStore } from "../../../identity/stores/AuthenticationStore";
import type { CompetitorIntentConfig } from "../../support/GuardrailModels";
const enabled = defineModel<boolean>("enabled", { required: true }),
	config = defineModel<CompetitorIntentConfig | null>("config", { required: true }),
	defaultConfig = (): CompetitorIntentConfig => ({
		competitor_intent_type: "airline",
		brand_self: [],
		locations: [],
		policy: { competitor_comparison: "refuse", possible_competitor_comparison: "reframe" },
		threshold_high: 0.7,
		threshold_medium: 0.45,
		threshold_low: 0.3,
	}),
	effective = computed(() => config.value ?? defaultConfig()),
	airlines = ref<{ id: string; match: string; tags: string[] }[]>([]),
	loading = ref(false),
	auth = useAuthenticationStore();
watch(
	() => [effective.value.competitor_intent_type, auth.isAuthorized.value, airlines.value.length],
	async (_value, _old, cleanup) => {
		let cancelled = false;
		cleanup(() => (cancelled = true));
		if (effective.value.competitor_intent_type !== "airline" || !auth.isAuthorized.value || airlines.value.length) return;
		loading.value = true;
		try {
			const list = await guardrailsApi.airlines();
			if (!cancelled) airlines.value = list;
		} catch {
			if (!cancelled) airlines.value = [];
		} finally {
			if (!cancelled) loading.value = false;
		}
	},
	{ immediate: true },
);
function toggle(value: boolean) {
	enabled.value = value;
	config.value = value ? defaultConfig() : null;
}
function update(field: string, value: unknown) {
	config.value = { ...effective.value, [field]: value };
}
function policy(field: "competitor_comparison" | "possible_competitor_comparison", value: unknown) {
	if (typeof value === "string") config.value = { ...effective.value, policy: { ...effective.value.policy, [field]: value } };
}
function array(field: "brand_self" | "locations" | "competitors", input: unknown) {
	const values = Array.isArray(input) ? input.filter((value): value is string => typeof value === "string" && Boolean(value)) : [];
	if (field !== "brand_self" || effective.value.competitor_intent_type !== "airline" || !airlines.value.length) {
		update(field, values);
		return;
	}
	const expanded: string[] = [],
		seen = new Set<string>();
	for (const value of values) {
		const airline = airlines.value.find((airline) => airline.match.split("|")[0]?.trim().toLowerCase() === value.toLowerCase());
		if (airline) {
			for (const variant of airline.match
				.split("|")
				.map((value) => value.trim().toLowerCase())
				.filter(Boolean))
				if (!seen.has(variant)) {
					seen.add(variant);
					expanded.push(variant);
				}
		} else if (!seen.has(value.toLowerCase())) {
			seen.add(value.toLowerCase());
			expanded.push(value);
		}
	}
	update(field, expanded);
}
const brands = computed(() =>
	effective.value.competitor_intent_type === "airline"
		? airlines.value.map((airline) => {
				const primary = airline.match.split("|")[0]?.trim() ?? airline.id,
					variants = airline.match
						.split("|")
						.map((value) => value.trim().toLowerCase())
						.filter(Boolean);
				return {
					value: primary.toLowerCase(),
					label: primary + (variants.length > 1 ? " (" + variants.slice(1).join(", ") + ")" : ""),
				};
			})
		: [],
);
</script>
<template>
	<UiCard appearance="antd" size="small" class="guardrail-competitor-card"
		><template #title>Competitor Intent Filter</template
		><template #extra><UiSwitch :model-value="enabled" @update:model-value="toggle" /></template>
		<p class="guardrail-secondary">
			{{
				enabled
					? "Block or reframe competitor comparison questions. Airline type uses major airlines (excluding your brand); generic requires manual competitor list."
					: "Block or reframe competitor comparison questions. When enabled, airline type auto-loads competitors from IATA; generic type requires manual competitor list."
			}}
		</p>
		<div v-if="enabled" class="guardrail-competitor-fields">
			<GuardrailFieldComponent label="Type"
				><UiSelect
					:model-value="effective.competitor_intent_type"
					:options="[
						{ value: 'airline', label: 'Airline (auto-load competitors from IATA)' },
						{ value: 'generic', label: 'Generic (specify competitors manually)' },
					]"
					size="small"
					@update:model-value="update('competitor_intent_type', $event)" /></GuardrailFieldComponent
			><GuardrailFieldComponent
				label="Your Brand (brand_self)"
				required
				:help="
					effective.competitor_intent_type === 'airline'
						? 'Select your airline from the list (excluded from competitors) or type to add a custom term'
						: 'Names/codes users use for your brand'
				"
				><UiSelect
					:model-value="effective.brand_self"
					:options="brands"
					multiple
					searchable
					creatable
					:token-separators="[',']"
					:loading="loading"
					:placeholder="
						loading
							? 'Loading airlines...'
							: effective.competitor_intent_type === 'airline'
								? 'Search or select airline, or type to add custom'
								: 'Type and press Enter to add'
					"
					size="small"
					@update:model-value="array('brand_self', $event)" /></GuardrailFieldComponent
			><GuardrailFieldComponent
				v-if="effective.competitor_intent_type === 'airline'"
				label="Locations (optional)"
				help="Countries, cities, airports for disambiguation (e.g. qatar, doha)"
				><UiSelect
					:model-value="effective.locations ?? []"
					:options="[]"
					multiple
					searchable
					creatable
					:token-separators="[',']"
					placeholder="Type and press Enter to add"
					size="small"
					@update:model-value="array('locations', $event)" /></GuardrailFieldComponent
			><GuardrailFieldComponent
				v-if="effective.competitor_intent_type === 'generic'"
				label="Competitors"
				required
				help="Competitor names to detect (required for generic type)"
				><UiSelect
					:model-value="effective.competitors ?? []"
					:options="[]"
					multiple
					searchable
					creatable
					:token-separators="[',']"
					placeholder="Type and press Enter to add"
					size="small"
					@update:model-value="array('competitors', $event)" /></GuardrailFieldComponent
			><GuardrailFieldComponent label="Policy: Competitor comparison"
				><UiSelect
					:model-value="effective.policy?.competitor_comparison ?? 'refuse'"
					:options="[
						{ value: 'refuse', label: 'Refuse (block request)' },
						{ value: 'reframe', label: 'Reframe (suggest alternative)' },
					]"
					size="small"
					@update:model-value="policy('competitor_comparison', $event)" /></GuardrailFieldComponent
			><GuardrailFieldComponent label="Policy: Possible competitor comparison"
				><UiSelect
					:model-value="effective.policy?.possible_competitor_comparison ?? 'reframe'"
					:options="[
						{ value: 'refuse', label: 'Refuse (block request)' },
						{ value: 'reframe', label: 'Reframe (suggest alternative to backend LLM)' },
					]"
					size="small"
					@update:model-value="policy('possible_competitor_comparison', $event)" /></GuardrailFieldComponent
			><GuardrailFieldComponent label="Confidence thresholds"
				><div class="guardrail-confidence-fields">
					<label
						v-for="threshold in [
							{ field: 'threshold_high', label: 'High', value: 0.7 },
							{ field: 'threshold_medium', label: 'Medium', value: 0.45 },
							{ field: 'threshold_low', label: 'Low', value: 0.3 },
						]"
						:key="threshold.field"
						>{{ threshold.label
						}}<UiInputNumber
							:model-value="
								typeof effective[threshold.field] === 'number' ? Number(effective[threshold.field]) : threshold.value
							"
							:min="0"
							:max="1"
							:step="0.05"
							style="width: 80px"
							@update:model-value="update(threshold.field, $event ?? threshold.value)"
						/><small>e.g. {{ threshold.value }}</small></label
					>
				</div>
				<div class="guardrail-confidence-help">
					Classify competitor intent by confidence (0–1). Higher confidence → stronger intent.
					<ul>
						<li>
							<strong>High (≥)</strong>: Treat as full competitor comparison → uses &quot;Competitor comparison&quot; policy
						</li>
						<li>
							<strong>Medium (≥)</strong>: Treat as possible comparison → uses &quot;Possible competitor comparison&quot;
							policy
						</li>
						<li><strong>Low (≥)</strong>: Log only; allow request. Below Low → allow with no action</li>
					</ul>
					Raise thresholds to be more permissive; lower them to be stricter.
				</div></GuardrailFieldComponent
			>
		</div></UiCard
	>
</template>
