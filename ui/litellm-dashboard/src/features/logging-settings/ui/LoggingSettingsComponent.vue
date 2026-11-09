<script setup lang="ts">
import { onMounted, ref } from "vue";
import UiTabs from "../../platform/ui/UiTabs.vue";
import LoggingCallbacks from "./LoggingCallbacksComponent.vue";
import EmailSettings from "./EmailSettingsComponent.vue";
import { useAuthenticationStore } from "../../identity/stores/AuthenticationStore";
import { loggingSettingsApi, type LoggingCallback, type AvailableCallbacks } from "../api/LoggingSettingsApi";
import notification from "../../notifications/logic/NotificationManager";
import "./LoggingSettingsStyles.css";
const auth = useAuthenticationStore(),
	tab = ref("callbacks"),
	callbacks = ref<LoggingCallback[]>([]),
	alerts = ref<LoggingCallback[]>([]),
	available = ref<AvailableCallbacks>({});
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
onMounted(() => void reload(true));
</script>
<template>
	<div class="logging-settings-page">
		<div>
			<UiTabs
				v-model="tab"
				appearance="tremor"
				:items="[
					{ key: 'callbacks', label: 'Logging Callbacks' },
					{ key: 'email', label: 'Email Alerts' },
				]"
				><LoggingCallbacks
					v-if="tab === 'callbacks'"
					:callbacks="callbacks"
					:available="available"
					@changed="reload()" /><EmailSettings v-else :alerts="alerts" :premium="Boolean(auth.state.session?.premium_user)"
			/></UiTabs>
		</div>
	</div>
</template>
