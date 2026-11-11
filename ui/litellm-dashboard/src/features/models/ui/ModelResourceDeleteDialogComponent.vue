<script setup lang="ts">
import { ref, watch } from "vue";
import "./ModelDetailsStyles.css";
import UiDialog from "../../platform/ui/UiDialog.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiAlert from "../../platform/ui/UiAlert.vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import ModelName from "../../providers/ui/ModelNameComponent.vue";
import ProviderLogo from "../../providers/ui/ProviderLogoComponent.vue";
import { getProviderLogoAndName } from "../../providers/logic/ProviderIdentityLogic";
const props = withDefaults(
	defineProps<{
		open: boolean;
		title: string;
		message: string;
		alertMessage?: string;
		informationTitle?: string;
		information?: { label: string; value: unknown; model?: string; provider?: string }[];
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
function confirm() {
	if (props.pending || (props.requiredConfirmation && confirmation.value !== props.requiredConfirmation)) return;
	emit("confirm");
}
</script>
<template>
	<UiDialog
		:open="open"
		:title="title"
		:width="520"
		scroll-mode="overlay"
		class="model-resource-delete"
		@update:open="emit('update:open', $event)"
		><div class="model-resource-delete__content">
			<UiAlert v-if="alertMessage" :title="alertMessage" type="warning" :show-icon="false" /><UiCard
				appearance="antd"
				:title="informationTitle"
				:padding="16"
				class="model-resource-delete__information"
				><dl>
					<div v-for="entry in information" :key="entry.label" class="model-resource-delete__entry">
						<dt>
							<span>{{ entry.label }}</span>
						</dt>
						<dd>
							<ModelName
								v-if="entry.model"
								:model="entry.model"
								:provider="entry.provider"
								:name="String(entry.value ?? '')"
								:size="16"
							/>
							<template v-else-if="entry.provider"
								><ProviderLogo
									:provider="getProviderLogoAndName(entry.provider).displayName"
									:logo="getProviderLogoAndName(entry.provider).logo"
								/><span>{{ entry.value ?? "-" }}</span></template
							><span v-else>{{ entry.value ?? "-" }}</span>
						</dd>
					</div>
				</dl></UiCard
			>
			<p>{{ message }}</p>
			<div v-if="requiredConfirmation" class="model-resource-delete__confirmation">
				<p>
					<span>Type </span
					><span class="model-resource-delete__confirmation-value"
						><strong>{{ requiredConfirmation }}</strong></span
					><span> to confirm deletion:</span>
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
				@click="confirm"
				>{{ pending ? "Deleting..." : "Delete" }}</UiButton
			></template
		></UiDialog
	>
</template>
