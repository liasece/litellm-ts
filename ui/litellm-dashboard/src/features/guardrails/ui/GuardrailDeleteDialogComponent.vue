<script setup lang="ts">
import UiDialog from "../../platform/ui/UiDialog.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiAlert from "../../platform/ui/UiAlert.vue";
withDefaults(
	defineProps<{
		open: boolean;
		title: string;
		message: string;
		informationTitle?: string;
		information?: { label: string; value: unknown; code?: boolean }[];
		warning?: string;
		pending?: boolean;
	}>(),
	{ informationTitle: undefined, warning: undefined, information: () => [] },
);
const emit = defineEmits<{ "update:open": [open: boolean]; confirm: [] }>();
</script>
<template>
	<UiDialog
		scroll-mode="overlay"
		:open="open"
		:title="title"
		:width="520"
		class="guardrail-delete-dialog"
		@update:open="emit('update:open', $event)"
		><UiAlert v-if="warning" type="warning" :title="warning" />
		<section v-if="information.length" class="guardrail-delete-card">
			<header>{{ informationTitle }}</header>
			<div class="guardrail-delete-card-body">
				<div v-for="item in information" :key="item.label" class="guardrail-delete-row">
					<span class="guardrail-delete-label">{{ item.label }}</span
					><span class="guardrail-delete-value"
						><code v-if="item.code">{{ item.value ?? "-" }}</code
						><template v-else>{{ item.value ?? "-" }}</template></span
					>
				</div>
			</div>
		</section>
		<p class="guardrail-delete-message">{{ message }}</p>
		<template #footer
			><UiButton :disabled="pending" @click="emit('update:open', false)">Cancel</UiButton
			><UiButton variant="primary" danger :loading="pending" :disabled="pending" @click="emit('confirm')">{{
				pending ? "Deleting..." : "Delete"
			}}</UiButton></template
		></UiDialog
	>
</template>
