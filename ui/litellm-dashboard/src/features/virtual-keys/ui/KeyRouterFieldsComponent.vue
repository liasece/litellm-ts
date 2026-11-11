<script setup lang="ts">
import "./styles/KeyRouterForms.css";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { requestJson } from "../../platform/api/HttpApiClient";
import UiInput from "../../platform/ui/UiInput.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import UiSwitch from "../../platform/ui/UiSwitch.vue";
import UiTabs from "../../platform/ui/UiTabs.vue";
import ModelName from "../../providers/ui/ModelNameComponent.vue";
import { recordValue, selectedString, selectOptions, stringValues, type KeyDraft } from "../support/VirtualKeyModels";
const draft = defineModel<KeyDraft>({ required: true });
defineProps<{ models: readonly string[] }>();
const tab = ref("loadbalancing");
const metadata = ref<Record<string, Record<string, unknown>>>({});
const descriptions = ref<Record<string, unknown>>({});
const strategies = ref<string[]>([]);
const controller = new AbortController();
const reliability = ["allowed_fails", "cooldown_time", "num_retries", "timeout", "retry_after", "retry_policy", "model_group_alias"];
const groups = ref<{ id: string; primary: string; models: string[] }[]>([]);
let nextId = 1;
const activeGroup = ref("1");
const currentGroup = computed(() => groups.value.find((group) => group.id === activeGroup.value) ?? groups.value[0]);
onMounted(async () => {
	const existing = draft.value.router_settings;
	const raw = Array.isArray(existing.fallbacks) ? existing.fallbacks : [];
	groups.value = raw.length
		? raw.map((value) => {
				const [primary, models] = Object.entries(recordValue(value))[0] ?? ["", []];
				return { id: String(nextId++), primary, models: stringValues(models) };
			})
		: [{ id: String(nextId++), primary: "", models: [] }];
	draft.value.router_settings = {
		routing_strategy: null,
		allowed_fails: null,
		cooldown_time: null,
		num_retries: null,
		timeout: null,
		retry_after: null,
		fallbacks: null,
		context_window_fallbacks: null,
		retry_policy: null,
		model_group_alias: null,
		enable_tag_filtering: false,
		routing_strategy_args: null,
		...existing,
	};
	try {
		const payload = recordValue(await requestJson("/router/settings", { signal: controller.signal }));
		if (controller.signal.aborted) return;
		const fields = Array.isArray(payload.fields) ? payload.fields.map(recordValue) : [];
		metadata.value = Object.fromEntries(fields.map((field) => [selectedString(field.field_name), field]));
		strategies.value = stringValues(metadata.value.routing_strategy?.options);
		descriptions.value = recordValue(payload.routing_strategy_descriptions);
	} catch {
		/* Metadata availability does not change the draft. */
	}
});
function update(name: string, value: unknown) {
	draft.value.router_settings = { ...draft.value.router_settings, [name]: value };
}
function input(name: string, value: unknown) {
	const text = selectedString(value);
	let parsed: unknown = text || null;
	if (["allowed_fails", "cooldown_time", "num_retries", "timeout", "retry_after"].includes(name))
		parsed = text && Number.isFinite(Number(text)) ? Number(text) : null;
	else if (text && ["retry_policy", "model_group_alias"].includes(name)) {
		try {
			parsed = JSON.parse(text);
		} catch {
			parsed = text;
		}
	}
	update(name, parsed);
}
function inputText(value: unknown) {
	return typeof value === "string" || typeof value === "number" ? value : value == null ? "" : JSON.stringify(value);
}
function argument(name: string, value: unknown) {
	const number = Number(selectedString(value));
	update("routing_strategy_args", {
		...recordValue(draft.value.router_settings.routing_strategy_args),
		[name]: Number.isFinite(number) ? number : null,
	});
}
function commitFallbacks() {
	const valid = groups.value
		.filter((group) => group.primary && group.models.length)
		.map((group) => ({ [group.primary]: [...group.models] }));
	update("fallbacks", valid.length ? valid : null);
}
function primary(value: unknown) {
	if (!currentGroup.value) return;
	currentGroup.value.primary = selectedString(value);
	currentGroup.value.models = currentGroup.value.models.filter((model) => model !== currentGroup.value?.primary);
	commitFallbacks();
}
function fallbacks(value: unknown) {
	if (!currentGroup.value) return;
	currentGroup.value.models = stringValues(value)
		.filter((model) => model !== currentGroup.value?.primary)
		.slice(0, 10);
	commitFallbacks();
}
function addGroup() {
	if (groups.value.length >= 5) return;
	const id = String(nextId++);
	groups.value.push({ id, primary: "", models: [] });
	activeGroup.value = id;
}
function removeGroup(id: string) {
	if (groups.value.length <= 1) return;
	groups.value = groups.value.filter((group) => group.id !== id);
	if (activeGroup.value === id) activeGroup.value = groups.value[groups.value.length - 1].id;
	commitFallbacks();
}
onBeforeUnmount(() => controller.abort());
</script>
<template>
	<div class="vk-key-router">
		<UiTabs
			v-model="tab"
			appearance="tremor"
			:items="[
				{ key: 'loadbalancing', label: 'Loadbalancing' },
				{ key: 'fallbacks', label: 'Fallbacks' },
			]"
		/>
		<div class="vk-router-pane">
			<div v-if="tab === 'loadbalancing'" class="vk-router-loadbalancing">
				<section>
					<h3>Routing Settings</h3>
					<p>Configure how requests are routed to deployments</p>
					<label v-if="strategies.length" class="vk-router-field"
						><span>{{ metadata.routing_strategy?.ui_field_name || "Routing Strategy" }}</span
						><small>{{ metadata.routing_strategy?.field_description }}</small
						><UiSelect
							:model-value="selectedString(draft.router_settings.routing_strategy) || null"
							:options="
								strategies.map((value) => ({ value, label: value, description: selectedString(descriptions[value]) }))
							"
							@update:model-value="update('routing_strategy', selectedString($event) || null)"
					/></label>
					<div class="vk-router-tag-filter">
						<div>
							<label>{{ metadata.enable_tag_filtering?.ui_field_name || "Enable Tag Filtering" }}</label>
							<p>
								{{ metadata.enable_tag_filtering?.field_description }}
								<a
									v-if="metadata.enable_tag_filtering?.link"
									:href="selectedString(metadata.enable_tag_filtering.link)"
									target="_blank"
									rel="noopener noreferrer"
									>Learn more</a
								>
							</p>
						</div>
						<UiSwitch
							:model-value="draft.router_settings.enable_tag_filtering === true"
							label="Enable Tag Filtering"
							@update:model-value="update('enable_tag_filtering', $event)"
						/>
					</div>
				</section>
				<hr />
				<section v-if="draft.router_settings.routing_strategy === 'latency-based-routing'">
					<h3>Latency-Based Configuration</h3>
					<p>Configure latency-based routing parameters</p>
					<div class="vk-router-reliability">
						<label v-for="name in ['ttl', 'lowest_latency_buffer']" :key="name" class="vk-router-field"
							><span>{{ name }}</span
							><small>{{
								name === "ttl"
									? "Sliding window to look back over when calculating the average latency of a deployment. Default - 1 hour (in seconds)."
									: "Shuffle between deployments within this % of the lowest latency. Default - 0 (i.e. always pick lowest latency)."
							}}</small
							><UiInput
								:model-value="
									inputText(recordValue(draft.router_settings.routing_strategy_args)[name] ?? (name === 'ttl' ? 3600 : 0))
								"
								:name="name"
								appearance="tremor"
								@update:model-value="argument(name, $event)"
						/></label>
					</div>
				</section>
				<section>
					<h3>Reliability &amp; Retries</h3>
					<p>Configure retry logic and failure handling</p>
					<div class="vk-router-reliability">
						<label v-for="name in reliability" :key="name" class="vk-router-field"
							><span>{{ metadata[name]?.ui_field_name || name }}</span
							><small>{{ metadata[name]?.field_description }}</small
							><UiInput
								:model-value="inputText(draft.router_settings[name])"
								:name="name"
								appearance="tremor"
								:placeholder="selectedString(metadata[name]?.field_description)"
								@update:model-value="input(name, $event)"
						/></label>
					</div>
				</section>
			</div>
			<div v-else class="vk-fallback-editor">
				<div class="vk-fallback-tabs">
					<button
						v-for="(group, index) in groups"
						:key="group.id"
						type="button"
						:class="{ active: group.id === activeGroup }"
						@click="activeGroup = group.id"
					>
						<ModelName :model="group.primary" :name="group.primary || 'Group ' + (index + 1)" :size="14" /><span
							v-if="groups.length > 1"
							role="button"
							aria-label="Remove fallback group"
							tabindex="0"
							@click.stop="removeGroup(group.id)"
							@keydown.enter.stop="removeGroup(group.id)"
							>×</span
						></button
					><button v-if="groups.length < 5" type="button" aria-label="Add fallback group" @click="addGroup">+</button>
				</div>
				<div v-if="currentGroup" class="vk-fallback-group">
					<label class="vk-fallback-primary"
						>Primary Model <span>*</span
						><UiSelect
							:model-value="currentGroup.primary || null"
							:options="selectOptions(models)"
							searchable
							placeholder="Select primary model"
							@update:model-value="primary"
					/></label>
					<p v-if="!currentGroup.primary" class="vk-fallback-warning">Please select a primary model to configure fallbacks</p>
					<div class="vk-fallback-sequence">↓ Fallback Sequence</div>
					<section :class="{ 'vk-fallback-disabled': !currentGroup.primary }">
						<h4>Fallback Chain <span>*</span><small>(Max 10 fallbacks at a time)</small></h4>
						<div class="vk-fallback-chain">
							<UiSelect
								:model-value="currentGroup.models"
								:options="selectOptions(models.filter((model) => model !== currentGroup?.primary))"
								:disabled="!currentGroup.primary"
								multiple
								searchable
								:placeholder="
									currentGroup.models.length < 10 ? 'Select fallback models to add...' : 'Maximum 10 fallbacks reached'
								"
								@update:model-value="fallbacks"
							/>
							<p>
								{{
									currentGroup.models.length < 10
										? "Search and select multiple models. Selected models will appear below in order. (" +
											currentGroup.models.length +
											"/10 used)"
										: "Maximum 10 fallbacks reached. Remove some to add more."
								}}
							</p>
							<div v-if="!currentGroup.models.length" class="vk-fallback-empty">
								<span>No fallback models selected</span><small>Add models from the dropdown above</small>
							</div>
							<div v-for="(model, index) in currentGroup.models" :key="model" class="vk-fallback-model">
								<span class="vk-fallback-index">{{ index + 1 }}</span
								><ModelName :model="model" :size="16" variant="strong" /><button
									type="button"
									:aria-label="'Remove fallback ' + model"
									@click="fallbacks(currentGroup.models.filter((_, position) => position !== index))"
								>
									×
								</button>
							</div>
						</div>
					</section>
				</div>
			</div>
		</div>
	</div>
</template>
