<script setup lang="ts">
import { computed, ref } from "vue";
import UiCheckbox from "../../platform/ui/UiCheckbox.vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import UiSwitch from "../../platform/ui/UiSwitch.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import { selectedString, type KeyDraft } from "../support/VirtualKeyModels";
const draft = defineModel<KeyDraft>({ required: true });
const props = withDefaults(defineProps<{ creating?: boolean; errors?: Record<string, string> }>(), { errors: () => ({}) });
const custom = ref(Boolean(draft.value.rotation_interval) && !["7d", "30d", "90d", "180d", "365d"].includes(draft.value.rotation_interval));
const interval = computed(() => (custom.value ? "custom" : draft.value.rotation_interval));
function selectInterval(value: unknown) {
	const selected = selectedString(value);
	custom.value = selected === "custom";
	if (!custom.value) draft.value.rotation_interval = selected;
}
function duration(value: unknown) {
	draft.value.duration = selectedString(value);
	if (props.creating) draft.value.never_expire = !draft.value.duration;
}
</script>
<template>
	<div class="vk-lifecycle">
		<div class="vk-lifecycle-section">
			<h3>Key Expiry Settings</h3>
			<label
				>Expire Key<UiTooltip
					title="Set when this key should expire. Format: 30s (seconds), 30m (minutes), 30h (hours), 30d (days). Leave empty to keep the current expiry unchanged."
					><UiIcon name="InfoCircleOutlined" :size="12" /></UiTooltip
				><UiCheckbox v-if="!creating" v-model="draft.never_expire" @update:model-value="draft.never_expire && (draft.duration = '')"
					>Never Expire</UiCheckbox
				></label
			><UiInput
				:model-value="draft.duration"
				appearance="tremor"
				name="duration"
				:placeholder="creating ? 'e.g., 30d or leave empty to never expire' : 'e.g., 30d'"
				:disabled="!creating && draft.never_expire"
				@update:model-value="duration"
			/>
			<p v-if="errors.duration" class="vk-field-error">{{ errors.duration }}</p>
		</div>
		<hr />
		<div class="vk-lifecycle-section">
			<h3>Auto-Rotation Settings</h3>
			<div class="vk-lifecycle-grid">
				<div>
					<label
						>Enable Auto-Rotation<UiTooltip
							title="Key will automatically regenerate at the specified interval for enhanced security."
							><UiIcon name="InfoCircleOutlined" :size="12" /></UiTooltip></label
					><UiSwitch
						v-model="draft.auto_rotate"
						label="Enable Auto-Rotation"
						:class="{ 'vk-rotation-disabled': !draft.auto_rotate }"
					/>
				</div>
				<div v-if="draft.auto_rotate">
					<label
						>Rotation Interval<UiTooltip
							title="How often the key should be automatically rotated. Choose the interval that best fits your security requirements."
							><UiIcon name="InfoCircleOutlined" :size="12" /></UiTooltip></label
					><UiSelect
						:model-value="interval"
						:options="[
							{ value: '7d', label: '7 days' },
							{ value: '30d', label: '30 days' },
							{ value: '90d', label: '90 days' },
							{ value: '180d', label: '180 days' },
							{ value: '365d', label: '365 days' },
							{ value: 'custom', label: 'Custom interval' },
						]"
						placeholder="Select interval"
						@update:model-value="selectInterval"
					/>
					<div v-if="custom" class="vk-custom-interval">
						<UiInput
							:model-value="draft.rotation_interval"
							appearance="tremor"
							placeholder="e.g., 1s, 5m, 2h, 14d"
							@update:model-value="draft.rotation_interval = selectedString($event)"
						/><small>Supported formats: seconds (s), minutes (m), hours (h), days (d)</small>
					</div>
					<p v-if="errors.rotation_interval" class="vk-field-error">{{ errors.rotation_interval }}</p>
				</div>
			</div>
			<div v-if="draft.auto_rotate" class="vk-rotation-notice">
				When rotation occurs, you'll receive a notification with the new key. The old key will be deactivated after a brief grace
				period.
			</div>
		</div>
	</div>
</template>
