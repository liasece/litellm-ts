<script setup lang="ts">
import { computed } from "vue";
import UiDialog from "../../../platform/ui/UiDialog.vue";
import UiInput from "../../../platform/ui/UiInput.vue";
import UiSelect from "../../../platform/ui/UiSelect.vue";
import UiButton from "../../../platform/ui/UiButton.vue";
import UiAlert from "../../../platform/ui/UiAlert.vue";
import GuardrailFieldComponent from "../common/GuardrailFieldComponent.vue";
import GuardrailParameterFieldsComponent from "../editor/GuardrailParameterFieldsComponent.vue";
import GuardrailToolPermissionsComponent from "../editor/GuardrailToolPermissionsComponent.vue";
import GuardrailPiiConfigurationComponent from "../editor/GuardrailPiiConfigurationComponent.vue";
import GuardrailContentFilterComponent from "../content-filter/GuardrailContentFilterComponent.vue";
import type { GuardrailDetailStore } from "../../stores/GuardrailDetailStore";
import type { ProviderParam } from "../../support/GuardrailModels";
import { guardrail_provider_map } from "../../logic/GuardrailProviderLogic";
import { guardrailRecord } from "../../support/GuardrailClipboardSupport";
const props = defineProps<{ store: GuardrailDetailStore }>(),
	store = props.store,
	values = store.values,
	record = store.record,
	state = store.state,
	settings = store.settings,
	group = computed(() => {
		const provider = Object.keys(guardrail_provider_map).find(
			(key) => guardrail_provider_map[key] === record.value?.litellm_params.guardrail,
		);
		return provider ? store.providers.value?.[guardrail_provider_map[provider]?.toLowerCase()] : undefined;
	}),
	fields = computed(() =>
		Object.fromEntries(
			Object.entries(group.value ?? {}).filter(
				(entry): entry is [string, ProviderParam] =>
					entry[0] !== "optional_params" && entry[0] !== "ui_friendly_name" && typeof entry[1] === "object" && entry[1] !== null,
			),
		),
	),
	optionalValues = computed<Record<string, unknown>>({
		get: () => guardrailRecord(values.value.optional_params),
		set: (value) => (values.value = { ...values.value, optional_params: value }),
	}),
	name = computed({ get: () => String(values.value.guardrail_name ?? ""), set: (value) => (values.value.guardrail_name = value) }),
	info = computed({ get: () => String(values.value.guardrail_info ?? ""), set: (value) => (values.value.guardrail_info = value) });
function entity(value: string) {
	store.pii.entities = store.pii.entities.includes(value)
		? store.pii.entities.filter((item) => item !== value)
		: [...store.pii.entities, value];
}
const unsavedMessage = 'You have unsaved changes to patterns or keywords. Remember to click "Save Changes" at the bottom.';
</script>
<template>
	<UiDialog
		:open="state.editing"
		title="Edit Guardrail"
		width="min(960px, calc(100vw - 32px))"
		:show-footer="false"
		scroll-mode="overlay"
		class="guardrail-edit-dialog"
		@update:open="!$event && store.cancel()"
		><form class="guardrail-edit-form" @submit.prevent="store.save">
			<GuardrailFieldComponent label="Guardrail Name" required :error="state.nameError"
				><UiInput v-model="name" placeholder="Enter guardrail name" /></GuardrailFieldComponent
			><GuardrailFieldComponent label="Default On"
				><UiSelect
					:model-value="String(values.default_on)"
					:options="[
						{ value: 'true', label: 'Yes' },
						{ value: 'false', label: 'No' },
					]"
					@update:model-value="values.default_on = $event === 'true'" /></GuardrailFieldComponent
			><template v-if="record?.litellm_params.guardrail === 'presidio'"
				><h3 class="guardrail-form-divider">PII Protection</h3>
				<GuardrailPiiConfigurationComponent
					v-if="settings"
					:entities="settings.supported_entities"
					:actions="settings.supported_actions"
					:selected-entities="store.pii.entities"
					:selected-actions="store.pii.actions"
					:entity-categories="settings.pii_entity_categories"
					@entity="entity"
					@action="(entityName, action) => (store.pii.actions[entityName] = action)" /></template
			><template v-if="record?.litellm_params.guardrail === 'litellm_content_filter'"
				><h3 class="guardrail-form-divider">Content Filter Configuration</h3>
				<UiAlert v-if="store.contentDirty.value" type="warning" :title="unsavedMessage" /><GuardrailContentFilterComponent
					v-if="settings?.content_filter_settings"
					v-model="store.content.value"
					:settings="settings.content_filter_settings"
			/></template>
			<h3 v-if="record?.litellm_params.guardrail === 'tool_permission' || store.providers.value" class="guardrail-form-divider">
				Provider Settings
			</h3>
			<GuardrailToolPermissionsComponent
				v-if="record?.litellm_params.guardrail === 'tool_permission'"
				v-model="store.permissions.value"
			/><template v-else
				><GuardrailParameterFieldsComponent v-model="values" :fields="fields" /><GuardrailParameterFieldsComponent
					v-if="group?.optional_params?.fields"
					v-model="optionalValues"
					:fields="group.optional_params.fields"
					optional
			/></template>
			<h3 class="guardrail-form-divider">Advanced Settings</h3>
			<GuardrailFieldComponent label="Guardrail Information"><UiInput v-model="info" multiline :rows="5" /></GuardrailFieldComponent>
			<footer>
				<UiButton @click="store.cancel">Cancel</UiButton
				><UiButton variant="primary" type="submit" :loading="state.saving">Save Changes</UiButton>
			</footer>
		</form></UiDialog
	>
</template>
