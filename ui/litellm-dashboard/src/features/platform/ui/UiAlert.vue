<script setup lang="ts">
import { useSlots } from "vue";
import UiIcon from "./UiIcon.vue";
withDefaults(defineProps<{ type?: "info" | "success" | "warning" | "error"; title?: string; closable?: boolean; showIcon?: boolean }>(), {
	type: "info",
	showIcon: true,
	title: undefined,
});
defineEmits<{ close: [] }>();
const slots = useSlots();
</script>

<template>
	<div
		class="ui-alert"
		:class="['ui-alert--' + type, { 'ui-alert--description': (title || slots.title) && slots.default }]"
		:role="type === 'error' ? 'alert' : 'status'"
	>
		<span v-if="showIcon" class="ui-alert__symbol" aria-hidden="true"
			><slot name="icon"
				><UiIcon
					:name="
						type === 'success'
							? 'CheckCircleFilled'
							: type === 'error'
								? 'CloseCircleFilled'
								: type === 'warning'
									? 'ExclamationCircleFilled'
									: 'InfoCircleFilled'
					" /></slot
		></span>
		<div class="ui-alert__content">
			<div v-if="title || slots.title" class="ui-alert__title">
				<slot name="title">{{ title }}</slot>
			</div>
			<slot />
		</div>
		<div v-if="$slots.action" class="ui-alert__action"><slot name="action" /></div>
		<button v-if="closable" type="button" class="ui-alert__close" aria-label="Close" @click="$emit('close')">
			<UiIcon name="CloseOutlined" :size="12" />
		</button>
	</div>
</template>
