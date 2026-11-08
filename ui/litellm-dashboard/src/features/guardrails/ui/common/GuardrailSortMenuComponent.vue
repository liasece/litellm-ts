<script setup lang="ts">
import { ref } from "vue";
import UiPopover from "../../../platform/ui/UiPopover.vue";
import UiButton from "../../../platform/ui/UiButton.vue";
import UiHeroIcon from "../../../platform/ui/UiHeroIcon.vue";
defineProps<{ value: "asc" | "desc" | false }>();
const emit = defineEmits<{ change: [value: "asc" | "desc" | false] }>(),
	popup = ref<InstanceType<typeof UiPopover>>();
function select(value: "asc" | "desc" | false) {
	emit("change", value);
	popup.value?.hide();
}
</script>
<template>
	<UiPopover ref="popup" trigger="click" placement="bottomLeft" popup-class="guardrail-sort-menu" popup-role="menu"
		><UiButton variant="text" :class="['guardrail-sort-trigger', { active: Boolean(value) }]" aria-label="Sort column"
			><template #icon
				><UiHeroIcon
					:name="value === 'asc' ? 'ChevronUpIcon' : value === 'desc' ? 'ChevronDownIcon' : 'SwitchVerticalIcon'"
					:size="16" /></template></UiButton
		><template #content
			><button type="button" :class="{ selected: value === 'asc' }" @click="select('asc')">
				<UiHeroIcon name="ChevronUpIcon" :size="16" />Ascending</button
			><button type="button" :class="{ selected: value === 'desc' }" @click="select('desc')">
				<UiHeroIcon name="ChevronDownIcon" :size="16" />Descending</button
			><button type="button" @click="select(false)"><UiHeroIcon name="XIcon" :size="16" />Reset</button></template
		></UiPopover
	>
</template>
