<script setup lang="ts">
import { computed, ref, watch } from "vue";
import UiDialog from "../../platform/ui/UiDialog.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiSpinner from "../../platform/ui/UiSpinner.vue";
import { modelsApi } from "../api/ModelsApi";
import { prepareModelCreate, type ModelCreateDraft } from "../logic/ModelCreateLogic";
import { modelRecord, modelString, type ModelDeploymentRequest } from "../support/ModelModels";
import notification from "../../notifications/logic/NotificationManager";
const props = defineProps<{ open: boolean; values?: ModelCreateDraft; request?: ModelDeploymentRequest; modelName: string }>();
const emit = defineEmits<{ "update:open": [value: boolean]; complete: [] }>();
const loading = ref(false),
	success = ref(false),
	error = ref(""),
	details = ref(false),
	rawRequest = ref<Record<string, unknown> | null>(null),
	rawResponse = ref<Record<string, unknown> | null>(null);
let generation = 0;
const cleanError = computed(() =>
	error.value
		.split("stack trace:")[0]
		.trim()
		.replace(/^litellm\.(.*?)Error: /, ""),
);
const curl = computed(() => {
	const value = rawResponse.value;
	if (!value) return "";
	const headers = Object.entries(modelRecord(value.raw_request_headers)).map(
		([key, value]) => "-H '" + key + ": " + modelString(value) + "'",
	);
	return [
		"curl -X POST " + modelString(value.raw_request_api_base),
		...headers,
		"-H 'Content-Type: application/json'",
		"-d '" + JSON.stringify(value.raw_request_body, null, 2) + "'",
	].join(" \\\n  ");
});
watch(
	() => props.open,
	async (open) => {
		const current = ++generation;
		if (!open) return;
		loading.value = true;
		success.value = false;
		error.value = "";
		details.value = false;
		rawRequest.value = null;
		rawResponse.value = null;
		try {
			const deployment = props.request ?? prepareModelCreate(props.values ?? {})[0];
			if (!deployment) throw new Error("Failed to prepare model data. Please check your form inputs.");
			const response = modelRecord(
				await modelsApi.testModelConnection(
					deployment.litellm_params,
					deployment.model_info,
					modelString(deployment.model_info.mode) || undefined,
				),
			);
			if (current !== generation) return;
			if (response.status === "success") {
				success.value = true;
				notification.success("Connection test successful!");
			} else {
				const result = modelRecord(response.result);
				error.value = modelString(result.error) || modelString(response.message) || "Unknown error";
				rawRequest.value = deployment.litellm_params;
				rawResponse.value = modelRecord(result.raw_request_typed_dict);
			}
		} catch (cause) {
			if (current === generation) error.value = cause instanceof Error ? cause.message : String(cause);
		} finally {
			if (current === generation) {
				loading.value = false;
				emit("complete");
			}
		}
	},
);
function copy(value: string) {
	void navigator.clipboard.writeText(value);
}
</script>
<template>
	<UiDialog
		:open="open"
		title="Connection Test Results"
		:width="700"
		scroll-mode="overlay"
		:show-footer="false"
		@update:open="emit('update:open', $event)"
		><div class="model-connection-result">
			<div v-if="loading" class="model-connection-loading">
				<UiSpinner :size="30" />
				<p>Testing connection to {{ modelName }}...</p>
			</div>
			<div v-else-if="success" class="model-connection-success">
				<UiIcon name="CheckCircleFilled" :size="24" /><span>Connection to {{ modelName }} successful!</span>
			</div>
			<div v-else>
				<div class="model-connection-failure">
					<UiIcon name="WarningOutlined" :size="24" /><span>Connection to {{ modelName }} failed</span>
				</div>
				<div class="model-connection-error">
					<strong>Error:</strong>
					<p>{{ cleanError }}</p>
					<UiButton variant="link" @click="details = !details">{{ details ? "Hide Details" : "Show Details" }}</UiButton>
				</div>
				<div v-if="details" class="model-connection-details">
					<strong>Full Error Details:</strong>
					<pre>{{ error }}</pre>
					<template v-if="rawRequest"
						><strong>Request Parameters:</strong>
						<pre>{{ JSON.stringify(rawRequest, null, 2) }}</pre></template
					><template v-if="rawResponse"
						><div class="model-inline model-between">
							<strong>Raw Request:</strong
							><UiButton size="small" @click="copy(curl)"
								><template #icon><UiIcon name="CopyOutlined" /></template>Copy cURL</UiButton
							>
						</div>
						<pre>{{ curl }}</pre>
					</template>
				</div>
			</div>
			<div class="model-text-right"><UiButton @click="emit('update:open', false)">Close</UiButton></div>
		</div></UiDialog
	>
</template>
