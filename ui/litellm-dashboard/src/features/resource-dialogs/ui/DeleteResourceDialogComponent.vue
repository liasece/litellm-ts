<script setup lang="ts">
import { ref, watch } from "vue";
import "./DeleteResourceDialogStyles.css";
import UiDialog from "../../platform/ui/UiDialog.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiAlert from "../../platform/ui/UiAlert.vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
const props = withDefaults(
	defineProps<{
		open: boolean;
		title: string;
		message: string;
		alertMessage?: string;
		informationTitle?: string;
		information?: { label: string; value: unknown; code?: boolean }[];
		requiredConfirmation?: string;
		pending?: boolean;
	}>(),
	{ alertMessage: undefined, informationTitle: undefined, information: () => [], requiredConfirmation: undefined },
);
const emit = defineEmits<{ "update:open": [value: boolean]; confirm: [] }>();
const confirmation = ref<string | number | null>("");
watch(
	() => props.open,
	() => (confirmation.value = ""),
);
</script>
<template>
	<UiDialog
		:open="open"
		:title="title"
		:width="520"
		scroll-mode="overlay"
		class="resource-delete"
		@update:open="emit('update:open', $event)"
		><div class="resource-delete__content">
			<UiAlert v-if="alertMessage" :title="alertMessage" type="warning" :show-icon="false" /><UiCard
				appearance="antd"
				:title="informationTitle"
				:padding="16"
				class="resource-delete__information"
				><dl>
					<template v-for="entry in information" :key="entry.label"
						><div class="resource-delete__entry">
							<dt>
								<span>{{ entry.label }}</span>
							</dt>
							<dd>
								<code v-if="entry.code">{{ entry.value ?? "-" }}</code
								><span v-else>{{ entry.value ?? "-" }}</span>
							</dd>
						</div></template
					>
				</dl></UiCard
			>
			<p>{{ message }}</p>
			<div v-if="requiredConfirmation" class="resource-delete__confirmation">
				<p>
					Type <strong>{{ requiredConfirmation }}</strong> to confirm deletion:
				</p>
				<UiInput v-model="confirmation" :placeholder="requiredConfirmation" autofocus
					><template #prefix><UiIcon name="ExclamationCircleOutlined" /></template
				></UiInput>
			</div>
		</div>
		<template #footer
			><UiButton :disabled="pending" @click="emit('update:open', false)">Cancel</UiButton
			><UiButton
				variant="primary"
				danger
				:loading="pending"
				:disabled="Boolean(requiredConfirmation && confirmation !== requiredConfirmation) || pending"
				@click="emit('confirm')"
				>{{ pending ? "Deleting..." : "Delete" }}</UiButton
			></template
		></UiDialog
	>
</template>
