<script setup lang="ts">
import { computed } from "vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import UiSwitch from "../../platform/ui/UiSwitch.vue";
import { routerRecord, routerString, routerStrings, inputText, type RouterValues } from "../support/RouterSettingsModels";
const props = defineProps<{ values: RouterValues; fields: Record<string, unknown>[]; descriptions: Record<string, unknown> }>();
const inputs = defineModel<Record<string, string>>("inputs", { required: true }),
	strategy = defineModel<string | null>("strategy", { required: true }),
	filtering = defineModel<boolean>("filtering", { required: true });
const metadata = computed(() => Object.fromEntries(props.fields.map((field) => [routerString(field.field_name), field])));
const strategies = computed(() => routerStrings(metadata.value.routing_strategy?.options));
const reliability = computed(() =>
	Object.entries(props.values).filter(
		([name]) =>
			!["fallbacks", "context_window_fallbacks", "routing_strategy_args", "routing_strategy", "enable_tag_filtering"].includes(name),
	),
);
const latency = computed(() =>
	Object.entries(
		props.values.routing_strategy_args ? routerRecord(props.values.routing_strategy_args) : { ttl: 3600, lowest_latency_buffer: 0 },
	),
);
const explanation: Record<string, string> = {
	ttl: "Sliding window to look back over when calculating the average latency of a deployment. Default - 1 hour (in seconds).",
	lowest_latency_buffer:
		"Shuffle between deployments within this % of the lowest latency. Default - 0 (i.e. always pick lowest latency).",
};
</script>
<template>
	<div class="routing-form">
		<section class="routing-section">
			<header>
				<h3>Routing Settings</h3>
				<p>Configure how requests are routed to deployments</p>
			</header>
			<div v-if="strategies.length" class="routing-strategy">
				<label> {{ metadata.routing_strategy?.ui_field_name || "Routing Strategy" }}</label>
				<p>{{ metadata.routing_strategy?.field_description }}</p>
				<UiSelect
					v-model="strategy"
					size="large"
					:options="strategies.map((value) => ({ value, label: value, description: routerString(descriptions[value]) }))"
					><template #value="{ option }"
						><span class="routing-strategy-option"
							><strong>{{ option.label }}</strong
							><small v-if="descriptions[option.label]">{{ descriptions[option.label] }}</small></span
						></template
					><template #option="{ option }"
						><span class="routing-strategy-option"
							><strong>{{ option.label }}</strong
							><small v-if="descriptions[option.label]">{{ descriptions[option.label] }}</small></span
						></template
					></UiSelect
				>
			</div>
			<div class="routing-tag-filter">
				<div>
					<label>{{ metadata.enable_tag_filtering?.ui_field_name || "Enable Tag Filtering" }}</label>
					<p>
						{{ metadata.enable_tag_filtering?.field_description }}&nbsp;<template v-if="metadata.enable_tag_filtering?.link">
							<a :href="routerString(metadata.enable_tag_filtering.link)" target="_blank" rel="noopener noreferrer"
								>Learn more</a
							></template
						>
					</p>
				</div>
				<UiSwitch v-model="filtering" appearance="tremor" label="Enable Tag Filtering" />
			</div>
		</section>
		<hr />
		<template v-if="strategy === 'latency-based-routing'"
			><section class="routing-section">
				<header>
					<h3>Latency-Based Configuration</h3>
					<p>Fine-tune latency-based routing behavior</p>
				</header>
				<div class="routing-grid">
					<label v-for="[name, value] in latency" :key="name"
						><span>{{ name.replaceAll("_", " ") }}</span>
						<p>{{ explanation[name] || "" }}</p>
						<UiInput
							:model-value="inputs[name] ?? inputText(value)"
							:name="name"
							appearance="tremor"
							@update:model-value="inputs[name] = routerString($event)"
					/></label>
				</div>
			</section>
			<hr
		/></template>
		<section class="routing-section">
			<header>
				<h3>Reliability &amp; Retries</h3>
				<p>Configure retry logic and failure handling</p>
			</header>
			<div class="routing-grid">
				<label v-for="[name, value] in reliability" :key="name"
					><span>{{ metadata[name]?.ui_field_name || name }}</span>
					<p>{{ metadata[name]?.field_description }}</p>
					<UiInput
						:model-value="inputs[name] ?? inputText(value)"
						:name="name"
						appearance="tremor"
						placeholder="—"
						@update:model-value="inputs[name] = routerString($event)"
				/></label>
			</div>
		</section>
	</div>
</template>
