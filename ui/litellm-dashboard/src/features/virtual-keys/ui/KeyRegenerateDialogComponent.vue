<script setup lang="ts">
import notificationManager from "../../notifications/logic/NotificationManager";
import { copyText } from "../../content/logic/ClipboardLogic";
import { computed, ref, watch } from "vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiDialog from "../../platform/ui/UiDialog.vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiInputNumber from "../../platform/ui/UiInputNumber.vue";
import { virtualKeysApi } from "../api/VirtualKeysApi";
import { selectedString, type VirtualKey } from "../support/VirtualKeyModels";
import KeyField from "./KeyFieldComponent.vue";
import "./styles/KeyRegenerateStyles.css";
const open = defineModel<boolean>("open", { required: true });
const props = defineProps<{ keyData: VirtualKey }>();
const emit = defineEmits<{ updated: [response: Record<string, unknown>] }>();
const pending = ref(false);
const secret = ref("");
const draft = ref({
	key_alias: "",
	max_budget: null as number | null,
	tpm_limit: null as number | null,
	rpm_limit: null as number | null,
	duration: "",
	grace_period: "",
});
const graceError = computed(() =>
	/^(\d+(s|m|h|d|w|mo))?$/.test(draft.value.grace_period) ? "" : "Must be a duration like 30s, 30m, 24h, 2d, 1w, or 1mo",
);
function expiry(duration: string) {
	const match = /^(\d+)(s|h|d)$/.exec(duration);
	if (!match) return "";
	return new Date(Date.now() + Number(match[1]) * ({ s: 1000, h: 3600000, d: 86400000 }[match[2]] || 0)).toLocaleString();
}
watch(open, (value) => {
	if (value) {
		const key = props.keyData;
		draft.value = {
			key_alias: key.key_alias || "",
			max_budget: key.max_budget ?? null,
			tpm_limit: key.tpm_limit ?? null,
			rpm_limit: key.rpm_limit ?? null,
			duration: selectedString(key.duration),
			grace_period: "",
		};
		secret.value = "";
	}
});
async function regenerate() {
	if (graceError.value) return;
	pending.value = true;
	try {
		const result = await virtualKeysApi.regenerateKey(props.keyData.token || props.keyData.token_id || "", { ...draft.value });
		secret.value = selectedString(result.key);
		notificationManager.success("Virtual Key regenerated successfully");
		emit("updated", {
			...draft.value,
			token: result.token || result.key_id || props.keyData.token,
			key_name: secret.value,
			expires: draft.value.duration ? expiry(draft.value.duration) || props.keyData.expires : props.keyData.expires,
			...result,
		});
	} catch (reason: unknown) {
		notificationManager.fromBackend(reason);
	} finally {
		pending.value = false;
	}
}
async function copy() {
	try {
		await copyText(secret.value);
		notificationManager.success("Virtual Key copied to clipboard");
	} catch {
		// copyText 已提示失败。
	}
}
</script>
<template>
	<UiDialog v-model:open="open" title="Regenerate Virtual Key" scroll-mode="overlay">
		<div v-if="secret" class="vk-regenerated">
			<p class="vk-regenerated-title">Regenerated Key</p>
			<div>
				<p>
					Please replace your old key with the new key generated. For security reasons,
					<b>you will not be able to view it again</b> through your LiteLLM account. If you lose this secret key, you will need to
					generate a new one.
				</p>
			</div>
			<div>
				<p class="vk-regenerated-label">Key Alias:</p>
				<div class="vk-regenerated-value">
					<pre>{{ keyData.key_alias || "No alias set" }}</pre>
				</div>
				<p class="vk-regenerated-label">New Virtual Key:</p>
				<div class="vk-regenerated-value">
					<pre>{{ secret }}</pre>
				</div>
				<UiButton appearance="tremor" variant="primary" class="vk-regenerated-copy" @click="copy">Copy Virtual Key</UiButton>
			</div>
		</div>
		<form v-else class="vk-regenerate-form" @submit.prevent="regenerate">
			<KeyField label="Key Alias"><UiInput :model-value="draft.key_alias" appearance="tremor" disabled /></KeyField>
			<KeyField label="Max Budget (USD)"><UiInputNumber v-model="draft.max_budget" :step="0.01" :precision="2" /></KeyField>
			<KeyField label="TPM Limit"><UiInputNumber v-model="draft.tpm_limit" /></KeyField>
			<KeyField label="RPM Limit"><UiInputNumber v-model="draft.rpm_limit" /></KeyField>
			<KeyField label="Expire Key (eg: 30s, 30h, 30d)" class="vk-regenerate-duration"
				><UiInput :model-value="draft.duration" appearance="tremor" @update:model-value="draft.duration = selectedString($event)"
			/></KeyField>
			<p class="vk-regenerate-help">Current expiry: {{ keyData.expires ? new Date(keyData.expires).toLocaleString() : "Never" }}</p>
			<p v-if="expiry(draft.duration)" class="vk-new-expiry">New expiry: {{ expiry(draft.duration) }}</p>
			<KeyField
				label="Grace Period (eg: 24h, 2d)"
				tooltip-icon="QuestionCircleOutlined"
				tooltip="Keep the old key valid for this duration after rotation. Both keys work during this period for seamless cutover. Empty = immediate revoke."
				:error="graceError"
				class="vk-regenerate-duration"
				><UiInput
					:model-value="draft.grace_period"
					appearance="tremor"
					placeholder="e.g. 24h, 2d (empty = immediate revoke)"
					@update:model-value="draft.grace_period = selectedString($event)"
			/></KeyField>
			<p class="vk-regenerate-help">Recommended: 24h to 72h for production keys to allow seamless client migration.</p>
		</form>
		<template #footer
			><UiButton v-if="secret" appearance="tremor" variant="primary" @click="open = false">Close</UiButton
			><template v-else
				><UiButton appearance="tremor" variant="primary" @click="open = false">Cancel</UiButton
				><UiButton appearance="tremor" variant="primary" :disabled="pending" @click="regenerate">{{
					pending ? "Regenerating..." : "Regenerate"
				}}</UiButton></template
			></template
		>
	</UiDialog>
</template>
