<script setup lang="ts">
import { ref, watch } from "vue";
import UiDialog from "../../platform/ui/UiDialog.vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiInputNumber from "../../platform/ui/UiInputNumber.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import UiSwitch from "../../platform/ui/UiSwitch.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiAlert from "../../platform/ui/UiAlert.vue";
import ModelField from "./ModelFormFieldComponent.vue";
import PassThroughPairs from "./PassThroughPairsComponent.vue";
import PassThroughPreview from "./PassThroughPreviewComponent.vue";
import PassThroughSecurity from "./PassThroughSecurityComponent.vue";
import PassThroughGuardrails from "./PassThroughGuardrailsComponent.vue";
import { createPassThroughDraft, passThroughPayload, HTTP_METHODS, type PassThroughEndpoint } from "../support/PassThroughModels";
import { modelString, modelOptions, type ModelCatalog } from "../support/ModelModels";
import { createPassThrough } from "../api/PassThroughApi";
import { nextUiIdentity } from "../../platform/ui/UiIdentity";
import notification from "../../notifications/logic/NotificationManager";
const open = defineModel<boolean>("open", { default: false });
const props = defineProps<{ catalog: ModelCatalog; premium: boolean }>();
const emit = defineEmits<{ created: [endpoint: PassThroughEndpoint] }>();
const draft = ref(createPassThroughDraft()),
	pending = ref(false),
	errors = ref<Record<string, string>>({});
const prefix = nextUiIdentity("pass-through-create");
watch(open, (value) => {
	if (value) {
		draft.value = createPassThroughDraft();
		errors.value = {};
	}
});
function path(value: unknown) {
	const next = modelString(value);
	draft.value.path = next && !next.startsWith("/") ? "/" + next : next;
}
async function submit() {
	errors.value = {};
	if (!draft.value.path.startsWith("/")) errors.value.path = "Path is required";
	if (!draft.value.target) errors.value.target = "Target URL is required";
	else
		try {
			const url = new URL(draft.value.target);
			if (!["http:", "https:", "ftp:"].includes(url.protocol)) throw new Error();
		} catch {
			errors.value.target = "Please enter a valid URL";
		}
	if (draft.value.headers === undefined) errors.value.headers = "Please configure the headers";
	if (Object.keys(errors.value).length) return;
	pending.value = true;
	try {
		const result = await createPassThrough(passThroughPayload(draft.value, props.premium));
		if (result[0]) emit("created", result[0]);
		notification.success("Pass-through endpoint created successfully");
		open.value = false;
		draft.value = createPassThroughDraft();
	} catch (error) {
		notification.fromBackend("Error creating pass-through endpoint: " + (error instanceof Error ? error.message : String(error)));
	} finally {
		pending.value = false;
	}
}
</script>
<template>
	<UiDialog v-model:open="open" :width="1000" scroll-mode="overlay" :show-footer="false" class="model-pass-create"
		><template #title
			><div class="model-pass-create-title">
				<UiIcon name="ApiOutlined" :size="20" />
				<h2>Add Pass-Through Endpoint</h2>
			</div></template
		>
		<div class="model-pass-create-body">
			<UiAlert type="info" title="What is a Pass-Through Endpoint?"
				>Route requests from your LiteLLM proxy to any external API. Perfect for custom models, image generation APIs, or any
				service you want to proxy through LiteLLM.</UiAlert
			>
			<form @submit.prevent="submit">
				<UiCard :padding="20" class="model-pass-route-card"
					><h3>Route Configuration</h3>
					<p>Configure how requests to your domain will be forwarded to the target API</p>
					<div class="model-pass-route-fields">
						<ModelField
							label="Path Prefix"
							:id="prefix + '-path'"
							required
							vertical
							help="Example: /bria, /adobe-photoshop, /elasticsearch"
							:error="errors.path"
							><UiInput
								:id="prefix + '-path'"
								:model-value="draft.path"
								appearance="tremor"
								placeholder="bria"
								@update:model-value="path" /></ModelField
						><ModelField
							label="Target URL"
							:id="prefix + '-target'"
							required
							vertical
							help="Example:https://engine.prod.bria-api.com"
							:error="errors.target"
							><UiInput
								:id="prefix + '-target'"
								v-model="draft.target"
								appearance="tremor"
								placeholder="https://engine.prod.bria-api.com" /></ModelField
						><ModelField
							label="HTTP Methods (Optional)"
							:id="prefix + '-methods'"
							vertical
							tooltip-icon="InfoCircleOutlined"
							tooltip="Select specific HTTP methods. Leave empty to support all methods (GET, POST, PUT, DELETE, PATCH). Useful when the same path needs different targets for different methods."
							:help="
								draft.methods?.length
									? 'Only ' + draft.methods.join(', ') + ' requests will be routed to this endpoint'
									: 'All HTTP methods supported (default)'
							"
							><UiSelect
								:id="prefix + '-methods'"
								v-model="draft.methods"
								:options="modelOptions(HTTP_METHODS)"
								multiple
								clearable
								placeholder="Select methods (leave empty for all)"
						/></ModelField>
						<div class="model-pass-subpath">
							<div>
								<strong>Include Subpaths</strong>
								<p>Forward all subpaths to the target API (recommended for REST APIs)</p>
							</div>
							<UiSwitch v-model="draft.include_subpath" appearance="tremor" aria-label="Include Subpaths" />
						</div></div
				></UiCard>
				<PassThroughPreview :path="draft.path" :target="draft.target" :include-subpath="draft.include_subpath" />
				<UiCard :padding="24" class="model-pass-headers-card"
					><h3>Headers</h3>
					<p>Add headers that will be sent with every request to the target API</p>
					<ModelField
						label="Authentication Headers"
						vertical
						required
						tooltip-icon="InfoCircleOutlined"
						tooltip="Authentication and other headers to forward with requests"
						:error="errors.headers"
						><PassThroughPairs v-model="draft.headers" />
						<div class="model-pass-extra">
							<strong>Add authentication tokens and other required headers</strong>
							<p>Common examples: auth_token, Authorization, x-api-key</p>
						</div></ModelField
					></UiCard
				>
				<UiCard :padding="24" class="model-pass-query-card"
					><h3>Default Query Parameters</h3>
					<p>Add query parameters that will be automatically sent with every request to the target API</p>
					<ModelField
						label="Default Query Parameters (Optional)"
						vertical
						tooltip-icon="InfoCircleOutlined"
						tooltip="Query parameters that will be added to all requests. Clients can override these by providing their own values."
						><PassThroughPairs v-model="draft.default_query_params" query />
						<div class="model-pass-extra">
							<strong>Parameters are sent with all GET, POST, PUT, PATCH requests</strong>
							<p>Client parameters override defaults. Examples: version=v1, format=json, key=default</p>
						</div></ModelField
					></UiCard
				>
				<PassThroughSecurity :premium="premium" v-model="draft.auth" /><PassThroughGuardrails
					v-model="draft.guardrails"
					:catalog="catalog"
				/>
				<UiCard :padding="24" class="model-pass-billing"
					><h3>Billing</h3>
					<p>Optional cost tracking for this endpoint</p>
					<ModelField
						label="Cost Per Request (USD)"
						:id="prefix + '-cost'"
						vertical
						tooltip-icon="InfoCircleOutlined"
						tooltip="Optional: Track costs for requests to this endpoint"
						help="The cost charged for each request through this endpoint"
						><UiInputNumber
							:id="prefix + '-cost'"
							v-model="draft.cost_per_request"
							appearance="tremor"
							:min="0"
							:step="0.001"
							placeholder="2.0000"
							size="large" /></ModelField
				></UiCard>
				<div class="model-pass-create-footer">
					<UiButton appearance="tremor" @click="open = false">Cancel</UiButton
					><UiButton appearance="tremor" variant="primary" :loading="pending" @click="submit">{{
						pending ? "Creating..." : "Add Pass-Through Endpoint"
					}}</UiButton>
				</div>
			</form>
		</div></UiDialog
	>
</template>
