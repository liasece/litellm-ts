<script setup lang="ts">
import { onMounted, ref } from "vue";
import UiTabs from "../../platform/ui/UiTabs.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import RoutingForm from "./RoutingFormComponent.vue";
import RouterGeneral from "./RouterGeneralComponent.vue";
import RouterFallbacks from "./RouterFallbacksComponent.vue";
import { routerSettingsApi } from "../api/RouterSettingsApi";
import { routerRecord, routerString, routerSettingsOnly, type RouterValues } from "../support/RouterSettingsModels";
import { routerPayload } from "../logic/RouterPayloadLogic";
import notification from "../../notifications/logic/NotificationManager";
import "./RouterSettingsStyles.css";
const tab = ref("loadbalancing"),
	values = ref<RouterValues>({}),
	fields = ref<Record<string, unknown>[]>([]),
	descriptions = ref<RouterValues>({}),
	inputs = ref<Record<string, string>>({}),
	strategy = ref<string | null>(null),
	filtering = ref(false);
onMounted(async () => {
	const results = await Promise.allSettled([routerSettingsApi.load(), routerSettingsApi.metadata()]);
	if (results[0].status === "fulfilled") {
		values.value = routerSettingsOnly(results[0].value);
		strategy.value = routerString(values.value.routing_strategy) || null;
	}
	if (results[1].status === "fulfilled") {
		const payload = results[1].value;
		fields.value = Array.isArray(payload.fields) ? payload.fields.map(routerRecord) : [];
		descriptions.value = routerRecord(payload.routing_strategy_descriptions);
		const tag = fields.value.find((field) => field.field_name === "enable_tag_filtering");
		if (tag?.field_value != null) filtering.value = Boolean(tag.field_value);
	}
});
async function save() {
	try {
		await routerSettingsApi.update(routerPayload(values.value, inputs.value, strategy.value, filtering.value));
		notification.success("router settings updated successfully");
	} catch (error) {
		notification.fromBackend("Failed to update router settings: " + String(error));
	}
}
function reset() {
	window.location.reload();
}
</script>
<template>
	<div class="router-settings-page">
		<UiTabs
			v-model="tab"
			appearance="tremor"
			:items="[
				{ key: 'loadbalancing', label: 'Loadbalancing' },
				{ key: 'fallbacks', label: 'Fallbacks' },
				{ key: 'general', label: 'General' },
			]"
			><div class="router-settings-panel">
				<div v-show="tab === 'loadbalancing'">
					<RoutingForm
						v-model:inputs="inputs"
						v-model:strategy="strategy"
						v-model:filtering="filtering"
						:values="values"
						:fields="fields"
						:descriptions="descriptions"
					/>
					<footer class="routing-actions">
						<UiButton appearance="tremor" size="small" @click="reset">Reset</UiButton
						><UiButton appearance="tremor" size="small" variant="primary" @click="save">Save Changes</UiButton>
					</footer>
				</div>
				<RouterFallbacks v-if="tab === 'fallbacks'" /><RouterGeneral v-if="tab === 'general'" /></div
		></UiTabs>
	</div>
</template>
