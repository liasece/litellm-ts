<script setup lang="ts">
import { onMounted, ref } from "vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiInputNumber from "../../platform/ui/UiInputNumber.vue";
import UiSwitch from "../../platform/ui/UiSwitch.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiHeroIcon from "../../platform/ui/UiHeroIcon.vue";
import { loggingSettingsApi } from "../api/LoggingSettingsApi";
import notification from "../../notifications/logic/NotificationManager";
defineProps<{ premium: boolean }>();
const fields = ref<Record<string, unknown>[]>([]),
	touched = ref(false);
onMounted(async () => {
	try {
		fields.value = await loggingSettingsApi.alertParameters();
	} catch (error) {
		notification.fromBackend(error);
	}
});
function change(field: Record<string, unknown>, value: unknown) {
	field.field_value = value;
	touched.value = true;
}
function reset(field: Record<string, unknown>) {
	field.stored_in_db = null;
	field.field_value = field.field_default_value;
}
async function save() {
	if (!touched.value) return;
	const values = Object.fromEntries(fields.value.map((field) => [String(field.field_name), field.field_value]));
	const { slack_alerting, ...args } = values;
	try {
		await loggingSettingsApi.updateField("alerting_args", args);
		if (typeof slack_alerting === "boolean") await loggingSettingsApi.updateField("alerting", slack_alerting ? ["slack"] : []);
		notification.success("Wait 10s for proxy to update.");
	} catch (error) {
		notification.fromBackend(error);
	}
}
</script>
<template>
	<form class="logging-alert-parameters" @submit.prevent="save">
		<table>
			<tbody>
				<tr v-for="field in fields" :key="String(field.field_name)">
					<td>
						<p>{{ field.field_name }}</p>
						<small>{{ field.field_description }}</small>
					</td>
					<td
						class="logging-alert-parameters__input"
						:class="{ 'logging-alert-parameters__input--premium': field.premium_field }"
					>
						<UiButton v-if="field.premium_field && !premium" appearance="tremor" variant="primary"
							><a href="https://forms.gle/W3U4PZpJGFHWtHyA9" target="_blank" rel="noreferrer"
								>✨ Enterprise Feature</a
							></UiButton
						><UiInputNumber
							v-else-if="field.field_type === 'Integer'"
							:model-value="typeof field.field_value === 'number' ? field.field_value : null"
							:step="1"
							@update:model-value="change(field, $event)"
						/><UiSwitch
							v-else-if="field.field_type === 'Boolean'"
							:model-value="Boolean(field.field_value)"
							appearance="tremor"
							:label="String(field.field_name)"
							@update:model-value="change(field, $event)"
						/><UiInput
							v-else
							:model-value="field.field_value == null ? '' : String(field.field_value)"
							@update:model-value="change(field, $event)"
						/>
					</td>
					<td>
						<span class="logging-setting-status" :class="{ 'logging-setting-status--db': field.stored_in_db === true }"
							><UiHeroIcon v-if="field.stored_in_db === true" name="CheckCircleIcon" :size="16" />{{
								field.stored_in_db === true ? "In DB" : field.stored_in_db === false ? "In Config" : "Not Set"
							}}</span
						>
					</td>
					<td>
						<button type="button" :aria-label="'Reset ' + field.field_name" class="logging-reset-field" @click="reset(field)">
							<UiHeroIcon name="TrashIcon" :size="20" />
						</button>
					</td>
				</tr>
			</tbody>
		</table>
		<UiButton type="submit">Update Settings</UiButton>
	</form>
</template>
