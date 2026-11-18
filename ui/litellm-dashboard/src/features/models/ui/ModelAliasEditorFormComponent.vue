<script setup lang="ts">
import UiButton from "../../platform/ui/UiButton.vue";
import UiDragHandle from "../../platform/ui/UiDragHandle.vue";
import UiEntryCard from "../../platform/ui/UiEntryCard.vue";
import UiEntryRemove from "../../platform/ui/UiEntryRemove.vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiSectionCard from "../../platform/ui/UiSectionCard.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import UiSortableList from "../../platform/ui/UiSortableList.vue";
import UiSwitchRow from "../../platform/ui/UiSwitchRow.vue";
import type { UiSelectOption } from "../../platform/ui/UiTypes";
import type { ModelAliasDraft } from "../logic/ModelAliasDraftLogic";
/**
 * 别名表单：新建别名与「把模型转成别名」共用同一份字段与顺序语义。
 *
 * 组件只描述字段，不负责保存：谁打开弹窗，谁决定写哪张表和写完后做什么。
 */
const props = withDefaults(
	defineProps<{
		draft: ModelAliasDraft;
		targetOptions: readonly UiSelectOption[];
		disabled?: boolean;
		nameLabel?: string;
	}>(),
	{ disabled: false, nameLabel: "Alias name" },
);
const emit = defineEmits<{ "update:draft": [draft: ModelAliasDraft] }>();
function patch(changes: Partial<ModelAliasDraft>) {
	emit("update:draft", { ...props.draft, ...changes });
}
/** 输入框把空值报成 null，草稿里只留字符串。 */
function text(value: unknown): string {
	return typeof value === "string" ? value : value == null ? "" : String(value);
}
function setTarget(index: number, value: unknown) {
	const targets = [...props.draft.targets];
	targets[index] = typeof value === "string" ? value : "";
	patch({ targets });
}
function removeTarget(index: number) {
	patch({ targets: props.draft.targets.filter((_, position) => position !== index) });
}
function setScheduleField(index: number, field: "start" | "end" | "model", value: unknown) {
	patch({
		schedule: props.draft.schedule.map((window, position) =>
			position === index ? { ...window, [field]: typeof value === "string" ? value : "" } : window,
		),
	});
}
function removeSchedule(index: number) {
	patch({ schedule: props.draft.schedule.filter((_, position) => position !== index) });
}
/** 目标下拉里去掉别名自身，避免一眼看上去就能选出一个自环。 */
function options(exclude?: string) {
	return props.targetOptions.filter((option) => option.value !== exclude);
}
</script>
<template>
	<div class="model-alias-editor">
		<label class="model-alias-name"
			>{{ nameLabel }}<UiInput :model-value="draft.name" :disabled="disabled" @update:model-value="patch({ name: text($event) })" />
		</label>
		<UiSectionCard
			title="Targets"
			description="Tried top to bottom. The first target serves normally; the rest take over only when the one above it fails. Drag a target, or use ↑/↓ on its handle, to change that order."
		>
			<template #actions>
				<UiButton appearance="tremor" size="small" :disabled="disabled" @click="patch({ targets: [...draft.targets, ''] })"
					><template #icon><UiIcon name="PlusOutlined" /></template>Add target</UiButton
				>
			</template>
			<UiSortableList
				:items="draft.targets"
				:item-key="(_target, index) => 'alias-target-' + index"
				:label="(index, total) => 'target ' + (index + 1) + ' of ' + total"
				:disabled="disabled"
				@update:items="patch({ targets: $event })"
			>
				<template #item="{ item: target, index, itemProps, itemClass, handleProps }">
					<UiEntryCard :index="index + 1" :primary="index === 0" :class="itemClass" v-bind="itemProps">
						<template #handle><UiDragHandle v-bind="handleProps" /></template>
						<template #title>{{ index === 0 ? "Primary target" : "Fallback target" }}</template>
						<UiSelect
							:model-value="target || null"
							:options="options(draft.name.trim())"
							searchable
							:aria-label="index === 0 ? 'Primary target' : 'Fallback target ' + (index + 1)"
							placeholder="Select a model or alias"
							:disabled="disabled"
							@update:model-value="setTarget(index, $event)"
						/>
						<template #actions>
							<UiEntryRemove
								:label="'Remove target ' + (index + 1)"
								:disabled="disabled || draft.targets.length === 1"
								@click="removeTarget(index)"
							/>
						</template>
					</UiEntryCard>
				</template>
			</UiSortableList>
			<template #footer>
				<UiSwitchRow
					:model-value="draft.recurse"
					:disabled="disabled"
					label="Allow the target's own fallbacks"
					description="Off keeps these targets as the final answer, so an unavailable model cannot drift to a different provider."
					@update:model-value="patch({ recurse: $event })"
				/>
			</template>
		</UiSectionCard>
		<UiSectionCard
			title="Daily time windows"
			description="Start is included; end is excluded. An earlier end time continues into the next day. Windows cannot overlap."
		>
			<template #actions>
				<UiButton
					appearance="tremor"
					size="small"
					:disabled="disabled"
					@click="patch({ schedule: [...draft.schedule, { start: '', end: '', model: '' }] })"
					><template #icon><UiIcon name="PlusOutlined" /></template>Add time window</UiButton
				>
			</template>
			<label v-if="draft.schedule.length" class="model-alias-timezone"
				>Time zone<UiInput
					:model-value="draft.timezone"
					:disabled="disabled"
					placeholder="Asia/Shanghai"
					@update:model-value="patch({ timezone: text($event) })"
			/></label>
			<UiEntryCard v-for="(window, index) in draft.schedule" :key="index" :index="index + 1">
				<template #title
					><span>Window {{ index + 1 }}</span
					><span v-if="window.start && window.end" class="model-alias-window-range"
						>{{ window.start }} → {{ window.end }}</span
					></template
				>
				<template #actions>
					<UiEntryRemove :label="'Remove time window ' + (index + 1)" :disabled="disabled" @click="removeSchedule(index)" />
				</template>
				<div class="model-alias-window-fields">
					<label
						>Start<UiInput
							:model-value="window.start"
							type="time"
							:step="60"
							:aria-label="'Start time ' + (index + 1)"
							:disabled="disabled"
							@update:model-value="setScheduleField(index, 'start', $event)" /></label
					><label
						>End<UiInput
							:model-value="window.end"
							type="time"
							:step="60"
							:aria-label="'End time ' + (index + 1)"
							:disabled="disabled"
							@update:model-value="setScheduleField(index, 'end', $event)" /></label
					><label class="model-alias-window-target"
						>Target<UiSelect
							:model-value="window.model || null"
							:options="options(draft.name.trim())"
							searchable
							:aria-label="'Time window target ' + (index + 1)"
							placeholder="Select a model or alias"
							:disabled="disabled"
							@update:model-value="setScheduleField(index, 'model', $event)"
					/></label>
				</div>
			</UiEntryCard>
			<p v-if="!draft.schedule.length" class="model-alias-empty-note">No time windows yet — the primary target serves all day.</p>
		</UiSectionCard>
	</div>
</template>
