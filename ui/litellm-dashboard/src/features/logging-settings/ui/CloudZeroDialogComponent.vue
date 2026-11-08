<script setup lang="ts">
import { computed, ref, watch } from "vue";
import UiDialog from "../../platform/ui/UiDialog.vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import { nextUiIdentity } from "../../platform/ui/UiIdentity";
import { cloudZeroApi, type CloudZeroSettings } from "../api/CloudZeroApi";
import { cloudZeroPayload } from "../logic/CloudZeroPayloadLogic";
import message from "../../notifications/logic/MessageManager";
const open = defineModel<boolean>("open", { default: false });
const props = defineProps<{ settings?: CloudZeroSettings | null }>();
const emit = defineEmits<{ changed: [] }>();
const edit = computed(() => Boolean(props.settings)),
	values = ref<Record<string, string>>({ api_key: "", connection_id: "", timezone: "" }),
	pending = ref(false),
	errors = ref<Record<string, string>>({});
const prefix = nextUiIdentity("cloudzero");
watch(open, (value) => {
	if (!value) return;
	errors.value = {};
	values.value = {
		api_key: "",
		connection_id: props.settings?.connection_id || "",
		timezone: edit.value ? props.settings?.timezone || "UTC" : "",
	};
});
async function save() {
	errors.value = {};
	if (!edit.value && !values.value.api_key) errors.value.api_key = "Please enter your CloudZero API key";
	if (!values.value.connection_id) errors.value.connection_id = "Please enter your CloudZero connection ID";
	if (Object.keys(errors.value).length) return;
	pending.value = true;
	try {
		const payload = cloudZeroPayload(values.value, edit.value);
		if (edit.value) await cloudZeroApi.update(payload);
		else await cloudZeroApi.create(payload);
		message.success(edit.value ? "CloudZero integration updated successfully" : "CloudZero integration created successfully");
		open.value = false;
		emit("changed");
	} catch (error) {
		message.error(
			error instanceof Error
				? error.message
				: edit.value
					? "Failed to update CloudZero integration"
					: "Failed to create CloudZero integration",
		);
	} finally {
		pending.value = false;
	}
}
</script>
<template>
	<UiDialog
		v-model:open="open"
		:title="edit ? 'Edit CloudZero Integration' : 'Create CloudZero Integration'"
		:ok-text="pending ? (edit ? 'Updating...' : 'Creating...') : edit ? 'Update' : 'Create'"
		:confirm-loading="pending"
		scroll-mode="overlay"
		class="logging-cloudzero-dialog"
		@ok="save"
		><form @submit.prevent="save">
			<div
				v-for="field in [
					{ name: 'api_key', label: 'CloudZero API Key' },
					{ name: 'connection_id', label: 'Connection ID' },
					{ name: 'timezone', label: 'Timezone' },
				]"
				:key="field.name"
				class="logging-cloudzero-field"
			>
				<label
					:for="prefix + '-' + field.name"
					:class="{ 'logging-required': field.name === 'connection_id' || (!edit && field.name === 'api_key') }"
					>{{ field.label
					}}<UiTooltip
						v-if="field.name === 'timezone' || (edit && field.name === 'api_key')"
						:title="
							field.name === 'timezone'
								? 'Timezone for date handling (defaults to UTC if not provided)'
								: 'Leave empty to keep the existing API key'
						"
						><UiIcon name="QuestionCircleOutlined" /></UiTooltip></label
				><UiInput
					:id="prefix + '-' + field.name"
					v-model="values[field.name]"
					:type="field.name === 'api_key' ? 'password' : 'text'"
					:visibility-toggle="field.name === 'api_key'"
					:status="errors[field.name] ? 'error' : undefined"
					:placeholder="
						field.name === 'api_key'
							? edit
								? 'Leave empty to keep existing'
								: 'Enter your CloudZero API key'
							: field.name === 'connection_id'
								? 'Enter your CloudZero connection ID'
								: 'UTC'
					"
				/>
				<p v-if="errors[field.name]" class="logging-error">{{ errors[field.name] }}</p>
			</div>
		</form></UiDialog
	>
</template>
