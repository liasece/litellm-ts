<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import UiTabs from "../../platform/ui/UiTabs.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiSwitch from "../../platform/ui/UiSwitch.vue";
import UiAlert from "../../platform/ui/UiAlert.vue";
import UiDragHandle from "../../platform/ui/UiDragHandle.vue";
import UiEntryRemove from "../../platform/ui/UiEntryRemove.vue";
import UiSortableList from "../../platform/ui/UiSortableList.vue";
import UiSortableRow from "../../platform/ui/UiSortableRow.vue";
import { loadRouterSettings, type RouterField } from "../api/RouterSettingsApi";
import {
	fallbackDraft,
	fallbackPayload,
	normalizeRouterSettings,
	parseRouterInput,
	type FallbackDraft,
} from "../logic/RouterSettingsLogic";
import { objectValue } from "../logic/ResourceDraftLogic";
import type { AccessRecord, ResourceOption } from "../support/AccessModels";
const props = withDefaults(
	defineProps<{
		modelValue?: AccessRecord;
		models?: ResourceOption[];
		metadata?: RouterField[];
		strategyDescriptions?: Record<string, string>;
	}>(),
	{ modelValue: () => ({}), models: () => [], metadata: undefined, strategyDescriptions: undefined },
);
const emit = defineEmits<{ "update:modelValue": [value: AccessRecord] }>();
const tab = ref("loadbalancing"),
	fields = ref<RouterField[]>(props.metadata ?? []),
	descriptions = ref(props.strategyDescriptions ?? {}),
	error = ref(""),
	groups = ref(fallbackDraft(props.modelValue.fallbacks)),
	values = ref<AccessRecord>({ ...props.modelValue }),
	texts = ref<Record<string, string>>({});
let internal = "";
watch(
	() => props.modelValue,
	(value) => {
		if (JSON.stringify(value) === internal) return;
		values.value = { ...value };
		groups.value = fallbackDraft(value.fallbacks);
		texts.value = {};
	},
	{ deep: true },
);
const strategies = computed(() => fields.value.find((field) => field.field_name === "routing_strategy")?.options ?? []);
const reliability = computed(() =>
	Object.keys(values.value).filter(
		(key) =>
			!["routing_strategy", "enable_tag_filtering", "fallbacks", "context_window_fallbacks", "routing_strategy_args"].includes(key),
	),
);
const strategy = computed(() => (typeof values.value.routing_strategy === "string" ? values.value.routing_strategy : null));
function field(name: string) {
	return fields.value.find((item) => item.field_name === name);
}
function display(name: string) {
	const value = values.value[name];
	return (
		texts.value[name] ??
		(value == null || value === "null" ? "" : typeof value === "object" ? JSON.stringify(value, null, 2) : String(value))
	);
}
function publish() {
	const result = normalizeRouterSettings({ ...values.value, fallbacks: fallbackPayload(groups.value) });
	internal = JSON.stringify(result);
	emit("update:modelValue", result);
}
function update(name: string, value: unknown) {
	values.value = { ...values.value, [name]: value };
	publish();
}
function input(name: string, value: unknown) {
	const text = String(value ?? "");
	texts.value[name] = text;
	update(name, parseRouterInput(name, text, values.value[name]));
}
function latency(name: string, value: unknown) {
	update("routing_strategy_args", { ...objectValue(values.value.routing_strategy_args), [name]: Number(value) });
}
function updateGroup(index: number, key: "primary", value: unknown) {
	// 回退模型的顺序就是尝试顺序，只能通过下方有序列表增删改，不再接受一次性的多选结果。
	const group = groups.value[index];
	if (key === "primary") group.primary = String(value ?? "");
	publish();
}
function groupCandidates(group: FallbackDraft) {
	// 已加入链路的模型不再出现在下拉里：重复项会被 addGroupModel 吞掉，只在列表里保留一份。
	return props.models.filter((option) => option.value !== group.primary && !group.models.includes(option.value));
}
function addGroupModel(index: number, value: unknown) {
	const group = groups.value[index],
		model = String(value ?? "");
	if (!group || !model || group.models.includes(model)) return;
	group.models = [...group.models, model];
	publish();
}
function removeGroupModel(index: number, name: string) {
	const group = groups.value[index];
	if (!group) return;
	group.models = group.models.filter((model) => model !== name);
	publish();
}
function setGroupModels(index: number, models: string[]) {
	const group = groups.value[index];
	if (!group) return;
	group.models = models;
	publish();
}
onMounted(() => {
	void (
		props.metadata
			? Promise.resolve()
			: loadRouterSettings().then((result) => {
					fields.value = result.fields;
					descriptions.value = result.routing_strategy_descriptions ?? {};
				})
	).catch((reason) => {
		error.value = reason instanceof Error ? reason.message : "Failed to load router settings";
	});
	publish();
});
</script>
<template>
	<div class="access-router">
		<UiAlert v-if="error" type="error" :title="error" /><UiTabs
			v-model="tab"
			appearance="tremor"
			:items="[
				{ key: 'loadbalancing', label: 'Loadbalancing' },
				{ key: 'fallbacks', label: 'Fallbacks' },
			]"
		/>
		<div class="access-router-panel">
			<template v-if="tab === 'loadbalancing'"
				><section>
					<h3>Routing Settings</h3>
					<p>Configure how requests are routed to deployments</p>
					<label v-if="strategies.length" class="access-router-field"
						><span>{{ field("routing_strategy")?.ui_field_name || "Routing Strategy" }}</span
						><small>{{ field("routing_strategy")?.field_description }}</small
						><UiSelect
							:model-value="strategy"
							:options="strategies.map((value) => ({ value, label: value, description: descriptions[value] }))"
							size="large"
							@update:model-value="update('routing_strategy', $event)"
					/></label>
					<div class="access-router-toggle">
						<div>
							<strong>{{ field("enable_tag_filtering")?.ui_field_name || "Enable Tag Filtering" }}</strong>
							<p>{{ field("enable_tag_filtering")?.field_description || "Filter deployments based on request tags" }}</p>
						</div>
						<UiSwitch
							:model-value="Boolean(values.enable_tag_filtering)"
							@update:model-value="update('enable_tag_filtering', $event)"
						/>
					</div>
				</section>
				<hr />
				<section v-if="strategy === 'latency-based-routing'">
					<h3>Latency-Based Configuration</h3>
					<p>Fine-tune latency-based routing behavior</p>
					<div class="access-router-grid">
						<label
							v-for="(value, name) in Object.keys(objectValue(values.routing_strategy_args)).length
								? objectValue(values.routing_strategy_args)
								: { ttl: 3600, lowest_latency_buffer: 0 }"
							:key="name"
							class="access-router-field"
							><span>{{ String(name).replace(/_/g, " ") }}</span
							><small>{{
								name === "ttl"
									? "Sliding window to look back over when calculating the average latency of a deployment. Default - 1 hour (in seconds)."
									: "Shuffle between deployments within this % of the lowest latency. Default - 0 (i.e. always pick lowest latency)."
							}}</small
							><UiInput
								:model-value="String(value)"
								appearance="tremor"
								:name="name"
								@update:model-value="latency(String(name), $event)"
						/></label>
					</div>
					<hr />
				</section>
				<section>
					<h3>Reliability &amp; Retries</h3>
					<p>Configure retry logic and failure handling</p>
					<div class="access-router-grid">
						<label v-for="name in reliability" :key="name" class="access-router-field"
							><span>{{ field(name)?.ui_field_name || name }}</span
							><small>{{ field(name)?.field_description }}</small
							><UiInput
								:model-value="display(name)"
								:name="name"
								appearance="tremor"
								placeholder="—"
								@update:model-value="input(name, $event)"
						/></label>
					</div></section></template
			><template v-else
				><div v-for="(group, index) in groups" :key="group.id" class="access-fallback-group">
					<header>
						<strong>Fallback Group {{ index + 1 }}</strong
						><UiButton
							v-if="groups.length > 1"
							variant="text"
							danger
							@click="
								groups.splice(index, 1);
								publish();
							"
							>Remove</UiButton
						>
					</header>
					<label
						>Primary Model<UiSelect
							:model-value="group.primary || null"
							:options="models"
							searchable
							clearable
							placeholder="Select primary model"
							@update:model-value="updateGroup(index, 'primary', $event)" /></label
					><label
						>Add fallback model<UiSelect
							:model-value="null"
							:options="groupCandidates(group)"
							searchable
							placeholder="Select a fallback model"
							:aria-label="'Add fallback model to group ' + (index + 1)"
							@update:model-value="addGroupModel(index, $event)"
					/></label>
					<p class="access-fallback-chain-hint">Tried top to bottom after the primary model fails.</p>
					<UiSortableList
						:items="group.models"
						:item-key="(model) => model"
						:label="(position, total) => 'fallback ' + (position + 1) + ' of ' + total + ' in group ' + (index + 1)"
						@update:items="setGroupModels(index, $event)"
					>
						<template #item="{ item: model, index: position, itemProps, itemClass, handleProps }">
							<UiSortableRow :index="position + 1" :class="itemClass" v-bind="itemProps">
								<template #handle><UiDragHandle v-bind="handleProps" /></template>
								<span>{{ model }}</span>
								<template #actions>
									<UiEntryRemove :label="'Remove fallback ' + model" @click="removeGroupModel(index, model)" />
								</template>
							</UiSortableRow>
						</template>
					</UiSortableList>
					<p v-if="!group.models.length" class="access-fallback-chain-hint">No fallback models yet.</p>
				</div>
				<UiButton
					v-if="groups.length < 5"
					block
					@click="
						groups.push({ id: Math.max(...groups.map((group) => group.id)) + 1, primary: '', models: [] });
						publish();
					"
					>＋ Add Fallback Group</UiButton
				></template
			>
		</div>
	</div>
</template>
