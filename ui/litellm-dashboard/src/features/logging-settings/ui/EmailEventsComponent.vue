<script setup lang="ts">
import { onMounted, ref } from "vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiCheckbox from "../../platform/ui/UiCheckbox.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiSpinner from "../../platform/ui/UiSpinner.vue";
import { loggingSettingsApi, type EmailEventSetting } from "../api/LoggingSettingsApi";
import { emailEventDescription } from "../logic/LoggingPayloadLogic";
import notification from "../../notifications/logic/NotificationManager";
const settings = ref<EmailEventSetting[]>([]),
	loading = ref(true);
async function load() {
	loading.value = true;
	try {
		settings.value = await loggingSettingsApi.emailEvents();
	} catch (error) {
		notification.fromBackend(error);
	} finally {
		loading.value = false;
	}
}
onMounted(load);
async function save() {
	try {
		await loggingSettingsApi.saveEmailEvents(settings.value);
		notification.success("Email event settings updated successfully");
	} catch (error) {
		notification.fromBackend(error);
	}
}
async function reset() {
	try {
		await loggingSettingsApi.resetEmailEvents();
		notification.success("Email event settings reset to defaults");
		await load();
	} catch (error) {
		notification.fromBackend(error);
	}
}
</script>
<template>
	<UiCard appearance="tremor" class="logging-email-events"
		><h4>Email Notifications</h4>
		<p>Select which events should trigger email notifications.</p>
		<hr />
		<div v-if="loading" class="logging-email-loading"><UiSpinner :size="32" /></div>
		<div v-else class="logging-email-event-list">
			<div v-for="setting in settings" :key="setting.event">
				<UiCheckbox v-model="setting.enabled" :label="setting.event" />
				<div>
					<p>{{ setting.event }}</p>
					<small>{{ emailEventDescription(setting.event) }}</small>
				</div>
			</div>
		</div>
		<footer>
			<UiButton appearance="tremor" variant="primary" :disabled="loading" @click="save">Save Changes</UiButton
			><UiButton appearance="tremor" :disabled="loading" @click="reset">Reset to Defaults</UiButton>
		</footer></UiCard
	>
</template>
