<script setup lang="ts">
import { computed, ref } from "vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiPopover from "../../platform/ui/UiPopover.vue";
import UiTag from "../../platform/ui/UiTag.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
const value = defineModel<string>({ required: true });
withDefaults(defineProps<{ placeholder?: string; rows?: number }>(), { placeholder: undefined, rows: 4 });
const editing = ref<{ start: number; end: number } | null>(null),
	name = ref(""),
	popovers = ref<InstanceType<typeof UiPopover>[]>([]),
	variables = computed(() =>
		[...value.value.matchAll(/\{\{(\w+)\}\}/g)].map((match) => ({
			name: match[1],
			start: match.index!,
			end: match.index! + match[0].length,
		})),
	);
function cancel(index: number) {
	editing.value = null;
	name.value = "";
	popovers.value[index]?.hide();
}
function save(index: number) {
	if (!name.value.trim() || !editing.value) return;
	value.value = value.value.slice(0, editing.value.start) + "{{" + name.value + "}}" + value.value.slice(editing.value.end);
	cancel(index);
}
</script>
<template>
	<div class="prompt-variable-textarea">
		<UiInput v-model="value" multiline :rows="rows" :placeholder="placeholder" />
		<div v-if="variables.length" class="prompt-variable-tags">
			<span>Detected variables:</span
			><UiPopover
				v-for="(variable, index) in variables"
				:key="variable.start + '-' + index"
				ref="popovers"
				trigger="click"
				placement="top"
				><UiTag
					color="orange"
					@click="
						editing = { start: variable.start, end: variable.end };
						name = variable.name;
					"
					><UiIcon name="EditOutlined" />{{ variable.name }}</UiTag
				><template #content
					><div class="prompt-variable-edit">
						<p>Edit variable name</p>
						<UiInput v-model="name" size="small" placeholder="Variable name" autofocus @keydown.enter="save(index)" />
						<footer>
							<button type="button" @click="save(index)">Save</button
							><button type="button" @click="cancel(index)">Cancel</button>
						</footer>
					</div></template
				></UiPopover
			>
		</div>
	</div>
</template>
