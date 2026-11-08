<script setup lang="ts">
import { computed, ref } from "vue";
import UiDialog from "../../../platform/ui/UiDialog.vue";
import UiInput from "../../../platform/ui/UiInput.vue";
import UiSelect from "../../../platform/ui/UiSelect.vue";
import UiButton from "../../../platform/ui/UiButton.vue";
import { notificationManager } from "../../../notifications/logic/NotificationManager";
import type { GuardrailPatternDefinition, GuardrailPattern, GuardrailKeyword, GuardrailAction } from "../../support/GuardrailModels";
const open = defineModel<boolean>("open", { required: true }),
	props = defineProps<{ type: "prebuilt" | "custom" | "keyword"; patterns: GuardrailPatternDefinition[]; categories: string[] }>(),
	emit = defineEmits<{ pattern: [value: GuardrailPattern]; keyword: [value: GuardrailKeyword] }>(),
	name = ref(""),
	regex = ref(""),
	keyword = ref(""),
	description = ref(""),
	action = ref<GuardrailAction>("BLOCK"),
	query = ref(""),
	options = computed(() =>
		props.categories.flatMap((category) =>
			props.patterns
				.filter(
					(pattern) =>
						pattern.category === category &&
						(!query.value ||
							[pattern.name, pattern.display_name].some((value) => value.toLowerCase().includes(query.value.toLowerCase()))),
				)
				.map((pattern) => ({ value: pattern.name, label: pattern.display_name, group: category })),
		),
	);
function selectName(value: unknown) {
	if (typeof value === "string") {
		name.value = value;
		query.value = "";
	}
}
function selectAction(value: unknown) {
	if (value === "BLOCK" || value === "MASK") action.value = value;
}
function add() {
	if (props.type === "prebuilt") {
		if (!name.value) {
			notificationManager.error("Please select a pattern");
			return;
		}
		emit("pattern", {
			id: "pattern-" + Date.now(),
			type: "prebuilt",
			name: name.value,
			display_name: props.patterns.find((pattern) => pattern.name === name.value)?.display_name,
			action: action.value,
		});
	} else if (props.type === "custom") {
		if (!name.value || !regex.value) {
			notificationManager.error("Please provide pattern name and regex");
			return;
		}
		emit("pattern", { id: "custom-" + Date.now(), type: "custom", name: name.value, pattern: regex.value, action: action.value });
	} else {
		if (!keyword.value) {
			notificationManager.error("Please enter a keyword");
			return;
		}
		emit("keyword", {
			id: "word-" + Date.now(),
			keyword: keyword.value,
			action: action.value,
			description: description.value || undefined,
		});
	}
	open.value = false;
}
</script>
<template>
	<UiDialog
		v-model:open="open"
		:title="type === 'prebuilt' ? 'Add prebuilt pattern' : type === 'custom' ? 'Add custom regex pattern' : 'Add blocked keyword'"
		:width="800"
		:show-footer="false"
		scroll-mode="overlay"
		class="guardrail-content-item-dialog"
		><div v-if="type === 'prebuilt'">
			<strong>Pattern type</strong
			><UiSelect
				:model-value="name"
				:options="options"
				searchable
				:filterable="false"
				placeholder="Choose pattern type"
				@search="query = $event"
				@update:model-value="selectName"
			/>
		</div>
		<template v-if="type === 'custom'"
			><div><strong>Pattern name</strong><UiInput v-model="name" placeholder="e.g., internal_id, employee_code" /></div>
			<div>
				<strong>Regex pattern</strong><UiInput v-model="regex" placeholder="e.g., ID-[0-9]{6}" /><small
					>Enter a valid regular expression to match sensitive data</small
				>
			</div></template
		>
		<div v-if="type === 'keyword'">
			<strong>Keyword</strong><UiInput v-model="keyword" placeholder="Enter sensitive keyword or phrase" />
		</div>
		<div>
			<strong>Action</strong>
			<p>Choose what action the guardrail should take when this {{ type === "keyword" ? "keyword" : "pattern" }} is detected</p>
			<UiSelect
				:model-value="action"
				:options="[
					{ value: 'BLOCK', label: 'Block' },
					{ value: 'MASK', label: 'Mask' },
				]"
				@update:model-value="selectAction"
			/>
		</div>
		<div v-if="type === 'keyword'">
			<strong>Description (optional)</strong
			><UiInput v-model="description" multiline :rows="3" placeholder="Explain why this keyword is sensitive" />
		</div>
		<footer><UiButton @click="open = false">Cancel</UiButton><UiButton variant="primary" @click="add">Add</UiButton></footer></UiDialog
	>
</template>
