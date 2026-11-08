<script setup lang="ts">
import { computed, ref, watch } from "vue";
import UiDialog from "../../platform/ui/UiDialog.vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import { nextUiIdentity } from "../../platform/ui/UiIdentity";
import { loggingSettingsApi, type LoggingCallback, type CallbackConfiguration } from "../api/LoggingSettingsApi";
import { callbackParameters, callbackPayload } from "../logic/LoggingPayloadLogic";
import notification from "../../notifications/logic/NotificationManager";
const open = defineModel<boolean>("open", { default: false });
const props = defineProps<{ callback?: LoggingCallback | null; configurations: CallbackConfiguration[] }>();
const emit = defineEmits<{ changed: [] }>();
const values = ref<Record<string, unknown>>({}),
	selected = ref(""),
	pending = ref(false),
	errors = ref<Record<string, string>>({});
const prefix = nextUiIdentity("callback-form");
const query = ref("");
const choices = computed(() =>
	props.configurations
		.filter((config) => config.id.toLowerCase().includes(query.value.toLowerCase()))
		.map((config) => ({ value: config.id, label: config.displayName })),
);
const edit = computed(() => Boolean(props.callback));
const params = computed(() => callbackParameters(selected.value, props.configurations, props.callback?.variables));
const config = computed(() => props.configurations.find((config) => config.id === selected.value));
watch(open, (value) => {
	if (!value) return;
	errors.value = {};
	query.value = "";
	selected.value = props.callback?.name || "";
	values.value = Object.fromEntries(Object.entries(props.callback?.variables || {}).map(([name, value]) => [name, value ?? ""]));
	if (selected.value) values.value.callback = selected.value;
});
function change(value: unknown) {
	selected.value = String(value ?? "");
	values.value.callback = selected.value;
}
function logo(value: string | null | undefined) {
	return !value ? "" : value.includes("/") || value.startsWith("data:") || value.startsWith("http") ? value : "/ui/assets/logos/" + value;
}
function label(name: string) {
	const value = config.value?.dynamic_params?.[name]?.ui_name;
	return typeof value === "string" ? value : name.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}
function fieldType(name: string) {
	return config.value?.dynamic_params?.[name]?.type || "text";
}
async function save() {
	errors.value = {};
	if (!selected.value) errors.value.callback = "Please select a callback";
	for (const name of params.value)
		if (config.value?.dynamic_params?.[name]?.required && !values.value[name])
			errors.value[name] = "Please enter the " + label(name).toLowerCase();
	if (Object.keys(errors.value).length) return;
	pending.value = true;
	try {
		await loggingSettingsApi.update(callbackPayload(values.value, selected.value));
		notification.success(edit.value ? "Callback updated successfully" : "Callback " + selected.value + " added successfully");
		open.value = false;
		values.value = {};
		selected.value = "";
		emit("changed");
	} catch (error) {
		notification.fromBackend(error);
	} finally {
		pending.value = false;
	}
}
</script>
<template>
	<UiDialog
		v-model:open="open"
		:title="edit ? 'Edit Callback Settings' : 'Add Logging Callback'"
		:width="800"
		:show-footer="false"
		scroll-mode="overlay"
		class="logging-callback-dialog"
	>
		<a v-if="!edit" href="https://docs.litellm.ai/docs/proxy/logging" target="_blank" rel="noreferrer" class="logging-doc-link"
			>LiteLLM Docs: Logging</a
		>
		<form class="logging-callback-form" @submit.prevent="save">
			<div class="logging-field" :class="{ 'logging-field--error': errors.callback }">
				<label :for="prefix + '-callback'" :class="{ 'logging-required': !edit }">Callback</label>
				<div>
					<UiSelect
						:id="prefix + '-callback'"
						:model-value="selected || null"
						:options="choices"
						:disabled="edit"
						size="large"
						searchable
						placeholder="Choose a logging callback..."
						:filterable="false"
						@search="query = $event"
						@open-change="!$event && (query = '')"
						@update:model-value="change"
						><template #option="{ option }"
							><span class="logging-callback-option"
								><span class="logging-callback-logo"
									><img
										:src="logo(configurations.find((config) => config.id === option.value)?.logo)"
										:alt="option.label + ' logo'"
										@error="($event.target as HTMLImageElement).style.display = 'none'" /></span
								><strong>{{ option.label }}</strong></span
							></template
						><template #value="{ option }"
							><span class="logging-callback-option logging-callback-option--value"
								><span class="logging-callback-logo"
									><img
										:src="logo(configurations.find((config) => config.id === option.value)?.logo)"
										:alt="option.label + ' logo'"
										@error="($event.target as HTMLImageElement).style.display = 'none'" /></span
								><strong>{{ option.label }}</strong></span
							></template
						></UiSelect
					>
					<p v-if="errors.callback" class="logging-error">{{ errors.callback }}</p>
				</div>
			</div>
			<div v-if="params.length" class="logging-dynamic-fields">
				<div v-for="name in params" :key="name" class="logging-field" :class="{ 'logging-field--error': errors[name] }">
					<label :for="prefix + '-' + name" :class="{ 'logging-required': Boolean(config?.dynamic_params?.[name]?.required) }">{{
						label(name)
					}}</label>
					<div>
						<UiInput
							:id="prefix + '-' + name"
							:model-value="values[name] == null ? '' : String(values[name])"
							:type="fieldType(name) === 'password' ? 'password' : fieldType(name) === 'number' ? 'number' : 'text'"
							:visibility-toggle="fieldType(name) === 'password'"
							size="large"
							:placeholder="(fieldType(name) === 'number' ? 'Enter ' : 'Enter your ') + label(name).toLowerCase()"
							:min="fieldType(name) === 'number' ? 0 : undefined"
							:max="fieldType(name) === 'number' ? 1 : undefined"
							:step="fieldType(name) === 'number' ? 0.1 : undefined"
							@update:model-value="values[name] = $event == null ? '' : String($event)"
						/>
						<p v-if="errors[name]" class="logging-error">{{ errors[name] }}</p>
					</div>
				</div>
			</div>
			<footer>
				<UiButton
					:disabled="pending"
					@click="
						open = false;
						values = {};
						selected = '';
					"
					>Cancel</UiButton
				><UiButton type="submit" :disabled="pending" :loading="pending">{{
					pending ? (edit ? "Saving..." : "Adding...") : edit ? "Save Changes" : "Add Callback"
				}}</UiButton>
			</footer>
		</form>
	</UiDialog>
</template>
