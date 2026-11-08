<script setup lang="ts">
import { computed } from "vue";
import UiDialog from "../../platform/ui/UiDialog.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import { getApiBaseUrl } from "../../platform/api/HttpApiClient";
import { buildInvitationUrl } from "../logic/UserDraftLogic";
import { notificationManager } from "../../notifications/logic/NotificationManager";
import type { AccessRecord } from "../support/AccessModels";
const props = defineProps<{ open: boolean; invitation: AccessRecord | null; reset?: boolean }>(),
	emit = defineEmits<{ "update:open": [value: boolean] }>();
const url = computed(() => buildInvitationUrl(getApiBaseUrl(), props.invitation, props.reset));
async function copy() {
	await navigator.clipboard.writeText(url.value);
	notificationManager.success("Copied!");
}
</script>
<template>
	<UiDialog
		class="access-invitation-dialog"
		scroll-mode="overlay"
		:open="open"
		:title="reset ? 'Reset Password Link' : 'Invitation Link'"
		:width="800"
		:show-footer="false"
		@update:open="emit('update:open', $event)"
		><p>
			{{
				reset
					? "Copy and send the generated link to the user to reset their password."
					: "Copy and send the generated link to onboard this user to the proxy."
			}}
		</p>
		<div class="access-invitation-line">
			<span>User ID</span><span>{{ invitation?.user_id }}</span>
		</div>
		<div class="access-invitation-line">
			<span>{{ reset ? "Reset Password Link" : "Invitation Link" }}</span
			><span>{{ url }}</span>
		</div>
		<footer class="access-form-footer">
			<UiButton variant="primary" @click="copy">{{ reset ? "Copy password reset link" : "Copy invitation link" }}</UiButton>
		</footer></UiDialog
	>
</template>
