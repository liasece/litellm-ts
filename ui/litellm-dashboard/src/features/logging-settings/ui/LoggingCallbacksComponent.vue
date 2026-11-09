<script setup lang="ts">
import { ref } from "vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import UiHeroIcon from "../../platform/ui/UiHeroIcon.vue";
import CallbackDialog from "./CallbackDialogComponent.vue";
import { loggingSettingsApi, type LoggingCallback, type AvailableCallbacks } from "../api/LoggingSettingsApi";
import notification from "../../notifications/logic/NotificationManager";
const props = defineProps<{ callbacks: LoggingCallback[]; available: AvailableCallbacks }>();
const emit = defineEmits<{ changed: [] }>();
const editOpen = ref(false),
	addOpen = ref(false),
	selected = ref<LoggingCallback | null>(null);
function display(callback: LoggingCallback) {
	const raw = props.available[callback.name];
	return raw && typeof raw === "object" && "ui_callback_name" in raw ? String(raw.ui_callback_name) : callback.name;
}
function modeLabel(callback: LoggingCallback) {
	return (
		({ success: "Success", failure: "Failure", success_and_failure: "Success & Failure" } as Record<string, string>)[
			callback.mode || "success"
		] || callback.mode
	);
}
async function test(callback: LoggingCallback) {
	try {
		await loggingSettingsApi.test(callback.name);
		notification.success("Health check triggered");
	} catch (error) {
		notification.fromBackend(error);
	}
}
</script>
<template>
	<div class="logging-callbacks">
		<UiButton v-if="Object.keys(available).length" appearance="tremor" variant="primary" @click="addOpen = true"
			>+ Add Callback</UiButton
		>
		<div class="logging-callbacks-heading"><h4>Active Logging Callbacks</h4></div>
		<div v-if="!callbacks.length" class="logging-callbacks-empty">
			<h3>No callbacks configured</h3>
			<p>Add your first callback to start logging data to external services.</p>
		</div>
		<div v-else class="logging-callbacks-table">
			<table>
				<thead>
					<tr>
						<th>Callback Name</th>
						<th>Mode</th>
						<th>Actions</th>
					</tr>
				</thead>
				<tbody>
					<tr v-for="callback in callbacks" :key="callback.name">
						<td>{{ display(callback) }}</td>
						<td>
							<span
								class="logging-callback-mode"
								:class="
									callback.mode === 'failure'
										? 'logging-callback-mode--failure'
										: !callback.mode || callback.mode === 'success'
											? 'logging-callback-mode--success'
											: 'logging-callback-mode--other'
								"
								>{{ modeLabel(callback) }}</span
							>
						</td>
						<td>
							<div>
								<UiTooltip title="Test Callback"
									><button type="button" aria-label="Test Callback" @click="test(callback)">
										<UiHeroIcon name="PlayIcon" /></button></UiTooltip
								><UiTooltip title="Edit Callback"
									><button
										type="button"
										aria-label="Edit Callback"
										@click="
											selected = callback;
											editOpen = true;
										"
									>
										<UiHeroIcon name="PencilAltIcon" /></button
								></UiTooltip>
							</div>
						</td>
					</tr>
				</tbody>
			</table>
		</div>
		<CallbackDialog v-model:open="addOpen" :available="available" @changed="emit('changed')" /><CallbackDialog
			v-model:open="editOpen"
			:callback="selected"
			:available="available"
			@changed="emit('changed')"
		/>
	</div>
</template>
