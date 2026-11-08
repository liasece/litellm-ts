<script setup lang="ts">
import { ref, watch } from "vue";
import UiDialog from "../../platform/ui/UiDialog.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiAlert from "../../platform/ui/UiAlert.vue";
import UiInput from "../../platform/ui/UiInput.vue";
const props = withDefaults(
	defineProps<{
		open: boolean;
		title: string;
		message: string;
		informationTitle?: string;
		information?: { label: string; value: unknown; code?: boolean }[];
		confirmation?: string | null;
		warning?: string;
		pending?: boolean;
	}>(),
	{ informationTitle: undefined, confirmation: undefined, warning: undefined, information: () => [] },
);
const emit = defineEmits<{ "update:open": [open: boolean]; confirm: [] }>();
const value = ref<string | number | null>("");
watch(
	() => props.open,
	() => {
		value.value = "";
	},
);
</script>
<template>
	<UiDialog scroll-mode="overlay" :open="open" :title="title" :width="520" @update:open="emit('update:open', $event)"
		><UiAlert v-if="warning" type="warning" :title="warning" />
		<section
			v-if="information.length"
			class="access-delete-information"
			:class="{ 'access-delete-group': title === 'Delete Access Group' }"
		>
			<strong>{{ informationTitle }}</strong>
			<dl>
				<div v-for="item in information" :key="item.label" class="access-delete-row">
					<dt>{{ item.label }}</dt>
					<dd>
						<code v-if="item.code">{{ item.value ?? "—" }}</code
						><span v-else>{{ item.value ?? "—" }}</span>
					</dd>
				</div>
			</dl>
		</section>
		<p class="access-delete-message">{{ message }}</p>
		<div v-if="confirmation" class="access-delete-confirmation">
			<p>
				Type <strong>{{ confirmation }}</strong> to confirm deletion:
			</p>
			<UiInput v-model="value" :placeholder="confirmation" />
		</div>
		<template #footer
			><UiButton :disabled="pending" @click="emit('update:open', false)">Cancel</UiButton
			><UiButton
				variant="primary"
				class="access-delete-submit"
				:loading="pending"
				:disabled="Boolean(confirmation && value !== confirmation)"
				@click="emit('confirm')"
				>{{ pending ? "Deleting..." : "Delete" }}</UiButton
			></template
		></UiDialog
	>
</template>
