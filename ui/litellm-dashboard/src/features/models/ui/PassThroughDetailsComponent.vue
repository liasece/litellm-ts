<script setup lang="ts">
import { ref } from "vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiInputNumber from "../../platform/ui/UiInputNumber.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import UiSwitch from "../../platform/ui/UiSwitch.vue";
import UiTabs from "../../platform/ui/UiTabs.vue";
import UiLucideIcon from "../../platform/ui/UiLucideIcon.vue";
import ModelField from "./ModelFormFieldComponent.vue";
import PassThroughPreview from "./PassThroughPreviewComponent.vue";
import PassThroughSecurity from "./PassThroughSecurityComponent.vue";
import PassThroughGuardrails from "./PassThroughGuardrailsComponent.vue";
import { createPassThroughDraft, passThroughPayload, HTTP_METHODS, type PassThroughEndpoint } from "../support/PassThroughModels";
import { modelOptions, type ModelCatalog } from "../support/ModelModels";
import { updatePassThrough, deletePassThrough } from "../api/PassThroughApi";
import { usePriceDisplayStore } from "../../platform/stores/PriceDisplayStore";
import notification from "../../notifications/logic/NotificationManager";
const headersPlaceholder = '{"Authorization": "Bearer your-token", "Content-Type": "application/json"}';
const props = defineProps<{ endpoint: PassThroughEndpoint; catalog: ModelCatalog; admin: boolean; premium: boolean }>();
const emit = defineEmits<{ close: []; changed: [] }>();
const endpoint = ref({ ...props.endpoint }),
	draft = ref(createPassThroughDraft(props.endpoint)),
	editing = ref(false),
	tab = ref("overview"),
	showHeaders = ref(false),
	pending = ref(false),
	targetError = ref("");
const price = usePriceDisplayStore();
async function save() {
	if (!draft.value.target) {
		targetError.value = "Please input a target URL";
		return;
	}
	pending.value = true;
	try {
		if (!endpoint.value.id) return;
		const payload = passThroughPayload(draft.value, props.premium, true);
		await updatePassThrough(endpoint.value.id, payload);
		endpoint.value = { ...endpoint.value, ...payload } as PassThroughEndpoint;
		editing.value = false;
		notification.success("Pass through endpoint updated successfully");
		emit("changed");
	} catch (error) {
		notification.fromBackend(
			error instanceof Error && error.message === "Invalid JSON format for headers"
				? error.message
				: "Failed to update pass through endpoint",
		);
	} finally {
		pending.value = false;
	}
}
async function remove() {
	if (!endpoint.value.id) return;
	pending.value = true;
	try {
		await deletePassThrough(endpoint.value.id);
		notification.success("Pass through endpoint deleted successfully");
		emit("changed");
		emit("close");
	} catch {
		notification.fromBackend("Failed to delete pass through endpoint");
	} finally {
		pending.value = false;
	}
}
</script>
<template>
	<section class="model-pass-details">
		<header>
			<UiButton @click="emit('close')">← Back</UiButton>
			<h3 class="model-title">Pass Through Endpoint: {{ endpoint.path }}</h3>
			<p class="model-text model-mono">{{ endpoint.id }}</p>
		</header>
		<UiTabs
			v-model="tab"
			appearance="tremor"
			:items="[{ key: 'overview', label: 'Overview' }, ...(admin ? [{ key: 'settings', label: 'Settings' }] : [])]"
			><template v-if="tab === 'overview'"
				><div class="model-pass-overview-grid">
					<UiCard
						><p class="model-text">Path</p>
						<h3 class="model-title model-mono">{{ endpoint.path }}</h3></UiCard
					><UiCard
						><p class="model-text">Target</p>
						<h3 class="model-title">{{ endpoint.target }}</h3></UiCard
					><UiCard
						><p class="model-text">Configuration</p>
						<div class="model-pass-overview-config">
							<p>
								<span class="model-badge" :class="endpoint.include_subpath ? 'model-badge--green' : 'model-badge--gray'">{{
									endpoint.include_subpath ? "Include Subpath" : "Exact Path"
								}}</span>
							</p>
							<p>
								<span class="model-badge" :class="endpoint.auth ? 'model-badge--blue' : 'model-badge--gray'">{{
									endpoint.auth ? "Auth Required" : "No Auth"
								}}</span>
							</p>
							<div v-if="endpoint.methods?.length">
								<p class="model-small model-text">HTTP Methods:</p>
								<div class="model-inline model-pass-methods">
									<span v-for="method in endpoint.methods" :key="method" class="model-badge model-badge--indigo">{{
										method
									}}</span>
								</div>
							</div>
							<p v-else class="model-small model-muted">All HTTP methods supported</p>
							<p v-if="endpoint.cost_per_request !== undefined" class="model-text">
								Cost per request: {{ price.format(endpoint.cost_per_request, 4) }}
							</p>
						</div></UiCard
					>
				</div>
				<PassThroughPreview
					:path="endpoint.path"
					:target="endpoint.target"
					:include-subpath="endpoint.include_subpath || false"
				/><UiCard v-if="Object.keys(endpoint.headers ?? {}).length" class="model-pass-headers-summary"
					><div class="model-inline model-between">
						<strong class="model-text">Headers</strong
						><span class="model-badge model-badge--blue">{{ Object.keys(endpoint.headers).length }} headers configured</span>
					</div>
					<div class="model-pass-secret">
						<pre>{{ showHeaders ? JSON.stringify(endpoint.headers, null, 2) : "••••••••" }}</pre>
						<button
							type="button"
							class="model-icon-button"
							:aria-label="showHeaders ? 'Hide headers' : 'Show headers'"
							@click="showHeaders = !showHeaders"
						>
							<UiLucideIcon :name="showHeaders ? 'EyeOff' : 'Eye'" :size="16" />
						</button></div></UiCard
				><UiCard v-if="Object.keys(endpoint.guardrails ?? {}).length" class="model-pass-guardrails-summary"
					><div class="model-inline model-between">
						<strong class="model-text">Guardrails</strong
						><span class="model-badge model-badge--purple"
							>{{ Object.keys(endpoint.guardrails ?? {}).length }} guardrails configured</span
						>
					</div>
					<div v-for="(settings, name) in endpoint.guardrails" :key="name" class="model-pass-guardrail-summary">
						<strong>{{ name }}</strong
						><template v-if="settings"
							><p v-if="settings.request_fields">Request fields: {{ settings.request_fields.join(", ") }}</p>
							<p v-if="settings.response_fields">Response fields: {{ settings.response_fields.join(", ") }}</p></template
						>
						<p v-else>Uses entire payload</p>
					</div></UiCard
				></template
			>
			<UiCard v-else
				><header class="model-inline model-between model-pass-settings-heading">
					<h3 class="model-title">Pass Through Endpoint Settings</h3>
					<div v-if="!editing" class="model-inline">
						<UiButton appearance="tremor" variant="primary" @click="editing = true">Edit Settings</UiButton
						><UiButton appearance="tremor" danger :loading="pending" @click="remove">Delete Endpoint</UiButton>
					</div>
				</header>
				<form v-if="editing" @submit.prevent="save">
					<ModelField label="Target URL" vertical required :error="targetError"
						><UiInput v-model="draft.target" appearance="tremor" placeholder="https://api.example.com" /></ModelField
					><ModelField label="Headers (JSON)" vertical
						><UiInput v-model="draft.headersText" multiline :rows="5" :placeholder="headersPlaceholder" /></ModelField
					><ModelField
						label="HTTP Methods (Optional)"
						vertical
						:help="
							draft.methods?.length
								? 'Only ' + draft.methods.join(', ') + ' requests will be routed to this endpoint'
								: 'All HTTP methods supported (default)'
						"
						><UiSelect
							v-model="draft.methods"
							:options="modelOptions(HTTP_METHODS)"
							multiple
							clearable
							placeholder="Select methods (leave empty for all)" /></ModelField
					><ModelField label="Include Subpath" vertical><UiSwitch v-model="draft.include_subpath" /></ModelField
					><ModelField label="Cost per Request" vertical
						><div class="model-number-addon model-number-addon--before">
							<span>$</span
							><UiInputNumber
								v-model="draft.cost_per_request"
								:min="0"
								:step="0.01"
								:precision="2"
								placeholder="0.00"
							/></div></ModelField
					><PassThroughSecurity v-model="draft.auth" :premium="premium" /><PassThroughGuardrails
						v-model="draft.guardrails"
						:catalog="catalog"
					/>
					<div class="model-pass-edit-footer">
						<UiButton @click="editing = false">Cancel</UiButton
						><UiButton appearance="tremor" variant="primary" :loading="pending" @click="save">Save Changes</UiButton>
					</div>
				</form>
				<div v-else class="model-pass-settings-summary">
					<div>
						<p class="model-text">Path</p>
						<code>{{ endpoint.path }}</code>
					</div>
					<div>
						<p class="model-text">Target URL</p>
						<p>{{ endpoint.target }}</p>
					</div>
					<div>
						<p class="model-text">Include Subpath</p>
						<span class="model-badge" :class="endpoint.include_subpath ? 'model-badge--green' : 'model-badge--gray'">{{
							endpoint.include_subpath ? "Yes" : "No"
						}}</span>
					</div>
					<div v-if="endpoint.cost_per_request !== undefined">
						<p class="model-text">Cost per Request</p>
						<p>{{ price.format(endpoint.cost_per_request, 4) }}</p>
					</div>
					<div>
						<p class="model-text">Authentication Required</p>
						<span class="model-badge" :class="endpoint.auth ? 'model-badge--green' : 'model-badge--gray'">{{
							endpoint.auth ? "Yes" : "No"
						}}</span>
					</div>
					<div>
						<p class="model-text">Headers</p>
						<div v-if="Object.keys(endpoint.headers ?? {}).length" class="model-pass-secret">
							<pre>{{ showHeaders ? JSON.stringify(endpoint.headers, null, 2) : "••••••••" }}</pre>
							<button
								type="button"
								class="model-icon-button"
								:aria-label="showHeaders ? 'Hide headers' : 'Show headers'"
								@click="showHeaders = !showHeaders"
							>
								<UiLucideIcon :name="showHeaders ? 'EyeOff' : 'Eye'" :size="16" />
							</button>
						</div>
						<p v-else class="model-muted">No headers configured</p>
					</div>
				</div></UiCard
			></UiTabs
		>
	</section>
</template>

<style scoped>
.model-pass-details :deep(.model-pass-preview h3 + p) {
	font-size: inherit;
	line-height: inherit;
}
.model-pass-headers-summary .model-text,
.model-pass-guardrails-summary .model-text {
	font-weight: 500;
}
.model-pass-secret pre {
	font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
}
</style>
