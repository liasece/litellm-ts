<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import EmailEvents from "./EmailEventsComponent.vue";
import { loggingSettingsApi, type LoggingCallback } from "../api/LoggingSettingsApi";
import { emailServerPayload } from "../logic/LoggingPayloadLogic";
import { emailDescriptions } from "../data/EmailFieldDescriptionsData";
import notification from "../../notifications/logic/NotificationManager";
const props = defineProps<{ alerts: LoggingCallback[]; premium: boolean }>();
const alerts = computed(() => props.alerts.filter((alert) => alert.name === "email")),
	values = ref<Record<string, string>>({});
onMounted(() => {
	values.value = Object.assign(
		{},
		...alerts.value.map((alert) =>
			Object.fromEntries(Object.entries(alert.variables).map(([name, value]) => [name, value == null ? "" : String(value)])),
		),
	);
});
function limited(name: string) {
	return !props.premium && ["EMAIL_LOGO_URL", "EMAIL_SUPPORT_CONTACT"].includes(name);
}
async function save() {
	try {
		await loggingSettingsApi.update(emailServerPayload(props.alerts, values.value));
		notification.success("Email settings updated successfully");
	} catch (error) {
		notification.fromBackend(error);
	}
}
async function test() {
	try {
		await loggingSettingsApi.test("email");
		notification.success("Email test triggered. Check your configured email inbox/logs.");
	} catch (error) {
		notification.fromBackend(error);
	}
}
</script>
<template>
	<div class="logging-email-settings">
		<div class="logging-email-events-wrap"><EmailEvents /></div>
		<UiCard appearance="tremor" class="logging-email-server-card"
			><h4>Email Server Settings</h4>
			<p>
				<a href="https://docs.litellm.ai/docs/proxy/email" target="_blank" rel="noreferrer">{{ " " }}LiteLLM Docs: email alerts</a
				>{{ " " }}<br />
			</p>
			<div class="logging-email-servers">
				<div v-for="(alert, index) in alerts" :key="index" class="logging-email-server">
					<div v-for="(_, name) in alert.variables" :key="name" class="logging-email-field">
						<a v-if="limited(name)" href="https://forms.gle/W3U4PZpJGFHWtHyA9" target="_blank" rel="noreferrer"
							><span>✨ {{ name }}</span></a
						><span v-else>{{ name }}</span
						><UiInput v-model="values[name]" :name="name" type="password" appearance="tremor" :disabled="limited(name)" />
						<p>
							{{ emailDescriptions[name]
							}}<strong v-if="!['EMAIL_LOGO_URL', 'EMAIL_SUPPORT_CONTACT'].includes(name)"> Required * </strong>
						</p>
					</div>
				</div>
			</div>
			<div class="logging-email-server-actions">
				<UiButton appearance="tremor" variant="primary" @click="save">Save Changes</UiButton
				><UiButton appearance="tremor" variant="primary" @click="test">Test Email Alerts</UiButton>
			</div></UiCard
		>
	</div>
</template>
