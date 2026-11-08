<script setup lang="ts">
import { onMounted, ref } from "vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiEmptyState from "../../platform/ui/UiEmptyState.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiTag from "../../platform/ui/UiTag.vue";
import UiLucideIcon from "../../platform/ui/UiLucideIcon.vue";
import UiPopover from "../../platform/ui/UiPopover.vue";
import UiAlert from "../../platform/ui/UiAlert.vue";
import DeleteResourceDialog from "../../resource-dialogs/ui/DeleteResourceDialogComponent.vue";
import CloudZeroDialog from "./CloudZeroDialogComponent.vue";
import { cloudZeroApi, type CloudZeroSettings } from "../api/CloudZeroApi";
import message from "../../notifications/logic/MessageManager";
const settings = ref<CloudZeroSettings | null>(null),
	loading = ref(true),
	error = ref(""),
	editOpen = ref(false),
	createOpen = ref(false),
	deleteOpen = ref(false),
	dryRunPending = ref(false),
	exportPending = ref(false),
	deletePending = ref(false),
	result = ref<string | null>(null),
	confirmation = ref<InstanceType<typeof UiPopover>>();
async function load() {
	loading.value = true;
	try {
		settings.value = await cloudZeroApi.load();
		error.value = "";
	} catch (value) {
		error.value = value instanceof Error ? value.message : String(value);
	} finally {
		loading.value = false;
	}
}
onMounted(load);
async function dryRun() {
	dryRunPending.value = true;
	try {
		result.value = JSON.stringify(await cloudZeroApi.dryRun(), null, 2);
		message.success("Dry run completed successfully");
	} catch (error) {
		message.error(error instanceof Error ? error.message : "Failed to perform dry run");
	} finally {
		dryRunPending.value = false;
	}
}
async function push() {
	exportPending.value = true;
	confirmation.value?.hide();
	try {
		await cloudZeroApi.export();
		message.success("Data successfully exported to CloudZero");
	} catch (error) {
		message.error(error instanceof Error ? error.message : "Failed to export data");
	} finally {
		exportPending.value = false;
	}
}
async function remove() {
	deletePending.value = true;
	try {
		await cloudZeroApi.remove();
		message.success("CloudZero integration deleted successfully");
		deleteOpen.value = false;
		await load();
	} catch (error) {
		message.error(error instanceof Error ? error.message : "Failed to delete CloudZero integration");
	} finally {
		deletePending.value = false;
	}
}
</script>
<template>
	<div class="logging-cloudzero">
		<UiCard v-if="loading" appearance="antd">Loading CloudZero settings...</UiCard
		><UiCard v-else-if="error" appearance="antd"
			><span class="logging-error">Error loading CloudZero settings: {{ error }}</span></UiCard
		>
		<div v-else-if="!settings" class="logging-cloudzero-empty">
			<UiEmptyState description=""
				><h4>No CloudZero Integration Found</h4>
				<p>Connect your CloudZero account to start tracking and analyzing your cloud costs directly from LiteLLM.</p></UiEmptyState
			><UiButton variant="primary" size="large" @click="createOpen = true">Add CloudZero Integration</UiButton>
		</div>
		<div v-else class="logging-cloudzero-content">
			<UiCard appearance="antd"
				><template #title
					><span class="logging-cloudzero-heading"
						>CloudZero Configuration <UiTag color="success">{{ settings.status || "Active" }}</UiTag></span
					></template
				><template #extra
					><div class="logging-cloudzero-controls">
						<UiButton @click="editOpen = true"
							><template #icon><UiLucideIcon name="Edit" :size="16" /></template>Edit</UiButton
						><UiButton danger @click="deleteOpen = true"
							><template #icon><UiLucideIcon name="Trash2" :size="16" /></template>Delete</UiButton
						>
					</div></template
				>
				<div class="logging-cloudzero-description">
					<table>
						<tbody>
							<tr
								v-for="field in [
									{ name: 'api_key_masked', label: 'API Key (Redacted)' },
									{ name: 'connection_id', label: 'Connection ID' },
									{ name: 'timezone', label: 'Timezone' },
								]"
								:key="field.name"
							>
								<th scope="row">{{ field.label }}</th>
								<td>
									<span v-if="settings[field.name]" :class="{ 'logging-mono': field.name !== 'timezone' }">{{
										settings[field.name]
									}}</span
									><em v-else :class="{ 'logging-mono': field.name !== 'timezone' }">{{
										field.name === "timezone" ? "Default (UTC)" : "Not configured"
									}}</em>
								</td>
							</tr>
						</tbody>
					</table>
				</div>
				<div class="logging-cloudzero-divider"><span>Actions</span></div>
				<div class="logging-cloudzero-actions">
					<UiButton :loading="dryRunPending" @click="dryRun"
						><template #icon><UiLucideIcon name="Play" :size="16" /></template>Run Dry Run Simulation</UiButton
					><UiPopover ref="confirmation" trigger="click" placement="top"
						><UiButton variant="primary" :loading="exportPending"
							><template #icon><UiLucideIcon name="Upload" :size="16" /></template>Export Data Now</UiButton
						><template #content
							><div class="logging-cloudzero-export">
								<strong>Export Data to CloudZero</strong>
								<p>This will push the current accumulated cost data to CloudZero. Continue?</p>
								<footer>
									<UiButton size="small" @click="confirmation?.hide()">Cancel</UiButton
									><UiButton size="small" variant="primary" @click="push">Export</UiButton>
								</footer>
							</div></template
						></UiPopover
					>
				</div>
				<UiAlert v-if="result" title="Dry Run Results" type="info" class="logging-cloudzero-results"
					><template #icon><UiLucideIcon name="CheckCircle" :size="24" /></template>
					<div>
						<p>Simulation output for connection: {{ settings.connection_id }}</p>
						<pre>{{ result }}</pre>
					</div></UiAlert
				></UiCard
			>
		</div>
		<CloudZeroDialog v-model:open="createOpen" @changed="load" /><CloudZeroDialog
			v-model:open="editOpen"
			:settings="settings"
			@changed="load"
		/><DeleteResourceDialog
			v-model:open="deleteOpen"
			title="Delete CloudZero Integration?"
			message="Are you sure you want to delete this CloudZero integration? All associated settings and configurations will be permanently removed."
			information-title="Integration Details"
			:information="[
				{ label: 'Connection ID', value: settings?.connection_id, code: true },
				{ label: 'Timezone', value: settings?.timezone || 'Default (UTC)' },
			]"
			:pending="deletePending"
			@confirm="remove"
		/>
	</div>
</template>
