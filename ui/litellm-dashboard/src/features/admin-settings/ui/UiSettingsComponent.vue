<script setup lang="ts">
import { onMounted, ref } from "vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiSwitch from "../../platform/ui/UiSwitch.vue";
import UiAlert from "../../platform/ui/UiAlert.vue";
import PageVisibility from "./PageVisibilityComponent.vue";
import { adminSettingsApi, type UiSettingsResponse } from "../api/AdminSettingsApi";
import { uiSettingFields } from "../data/UiSettingFieldsData";
import { useApplicationStore } from "../../application/stores/ApplicationStore";
import notification from "../../notifications/logic/NotificationManager";
const application = useApplicationStore(),
	data = ref<UiSettingsResponse>({ values: {} }),
	loading = ref(true),
	pending = ref(false),
	error = ref(""),
	updateError = ref("");
async function load() {
	try {
		data.value = await adminSettingsApi.load();
		application.state.settings = { ...application.state.settings, ...data.value.values };
	} catch (value) {
		error.value = value instanceof Error ? value.message : String(value);
	} finally {
		loading.value = false;
	}
}
onMounted(load);
function description(name: string) {
	const value = data.value.field_schema?.properties?.[name]?.description;
	return typeof value === "string" ? value : "";
}
function pages() {
	const value = data.value.values.enabled_ui_pages_internal_users;
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : null;
}
async function update(values: Record<string, unknown>) {
	pending.value = true;
	updateError.value = "";
	try {
		await adminSettingsApi.update(values);
		await load();
		const projects = "enable_projects_ui" in values;
		notification.success(
			projects
				? "UI settings updated successfully. Refreshing page..."
				: "enabled_ui_pages_internal_users" in values
					? "Page visibility settings updated successfully"
					: "UI settings updated successfully",
		);
		if (projects) setTimeout(() => window.location.reload(), 1000);
	} catch (value) {
		updateError.value = value instanceof Error ? value.message : String(value);
		notification.fromBackend(value);
	} finally {
		pending.value = false;
	}
}
</script>
<template>
	<UiCard title="UI Settings" appearance="antd" class="admin-ui-settings">
		<div v-if="loading" class="admin-skeleton" aria-label="Loading UI settings"><span /><span /><span /><span /></div>
		<UiAlert v-else-if="error" type="error" title="Could not load UI settings" :show-icon="false">{{ error }}</UiAlert>
		<div v-else class="admin-ui-settings-fields">
			<p v-if="data.field_schema?.description">{{ data.field_schema.description }}</p>
			<UiAlert v-if="updateError" type="error" title="Could not update UI settings" :show-icon="false">{{ updateError }}</UiAlert>
			<template v-for="field in uiSettingFields" :key="field.name">
				<hr v-if="'divider' in field && field.divider" />
				<div class="admin-toggle-row" :class="{ 'admin-toggle-row--indented': 'parent' in field }">
					<UiSwitch
						:model-value="Boolean(data.values[field.name])"
						:disabled="pending || ('parent' in field && !data.values[field.parent])"
						:loading="pending"
						:label="description(field.name) || ('ariaLabel' in field ? field.ariaLabel : field.label)"
						@update:model-value="update({ [field.name]: $event })"
					/>
					<div>
						<strong :class="{ 'admin-secondary': 'parent' in field && !data.values[field.parent] }">{{ field.label }}</strong>
						<p v-if="description(field.name) || ('description' in field && field.description)" class="admin-secondary">
							{{ description(field.name) || ("description" in field ? field.description : "") }}
						</p>
					</div>
				</div>
			</template>
			<hr />
			<PageVisibility
				:value="pages()"
				:description="description('enabled_ui_pages_internal_users')"
				:pending="pending"
				@update="update({ enabled_ui_pages_internal_users: $event })"
			/>
		</div>
	</UiCard>
</template>
