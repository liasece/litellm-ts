<script setup lang="ts">
import { onMounted, ref } from "vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiInputNumber from "../../platform/ui/UiInputNumber.vue";
import UiSwitch from "../../platform/ui/UiSwitch.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiHeroIcon from "../../platform/ui/UiHeroIcon.vue";
import { routerSettingsApi } from "../api/RouterSettingsApi";
import { routerString } from "../support/RouterSettingsModels";
import type { ProxyConfigField } from "../../proxy-config/api/ProxyConfigApi";
import notification from "../../notifications/logic/NotificationManager";
const fields = ref<ProxyConfigField[]>([]),
	candidates = ref<{ value: string; label: string }[]>([]);
onMounted(async () => {
	const results = await Promise.allSettled([routerSettingsApi.general(), routerSettingsApi.candidates()]);
	if (results[0].status === "fulfilled") fields.value = results[0].value;
	if (results[1].status === "fulfilled")
		candidates.value = results[1].value.map((value) => ({
			value: value.model_name,
			label: (value.type === "alias" ? "Alias" : "模型") + ": " + value.model_name,
		}));
});
async function update(field: ProxyConfigField) {
	if (field.field_value == null) return;
	field.stored_in_db = true;
	try {
		await routerSettingsApi.updateField(field.field_name, field.field_value);
		notification.success("Successfully updated value!");
	} catch (error) {
		notification.fromBackend(error);
	}
}
async function reset(field: ProxyConfigField) {
	field.field_value = null;
	field.stored_in_db = null;
	try {
		await routerSettingsApi.resetField(field.field_name);
		notification.success("Field reset on proxy");
	} catch (error) {
		notification.fromBackend(error);
	}
}
</script>
<template>
	<UiCard appearance="tremor" class="router-general-card"
		><div class="routing-table-scroll">
			<table class="routing-table">
				<thead>
					<tr>
						<th>Setting</th>
						<th>Value</th>
						<th>Status</th>
						<th>Action</th>
					</tr>
				</thead>
				<tbody>
					<tr v-for="field in fields.filter((field) => field.field_type !== 'TypedDictionary')" :key="field.field_name">
						<td>
							<p>{{ field.field_name }}</p>
							<small>{{ field.field_description }}</small>
						</td>
						<td>
							<UiInputNumber
								v-if="field.field_type === 'Integer'"
								:model-value="typeof field.field_value === 'number' ? field.field_value : null"
								:step="1"
								@update:model-value="field.field_value = $event"
							/><UiSwitch
								v-else-if="field.field_type === 'Boolean'"
								appearance="tremor"
								:model-value="field.field_value === true || field.field_value === 'true'"
								:label="field.field_name"
								@update:model-value="field.field_value = $event"
							/><UiSelect
								v-else-if="field.field_type === 'String' && field.field_name === 'websearch_override_target_model'"
								:model-value="field.field_value == null ? null : routerString(field.field_value)"
								:options="candidates"
								:disabled="!candidates.length"
								searchable
								@update:model-value="field.field_value = $event"
							/><UiInput
								v-else-if="field.field_type === 'String'"
								:model-value="routerString(field.field_value)"
								@update:model-value="field.field_value = $event"
							/>
						</td>
						<td>
							<span class="routing-status" :class="{ 'routing-status--db': field.stored_in_db === true }"
								><UiHeroIcon v-if="field.stored_in_db === true" name="CheckCircleIcon" :size="16" />{{
									field.stored_in_db === true ? "In DB" : field.stored_in_db === false ? "In Config" : "Not Set"
								}}</span
							>
						</td>
						<td>
							<div class="routing-field-actions">
								<UiButton appearance="tremor" variant="primary" @click="update(field)">Update</UiButton
								><button type="button" :aria-label="'Reset ' + field.field_name" @click="reset(field)">
									<UiHeroIcon name="TrashIcon" :size="20" />
								</button>
							</div>
						</td>
					</tr>
				</tbody>
			</table></div
	></UiCard>
</template>
