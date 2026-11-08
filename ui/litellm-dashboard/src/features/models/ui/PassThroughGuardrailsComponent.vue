<script setup lang="ts">
import UiCard from "../../platform/ui/UiCard.vue";
import UiAlert from "../../platform/ui/UiAlert.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import ModelField from "./ModelFormFieldComponent.vue";
import { modelStrings, type ModelCatalog } from "../support/ModelModels";
import type { PassThroughGuardrails } from "../support/PassThroughModels";
const value = defineModel<PassThroughGuardrails>({ required: true });
defineProps<{ catalog: ModelCatalog; disabled?: boolean }>();
function selected(values: unknown) {
	value.value = Object.fromEntries(modelStrings(values).map((name) => [name, value.value[name] ?? null]));
}
function fields(name: string, key: "request_fields" | "response_fields", values: unknown) {
	const next = { ...value.value[name], [key]: modelStrings(values).length ? modelStrings(values) : undefined };
	value.value = { ...value.value, [name]: !next.request_fields && !next.response_fields ? null : next };
}
</script>
<template>
	<UiCard :padding="24" class="model-pass-guardrails"
		><h3>Guardrails</h3>
		<p>Configure guardrails to enforce policies on requests and responses. Guardrails are opt-in for passthrough endpoints.</p>
		<UiAlert type="info"
			><template #title
				>Field-Level Targeting
				<a href="https://docs.litellm.ai/docs/proxy/pass_through_guardrails#field-level-targeting" target="_blank" rel="noreferrer"
					>(Learn More)</a
				></template
			>
			<div>Optionally specify which fields to check. If left empty, the entire request/response is sent to the guardrail.</div>
			<div class="model-pass-guardrail-examples">
				<strong>Common Examples:</strong>
				<p>• <code>query</code> - Single field</p>
				<p>• <code>documents[*].text</code> - All text in documents array</p>
				<p>• <code>messages[*].content</code> - All message contents</p>
			</div></UiAlert
		><ModelField
			label="Select Guardrails"
			vertical
			tooltip="Choose which guardrails should run on this endpoint. Org/team/key level guardrails will also be included."
			><UiSelect
				:model-value="Object.keys(value)"
				:options="catalog.guardrails"
				multiple
				searchable
				:disabled="disabled"
				placeholder="Select guardrails"
				@update:model-value="selected" /></ModelField
		><template v-if="Object.keys(value).length"
			><div class="model-pass-targeting-heading">
				<strong>Field Targeting (Optional)</strong><span>💡 Tip: Leave empty to check entire payload</span>
			</div>
			<UiCard v-for="(settings, name) in value" :key="name" :padding="16" class="model-pass-targeting"
				><strong>{{ name }}</strong>
				<div v-for="kind in ['request_fields', 'response_fields'] as const" :key="kind" class="model-pass-targeting-field">
					<div>
						<label>{{ kind === "request_fields" ? "Request Fields (pre_call)" : "Response Fields (post_call)" }}</label
						><span
							><button
								v-if="kind === 'request_fields'"
								type="button"
								:disabled="disabled"
								@click="fields(name, kind, [...(settings?.[kind] ?? []), 'query'])"
							>
								+ query</button
							><button
								type="button"
								:disabled="disabled"
								@click="
									fields(name, kind, [
										...(settings?.[kind] ?? []),
										kind === 'request_fields' ? 'documents[*]' : 'results[*]',
									])
								"
							>
								{{ kind === "request_fields" ? "+ documents[*]" : "+ results[*]" }}
							</button></span
						>
					</div>
					<UiSelect
						:model-value="settings?.[kind] ?? []"
						:options="[]"
						multiple
						searchable
						creatable
						:token-separators="[',']"
						:disabled="disabled"
						:placeholder="
							kind === 'request_fields'
								? 'Type field name or use + buttons above (e.g., query, documents[*].text)'
								: 'Type field name or use + buttons above (e.g., results[*].text)'
						"
						@update:model-value="fields(name, kind, $event)"
					/></div></UiCard></template
	></UiCard>
</template>
