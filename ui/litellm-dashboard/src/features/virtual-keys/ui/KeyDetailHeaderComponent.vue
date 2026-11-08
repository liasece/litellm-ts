<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiTag from "../../platform/ui/UiTag.vue";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import KeyCopyableValue from "./KeyCopyableValueComponent.vue";
import { keyTimestamp } from "../render/KeyTablePresentation";
import type { VirtualKey } from "../support/VirtualKeyModels";
const props = defineProps<{ keyData: VirtualKey; canModify: boolean; canReset: boolean; premium: boolean; backButtonText?: string }>();
const emit = defineEmits<{ regenerate: []; remove: []; reset: []; back: [] }>();
const copied = ref("");
let timer: ReturnType<typeof setTimeout> | null = null;
async function copy(label: string, value: string) {
	await navigator.clipboard.writeText(value);
	copied.value = label;
	if (timer) clearTimeout(timer);
	timer = setTimeout(() => (copied.value = ""), 2000);
}
const columns = computed(() => [
	[
		{ label: "User Email", value: props.keyData.user_email || "", icon: "MailOutlined", copy: false },
		{ label: "User ID", value: props.keyData.user_id || "", icon: "UserOutlined", copy: true },
	],
	[
		{
			label: "Created At",
			value: props.keyData.created_at ? keyTimestamp(props.keyData.created_at) : "",
			icon: "CalendarOutlined",
			copy: false,
		},
		{
			label: "Created By",
			value: props.keyData.user_email || props.keyData.user_id || "",
			icon: "SafetyCertificateOutlined",
			copy: true,
		},
	],
	[
		{
			label: "Last Updated",
			value: props.keyData.updated_at ? keyTimestamp(props.keyData.updated_at) : "",
			icon: "ClockCircleOutlined",
			copy: false,
		},
		{
			label: "Last Active",
			value: props.keyData.last_active ? keyTimestamp(props.keyData.last_active) : "Never",
			icon: "ThunderboltOutlined",
			copy: false,
		},
	],
]);
onBeforeUnmount(() => {
	if (timer) clearTimeout(timer);
});
</script>
<template>
	<div class="vk-detail-header">
		<UiButton v-if="backButtonText" variant="text" class="vk-back-button" @click="emit('back')"
			><template #icon><UiIcon name="ArrowLeftOutlined" /></template>{{ backButtonText }}</UiButton
		>
		<div class="vk-detail-heading">
			<div>
				<h3>
					{{ keyData.key_alias || "Virtual Key"
					}}<button
						type="button"
						:title="copied === 'alias' ? 'Copied!' : 'Copy Key Alias'"
						aria-label="Copy Key Alias"
						@click="copy('alias', keyData.key_alias || 'Virtual Key')"
					>
						<UiIcon :name="copied === 'alias' ? 'CheckOutlined' : 'CopyOutlined'" />
					</button>
				</h3>
				<p>
					Key ID: {{ keyData.token_id || keyData.token
					}}<button
						type="button"
						:title="copied === 'id' ? 'Copied!' : 'Copy Key ID'"
						aria-label="Copy Key ID"
						@click="copy('id', keyData.token_id || keyData.token)"
					>
						<UiIcon :name="copied === 'id' ? 'CheckOutlined' : 'CopyOutlined'" />
					</button>
				</p>
			</div>
			<div v-if="canModify" class="vk-detail-actions">
				<UiTooltip :title="premium ? '' : 'This is a LiteLLM Enterprise feature, and requires a valid key to use.'"
					><span
						><UiButton :disabled="!premium" @click="emit('regenerate')"
							><template #icon><UiIcon name="SyncOutlined" /></template>Regenerate Key</UiButton
						></span
					></UiTooltip
				><UiButton v-if="canReset" danger @click="emit('reset')"
					><template #icon><UiIcon name="TransactionOutlined" /></template>Reset Spend</UiButton
				><UiButton danger @click="emit('remove')"
					><template #icon><UiIcon name="DeleteOutlined" /></template>Delete Key</UiButton
				>
			</div>
		</div>
		<div class="vk-key-facts">
			<template v-for="(column, index) in columns" :key="index"
				><div v-if="index" class="vk-key-fact-divider" />
				<div class="vk-key-fact-column">
					<div v-for="field in column" :key="field.label" class="vk-key-fact-item">
						<div>
							<div class="vk-key-fact-label">
								<div>
									<span class="vk-key-fact-icon-text"
										><span class="vk-key-fact-icon"><UiIcon :name="field.icon" /></span
									></span>
								</div>
								<div>
									<span class="vk-key-fact-label-text">{{ field.label }}</span>
								</div>
							</div>
							<div class="vk-key-fact-value">
								<UiTag v-if="field.copy && field.value === 'default_user_id'" color="blue">Default Proxy Admin</UiTag>
								<KeyCopyableValue
									v-else-if="field.copy && field.value"
									:value="field.value"
									:label="field.label"
									:copied="copied === field.label"
									@copy="copy(field.label, field.value)"
								/>
								<span v-else class="vk-key-fact-value-text"
									><strong>{{ field.value || "-" }}</strong></span
								>
							</div>
						</div>
					</div>
				</div></template
			>
		</div>
	</div>
</template>
