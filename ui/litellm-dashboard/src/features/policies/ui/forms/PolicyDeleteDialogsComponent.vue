<script setup lang="ts">
import type { Policy } from "../../support/PolicyModels";
import UiDialog from "../../../platform/ui/UiDialog.vue";
import UiButton from "../../../platform/ui/UiButton.vue";
import UiCard from "../../../platform/ui/UiCard.vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
defineProps<{ policy: Policy | null; attachmentId: string | null; loading: boolean }>();
defineEmits<{ cancelPolicy: []; deletePolicy: []; cancelAttachment: []; deleteAttachment: [] }>();
</script>
<template>
	<UiDialog
		:open="!!policy"
		title="Delete Policy"
		scroll-mode="overlay"
		class="policy-delete-dialog"
		@update:open="!$event && $emit('cancelPolicy')"
		><div class="policy-delete-content">
			<UiCard appearance="antd" title="Policy Information"
				><dl>
					<div
						v-for="field in [
							{ label: 'Name', value: policy?.policy_name },
							{ label: 'ID', value: policy?.policy_id, code: true },
							{ label: 'Description', value: policy?.description || '-' },
							{ label: 'Inherits From', value: policy?.inherit || '-' },
						]"
						:key="field.label"
					>
						<dt>{{ field.label }}</dt>
						<dd>
							<code v-if="field.code">{{ field.value || "-" }}</code
							><template v-else>{{ field.value || "-" }}</template>
						</dd>
					</div>
				</dl></UiCard
			>
			<p>Are you sure you want to delete policy: {{ policy?.policy_name }}? This action cannot be undone.</p>
		</div>
		<template #footer
			><UiButton :disabled="loading" @click="$emit('cancelPolicy')">Cancel</UiButton
			><UiButton variant="primary" danger :loading="loading" :disabled="loading" @click="$emit('deletePolicy')">{{
				loading ? "Deleting..." : "Delete"
			}}</UiButton></template
		></UiDialog
	>
	<UiDialog
		:open="!!attachmentId"
		:width="416"
		:closable="false"
		:mask-closable="false"
		scroll-mode="overlay"
		class="policy-attachment-delete"
		@update:open="!$event && $emit('cancelAttachment')"
		><div>
			<UiIcon name="ExclamationCircleOutlined" :size="22" />
			<section>
				<strong>Delete Attachment</strong>
				<p>Are you sure you want to delete this attachment? This action cannot be undone.</p>
			</section>
		</div>
		<template #footer
			><UiButton @click="$emit('cancelAttachment')">Cancel</UiButton
			><UiButton variant="primary" danger :loading="loading" @click="$emit('deleteAttachment')">Delete</UiButton></template
		></UiDialog
	>
</template>
