<script setup lang="ts">
import { ref } from "vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiHeroIcon from "../../platform/ui/UiHeroIcon.vue";
import UiPopover from "../../platform/ui/UiPopover.vue";
const props = defineProps<{ label: string; state: "asc" | "desc" | false }>();
const emit = defineEmits<{ change: [value: "asc" | "desc" | false] }>();
const popover = ref<InstanceType<typeof UiPopover>>();
function select(value: "asc" | "desc" | false) {
	emit("change", value);
	popover.value?.hide();
}
</script>
<template>
	<div class="logs-sort">
		<span>{{ label }}</span>
		<UiPopover ref="popover" trigger="click" placement="bottomLeft" popup-class="logs-sort-popup" popup-role="menu">
			<UiButton
				variant="text"
				:title="'Sort ' + label"
				:aria-label="'Sort ' + label"
				:style="{ color: props.state ? '#3b82f6' : '#9ca3af' }"
			>
				<template #icon>
					<UiHeroIcon
						:name="state === 'asc' ? 'ChevronUpIcon' : state === 'desc' ? 'ChevronDownIcon' : 'SwitchVerticalIcon'"
						:size="16"
					/>
				</template>
			</UiButton>
			<template #content>
				<button
					v-for="option in [
						{ key: 'asc' as const, label: 'Ascending' },
						{ key: 'desc' as const, label: 'Descending' },
						{ key: false as const, label: 'Reset' },
					]"
					:key="String(option.key)"
					type="button"
					role="menuitem"
					:class="{ selected: state === option.key && !!state }"
					@click="select(option.key)"
				>
					<UiHeroIcon
						:name="option.key === 'asc' ? 'ChevronUpIcon' : option.key === 'desc' ? 'ChevronDownIcon' : 'XIcon'"
						:size="16"
					/>{{ option.label }}
				</button>
			</template>
		</UiPopover>
	</div>
</template>
