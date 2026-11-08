<script setup lang="ts">
import { onMounted, ref } from "vue";
import UiTabs from "../../platform/ui/UiTabs.vue";
import LoggingCallbacks from "./LoggingCallbacksComponent.vue";
import CloudZero from "./CloudZeroComponent.vue";
import AlertTypes from "./AlertTypesComponent.vue";
import AlertParameters from "./AlertParametersComponent.vue";
import EmailSettings from "./EmailSettingsComponent.vue";
import { useAuthenticationStore } from "../../identity/stores/AuthenticationStore";
import { loggingSettingsApi, type LoggingCallback, type CallbackConfiguration } from "../api/LoggingSettingsApi";
import notification from "../../notifications/logic/NotificationManager";
import "./LoggingSettingsStyles.css";
const auth = useAuthenticationStore(),
	tab = ref("callbacks"),
	callbacks = ref<LoggingCallback[]>([]),
	alerts = ref<LoggingCallback[]>([]),
	configurations = ref<CallbackConfiguration[]>([]),
	available = ref<Record<string, unknown>>({});
async function reload(initial = false) {
	try {
		const data = await loggingSettingsApi.load();
		callbacks.value = data.callbacks;
		if (initial) {
			alerts.value = data.alerts;
			available.value = data.available_callbacks && !Array.isArray(data.available_callbacks) ? data.available_callbacks : {};
		}
	} catch (error) {
		notification.fromBackend(error);
	}
}
onMounted(() => {
	void reload(true);
	void loggingSettingsApi
		.configurations()
		.then((value) => (configurations.value = value))
		.catch((error) =>
			notification.fromBackend("Failed to load callback configs: " + (error instanceof Error ? error.message : String(error))),
		);
});
</script>
<template>
	<div class="logging-settings-page">
		<div>
			<UiTabs
				v-model="tab"
				appearance="tremor"
				:items="[
					{ key: 'callbacks', label: 'Logging Callbacks' },
					{ key: 'cloudzero', label: 'CloudZero Cost Tracking' },
					{ key: 'types', label: 'Alerting Types' },
					{ key: 'settings', label: 'Alerting Settings' },
					{ key: 'email', label: 'Email Alerts' },
				]"
				><LoggingCallbacks
					v-if="tab === 'callbacks'"
					:callbacks="callbacks"
					:available="available"
					:configurations="configurations"
					@changed="reload()" />
				<div v-else-if="tab === 'cloudzero'" class="logging-cloudzero-wrap"><CloudZero /></div>
				<AlertTypes
					v-else-if="tab === 'types'"
					:alerts="alerts"
					:premium="Boolean(auth.state.session?.premium_user)" /><AlertParameters
					v-else-if="tab === 'settings'"
					:premium="Boolean(auth.state.session?.premium_user)" /><EmailSettings
					v-else
					:alerts="alerts"
					:premium="Boolean(auth.state.session?.premium_user)"
			/></UiTabs>
		</div>
	</div>
</template>
