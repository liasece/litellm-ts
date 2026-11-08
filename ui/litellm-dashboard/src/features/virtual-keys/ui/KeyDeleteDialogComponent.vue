<script setup lang="ts">
import notificationManager from "../../notifications/logic/NotificationManager";
import { ref, watch } from "vue";
import UiAlert from "../../platform/ui/UiAlert.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiDialog from "../../platform/ui/UiDialog.vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import { useMoneyFormatter } from "../../platform/stores/PriceDisplayStore";
import { virtualKeysApi } from "../api/VirtualKeysApi";
import { selectedString, type VirtualKey } from "../support/VirtualKeyModels";
const open = defineModel<boolean>("open", { required: true });
const props = defineProps<{ keyData: VirtualKey }>();
const emit = defineEmits<{ deleted: [token: string] }>();
const confirm = ref("");
const pending = ref(false);
const error = ref("");
const formatMoney = useMoneyFormatter();
watch(open, (value) => {
	if (value) {
		confirm.value = "";
		error.value = "";
	}
});
async function remove() {
	if (pending.value || (props.keyData.key_alias && confirm.value !== props.keyData.key_alias)) return;
	pending.value = true;
	error.value = "";
	try {
		await virtualKeysApi.deleteKey(props.keyData.token);
		notificationManager.success("Key deleted successfully");
		emit("deleted", props.keyData.token);
		open.value = false;
	} catch (reason: unknown) {
		error.value = reason instanceof Error ? reason.message : "Failed to delete key";
		notificationManager.fromBackend(reason);
	} finally {
		pending.value = false;
	}
}
</script>
<template>
	<UiDialog v-model:open="open" title="Delete Key" class="vk-delete-modal" scroll-mode="overlay">
		<div class="vk-delete-body">
			<UiAlert type="warning"
				>This action is irreversible and will immediately revoke access for any applications using this key.</UiAlert
			>
			<UiAlert v-if="error" type="error">{{ error }}</UiAlert>
			<UiCard appearance="antd" title="Key Information" class="vk-delete-information"
				><dl>
					<template
						v-for="[label, value] in [
							['Key Alias', keyData.key_alias || '-'],
							['Key ID', keyData.token_id || keyData.token || '-'],
							['Team ID', keyData.team_id || '-'],
							['Spend', formatMoney(keyData.spend || 0, 4)],
						]"
						:key="label"
						><dt>{{ label }}</dt>
						<dd>
							<code v-if="label === 'Key ID' || label === 'Team ID'">{{ value }}</code
							><template v-else>{{ value }}</template>
						</dd></template
					>
				</dl></UiCard
			>
			<p>Are you sure you want to delete this Virtual Key?</p>
			<div v-if="keyData.key_alias" class="vk-delete-confirm">
				<p>
					Type <strong>{{ keyData.key_alias }}</strong> to confirm deletion:
				</p>
				<UiInput
					:model-value="confirm"
					:placeholder="keyData.key_alias"
					autofocus
					@update:model-value="confirm = selectedString($event)"
					><template #prefix><UiIcon name="ExclamationCircleOutlined" /></template
				></UiInput>
			</div>
		</div>
		<template #footer
			><UiButton :disabled="pending" @click="open = false">Cancel</UiButton
			><UiButton
				variant="primary"
				danger
				:disabled="Boolean(keyData.key_alias && confirm !== keyData.key_alias) || pending"
				:loading="pending"
				@click="remove"
				>{{ pending ? "Deleting..." : "Delete" }}</UiButton
			></template
		>
	</UiDialog>
</template>
