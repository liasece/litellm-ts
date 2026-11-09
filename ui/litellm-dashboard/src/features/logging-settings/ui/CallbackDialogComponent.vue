<script setup lang="ts">
import { computed, ref, watch } from "vue";
import UiDialog from "../../platform/ui/UiDialog.vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import { nextUiIdentity } from "../../platform/ui/UiIdentity";
import { loggingSettingsApi, type LoggingCallback, type AvailableCallbacks } from "../api/LoggingSettingsApi";
import { callbackParameters, callbackPayload } from "../logic/LoggingPayloadLogic";
import notification from "../../notifications/logic/NotificationManager";
const open = defineModel<boolean>("open", { default: false });
const props = defineProps<{ callback?: LoggingCallback | null; available: AvailableCallbacks }>();
const emit = defineEmits<{ changed: [] }>();
const values = ref<Record<string, unknown>>({}),
	selected = ref(""),
	pending = ref(false),
	errors = ref<Record<string, string>>({});
const prefix = nextUiIdentity("callback-form");
const query = ref("");
const choices = computed(() =>
	Object.entries(props.available)
		.filter(([id]) => id.toLowerCase().includes(query.value.toLowerCase()))
		.map(([id, info]) => ({
			value: id,
			label: info && typeof info === "object" && "ui_callback_name" in info ? String(info.ui_callback_name) : id,
		})),
);
const edit = computed(() => Boolean(props.callback));
const params = computed(() => callbackParameters(selected.value, props.available, props.callback?.variables));
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
function label(name: string) {
	return name.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}
async function save() {
	errors.value = {};
	if (!selected.value) errors.value.callback = "Please select a callback";
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
					/>
					<p v-if="errors.callback" class="logging-error">{{ errors.callback }}</p>
				</div>
			</div>
			<div v-if="params.length" class="logging-dynamic-fields">
				<div v-for="name in params" :key="name" class="logging-field">
					<label :for="prefix + '-' + name">{{ label(name) }}</label>
					<div>
						<UiInput
							:id="prefix + '-' + name"
							:model-value="values[name] == null ? '' : String(values[name])"
							type="text"
							size="large"
							:placeholder="'Enter ' + label(name).toLowerCase()"
							@update:model-value="values[name] = $event == null ? '' : String($event)"
						/>
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
