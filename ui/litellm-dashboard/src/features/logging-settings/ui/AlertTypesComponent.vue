<script setup lang="ts">
import { onMounted, ref } from "vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiSwitch from "../../platform/ui/UiSwitch.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import { loggingSettingsApi, type LoggingCallback } from "../api/LoggingSettingsApi";
import { alertNames } from "../logic/LoggingPayloadLogic";
import notification from "../../notifications/logic/NotificationManager";
const props = defineProps<{ alerts: LoggingCallback[]; premium: boolean }>();
const active = ref<string[]>([]),
	urls = ref<Record<string, string>>({});
onMounted(() => {
	const first = props.alerts[0];
	const fallback = first?.variables.SLACK_WEBHOOK_URL;
	active.value = Array.isArray(first?.active_alerts)
		? first.active_alerts.filter((value): value is string => typeof value === "string")
		: [];
	const raw = first?.alerts_to_webhook,
		entries = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
	urls.value = Object.fromEntries(Object.keys(alertNames).map((name) => [name, String(entries[name] || fallback || "")]));
});
function toggle(name: string, enabled: boolean) {
	active.value = enabled ? [...active.value, name] : active.value.filter((value) => value !== name);
}
async function save() {
	try {
		await loggingSettingsApi.update({ general_settings: { alert_to_webhook_url: { ...urls.value }, alert_types: [...active.value] } });
	} catch (error) {
		notification.fromBackend(error);
	}
	notification.success("Alerts updated successfully");
}
async function test() {
	try {
		await loggingSettingsApi.test("slack");
		notification.success("Alert test triggered. Test request to slack made - check logs/alerts on slack to verify");
	} catch (error) {
		notification.fromBackend(error);
	}
}
</script>
<template>
	<UiCard appearance="tremor" class="logging-alert-types"
		><p class="logging-alert-description">
			Alerts are only supported for Slack Webhook URLs. Get your webhook urls from
			<a href="https://api.slack.com/messaging/webhooks" target="_blank" rel="noreferrer">here</a>
		</p>
		<div class="logging-alert-table-scroll">
			<table class="logging-tremor-table">
				<thead>
					<tr>
						<th />
						<th />
						<th>Slack Webhook URL</th>
					</tr>
				</thead>
				<tbody>
					<tr v-for="(label, name) in alertNames" :key="name">
						<td>
							<UiButton v-if="name === 'region_outage_alerts' && !premium" appearance="tremor" variant="primary"
								><a href="https://forms.gle/W3U4PZpJGFHWtHyA9" target="_blank" rel="noreferrer"
									>✨ Enterprise Feature</a
								></UiButton
							><UiSwitch
								v-else
								:model-value="active.includes(name)"
								appearance="tremor"
								:label="label"
								@update:model-value="toggle(name, $event)"
							/>
						</td>
						<td>
							<p class="logging-alert-name">{{ label }}</p>
						</td>
						<td><UiInput v-model="urls[name]" :name="name" appearance="tremor" type="password" /></td>
					</tr>
				</tbody>
			</table>
		</div>
		<div class="logging-alert-actions">
			<UiButton appearance="tremor" variant="primary" size="small" @click="save">Save Changes</UiButton
			><UiButton appearance="tremor" variant="primary" @click="test">Test Alerts</UiButton>
		</div></UiCard
	>
</template>
