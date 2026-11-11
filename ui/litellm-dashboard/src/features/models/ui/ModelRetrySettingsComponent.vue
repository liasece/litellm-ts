<script setup lang="ts">
import { computed, ref } from "vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiInputNumber from "../../platform/ui/UiInputNumber.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import ModelName from "../../providers/ui/ModelNameComponent.vue";
import { modelsApi } from "../api/ModelsApi";
import { modelOptions, modelRecord, type ModelCatalog } from "../support/ModelModels";
import notification from "../../notifications/logic/NotificationManager";
const props = defineProps<{ catalog: ModelCatalog; modelGroups: string[] }>();
const scope = ref<string | null>(null),
	pending = ref(false);
const global = ref<Record<string, unknown>>({ ...modelRecord(props.catalog.router.retry_policy) });
const groups = ref<Record<string, unknown>>({ ...modelRecord(props.catalog.router.model_group_retry_policy) });
const defaultRetry = computed(() => Number(props.catalog.router.num_retries ?? 0));
const policies = {
	"BadRequestError (400)": "BadRequestErrorRetries",
	"AuthenticationError  (401)": "AuthenticationErrorRetries",
	"TimeoutError (408)": "TimeoutErrorRetries",
	"RateLimitError (429)": "RateLimitErrorRetries",
	"ContentPolicyViolationError (400)": "ContentPolicyViolationErrorRetries",
	"InternalServerError (500)": "InternalServerErrorRetries",
};
function value(key: string): number {
	return Number(
		(scope.value === "global" ? global.value[key] : (modelRecord(groups.value[String(scope.value)])[key] ?? global.value[key])) ??
			defaultRetry.value,
	);
}
function set(key: string, value: number | null) {
	if (scope.value === "global") {
		if (value != null) global.value = { ...global.value, [key]: value };
	} else groups.value = { ...groups.value, [String(scope.value)]: { ...modelRecord(groups.value[String(scope.value)]), [key]: value } };
}
async function save() {
	pending.value = true;
	try {
		await modelsApi.saveModelConfiguration({
			router_settings: scope.value === "global" ? { retry_policy: global.value } : { model_group_retry_policy: groups.value },
		});
		notification.success("Retry settings saved successfully");
	} catch (error) {
		notification.fromBackend(error instanceof Error ? error.message : "Failed to save retry settings");
	} finally {
		pending.value = false;
	}
}
</script>
<template>
	<div class="model-retries">
		<div class="model-retry-scope">
			<span>Retry Policy Scope:</span
			><UiSelect
				:model-value="scope === 'global' ? 'global' : scope || modelGroups[0]"
				@update:model-value="scope = typeof $event === 'string' ? $event : null"
				:options="[{ value: 'global', label: 'Global Default' }, ...modelOptions(modelGroups)]"
				appearance="tremor"
				aria-label="Retry Policy Scope"
			/>
		</div>
		<h3 class="model-title model-retry-title">
			<ModelName :model="scope === 'global' ? '' : scope" :size="16">{{
				scope === "global" ? "Global Retry Policy" : "Retry Policy for " + (scope ?? "")
			}}</ModelName>
		</h3>
		<p class="model-text model-retry-description">
			{{
				scope === "global"
					? "Default retry settings applied to all model groups unless overridden"
					: "Model-specific retry settings. Falls back to global defaults if not set."
			}}
		</p>
		<table>
			<tbody>
				<tr v-for="(key, label) in policies" :key="key">
					<td>
						<p class="model-text">{{ label }}</p>
						<p v-if="scope !== 'global'" class="model-muted model-small">(Global: {{ global[key] ?? defaultRetry }})</p>
					</td>
					<td>
						<UiInputNumber
							:model-value="value(key)"
							:min="0"
							:step="1"
							:aria-label="label"
							@update:model-value="set(key, $event)"
						/>
					</td>
				</tr>
			</tbody>
		</table>
		<UiButton appearance="tremor" variant="primary" :loading="pending" @click="save">Save</UiButton>
	</div>
</template>
