<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiHeroIcon from "../../platform/ui/UiHeroIcon.vue";
import UiLucideIcon from "../../platform/ui/UiLucideIcon.vue";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import UiDialog from "../../platform/ui/UiDialog.vue";
import PassThroughCreateDialog from "./PassThroughCreateDialogComponent.vue";
import PassThroughDetails from "./PassThroughDetailsComponent.vue";
import { listPassThrough, deletePassThrough } from "../api/PassThroughApi";
import type { PassThroughEndpoint } from "../support/PassThroughModels";
import type { ModelCatalog } from "../support/ModelModels";
import notification from "../../notifications/logic/NotificationManager";
defineProps<{ catalog: ModelCatalog; admin: boolean; premium: boolean }>();
const endpoints = ref<PassThroughEndpoint[]>([]),
	selected = ref<PassThroughEndpoint | null>(null),
	createOpen = ref(false),
	toDelete = ref<string | null>(null),
	shown = ref<string[]>([]),
	pending = ref(false);
let disposed = false;
async function load() {
	try {
		const value = await listPassThrough();
		if (!disposed) endpoints.value = value;
	} catch (error) {
		notification.fromBackend(error instanceof Error ? error.message : "Failed to load pass-through endpoints");
	}
}
function show(id: string) {
	shown.value = shown.value.includes(id) ? shown.value.filter((value) => value !== id) : [...shown.value, id];
}
function created(endpoint: PassThroughEndpoint) {
	endpoints.value = [...endpoints.value, endpoint];
}
async function remove() {
	if (!toDelete.value) return;
	pending.value = true;
	try {
		await deletePassThrough(toDelete.value);
		endpoints.value = endpoints.value.filter((endpoint) => endpoint.id !== toDelete.value);
		notification.success("Endpoint deleted successfully.");
	} catch (error) {
		notification.fromBackend("Error deleting the endpoint: " + (error instanceof Error ? error.message : String(error)));
	} finally {
		toDelete.value = null;
		pending.value = false;
	}
}
onMounted(() => void load());
onBeforeUnmount(() => (disposed = true));
defineExpose({ load });
</script>
<template>
	<PassThroughDetails
		v-if="selected"
		:endpoint="selected"
		:catalog="catalog"
		:admin="admin"
		:premium="premium"
		@close="selected = null"
		@changed="load"
	/>
	<section v-else class="model-pass-endpoints">
		<h3 class="model-title">Pass Through Endpoints</h3>
		<p class="model-text">Configure and manage your pass-through endpoints</p>
		<UiButton class="model-pass-add-button" appearance="tremor" variant="primary" @click="createOpen = true"
			>+ Add Pass-Through Endpoint</UiButton
		>
		<div class="model-pass-table model-table-overflow">
			<table class="model-simple-table">
				<thead>
					<tr>
						<th>ID</th>
						<th>Path</th>
						<th>Target</th>
						<th>
							<div class="model-pass-column-heading">
								<span>Methods</span>
								<UiTooltip title="HTTP methods supported by this endpoint"
									><UiHeroIcon name="InformationCircleIcon" :size="16"
								/></UiTooltip>
							</div>
						</th>
						<th>
							<div class="model-pass-column-heading">
								<span>Authentication</span>
								<UiTooltip title="LiteLLM Virtual Key required to call endpoint"
									><UiHeroIcon name="InformationCircleIcon" :size="16"
								/></UiTooltip>
							</div>
						</th>
						<th>Headers</th>
						<th>Actions</th>
					</tr>
				</thead>
				<tbody>
					<tr v-for="(endpoint, index) in endpoints" :key="endpoint.id ?? index">
						<td>
							<div class="model-pass-id">
								<UiTooltip :title="endpoint.id"
									><button class="model-id model-mono" @click="selected = endpoint">{{ endpoint.id }}</button></UiTooltip
								>
							</div>
						</td>
						<td>{{ endpoint.path }}</td>
						<td>
							<p class="model-text">{{ endpoint.target }}</p>
						</td>
						<td>
							<span v-if="!endpoint.methods?.length" class="model-pass-badge">ALL</span>
							<div v-else class="model-pass-methods">
								<span v-for="method in endpoint.methods" :key="method" class="model-pass-badge model-pass-method">{{
									method
								}}</span>
							</div>
						</td>
						<td>
							<span class="model-pass-badge">{{ endpoint.auth ? "Yes" : "No" }}</span>
						</td>
						<td>
							<div class="model-inline model-pass-header-cell">
								<span class="model-mono">{{
									shown.includes(endpoint.id ?? String(index)) ? JSON.stringify(endpoint.headers ?? {}) : "••••••••"
								}}</span
								><button
									class="model-icon-button"
									:aria-label="'Toggle headers ' + (endpoint.id ?? index)"
									@click="show(endpoint.id ?? String(index))"
								>
									<UiLucideIcon :name="shown.includes(endpoint.id ?? String(index)) ? 'EyeOff' : 'Eye'" :size="16" />
								</button>
							</div>
						</td>
						<td>
							<div class="model-pass-actions">
								<button
									class="model-icon-button model-pass-action"
									title="Edit"
									:aria-label="'Edit endpoint ' + endpoint.path"
									@click="selected = endpoint"
								>
									<UiHeroIcon name="PencilAltIcon" :size="20" /></button
								><button
									class="model-icon-button model-pass-action"
									title="Delete"
									:aria-label="'Delete endpoint ' + endpoint.path"
									@click="toDelete = endpoint.id ?? null"
								>
									<UiHeroIcon name="TrashIcon" :size="20" />
								</button>
							</div>
						</td>
					</tr>
					<tr v-if="!endpoints.length">
						<td colspan="7" class="model-table-empty">No pass-through endpoints configured</td>
					</tr>
				</tbody>
			</table>
		</div>
	</section>
	<PassThroughCreateDialog v-model:open="createOpen" :catalog="catalog" :premium="premium" @created="created" />
	<UiDialog
		:open="!!toDelete"
		title="Delete Pass-Through Endpoint"
		centered
		scroll-mode="overlay"
		class="model-pass-delete"
		:show-footer="false"
		@update:open="!$event && (toDelete = null)"
		><p>Are you sure you want to delete this pass-through endpoint? This action cannot be undone.</p>
		<div class="model-pass-delete-footer">
			<UiButton appearance="tremor" variant="primary" @click="toDelete = null">Cancel</UiButton
			><UiButton appearance="tremor" variant="primary" danger :loading="pending" @click="remove">Delete</UiButton>
		</div></UiDialog
	>
</template>
