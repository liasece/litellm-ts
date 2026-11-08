<script setup lang="ts">
import { computed, watch, onBeforeUnmount } from "vue";
import UiDialog from "../../../platform/ui/UiDialog.vue";
import UiButton from "../../../platform/ui/UiButton.vue";
import UiInput from "../../../platform/ui/UiInput.vue";
import UiSelect from "../../../platform/ui/UiSelect.vue";
import UiTag from "../../../platform/ui/UiTag.vue";
import { useAuthenticationStore } from "../../../identity/stores/AuthenticationStore";
import { createGuardrailCreateStore } from "../../stores/GuardrailCreateStore";
import {
	guardrail_provider_map,
	guardrailLogoMap,
	shouldRenderContentFilterConfigSettings,
	shouldRenderPIIConfigSettings,
} from "../../logic/GuardrailProviderLogic";
import type { ProviderParam } from "../../support/GuardrailModels";
import type { GuardrailPreset } from "../../data/GuardrailGardenPresets";
import GuardrailFieldComponent from "../common/GuardrailFieldComponent.vue";
import GuardrailParameterFieldsComponent from "./GuardrailParameterFieldsComponent.vue";
import GuardrailPiiConfigurationComponent from "./GuardrailPiiConfigurationComponent.vue";
import GuardrailToolPermissionsComponent from "./GuardrailToolPermissionsComponent.vue";
import GuardrailContentFilterComponent from "../content-filter/GuardrailContentFilterComponent.vue";
import GuardrailEndpointSettingsComponent from "./GuardrailEndpointSettingsComponent.vue";
const open = defineModel<boolean>("open", { required: true }),
	props = defineProps<{ preset?: GuardrailPreset }>(),
	emit = defineEmits<{ created: [] }>(),
	auth = useAuthenticationStore(),
	store = createGuardrailCreateStore(() => auth.isAuthorized.value),
	{ values, settings, providers, provider, providerOptions, steps, state, pii } = store,
	content = computed({ get: () => store.content, set: (value) => Object.assign(store.content, value) }),
	endpoint = computed({ get: () => store.endpoint, set: (value) => Object.assign(store.endpoint, value) }),
	isContent = computed(() => shouldRenderContentFilterConfigSettings(provider.value)),
	isPii = computed(() => shouldRenderPIIConfigSettings(provider.value)),
	providerGroup = computed(() => providers.value?.[guardrail_provider_map[provider.value ?? ""]?.toLowerCase()]),
	fields = computed(() =>
		Object.fromEntries(
			Object.entries(providerGroup.value ?? {}).filter(
				(entry): entry is [string, ProviderParam] =>
					entry[0] !== "optional_params" && entry[0] !== "ui_friendly_name" && typeof entry[1] === "object" && entry[1] !== null,
			),
		),
	),
	optional = computed(() => providerGroup.value?.optional_params),
	optionalValues = computed<Record<string, unknown>>({
		get: () =>
			values.value.optional_params && typeof values.value.optional_params === "object"
				? (values.value.optional_params as Record<string, unknown>)
				: {},
		set: (value) => (values.value = { ...values.value, optional_params: value }),
	}),
	modeDescriptions: Record<string, string> = {
		pre_call: "Before LLM Call - Runs before the LLM call and checks the input (Recommended)",
		during_call: "During LLM Call - Runs in parallel with the LLM call, with response held until check completes",
		post_call: "After LLM Call - Runs after the LLM call and checks only the output",
		logging_only: "Logging Only - Only runs on logging callbacks without affecting the LLM call",
		pre_mcp_call: "Before MCP Tool Call - Runs before MCP tool execution and validates tool calls",
		during_mcp_call: "During MCP Tool Call - Runs in parallel with MCP tool execution for monitoring",
	},
	modes = computed(() => settings.value?.supported_modes ?? ["pre_call", "during_call", "post_call", "logging_only"]);
watch(auth.isAuthorized, () => void store.load(), { immediate: true });
watch(
	() => [open.value, settings.value, props.preset],
	() => {
		if (open.value && settings.value && props.preset) store.applyPreset(props.preset);
	},
	{ immediate: true },
);
function close() {
	store.reset();
	open.value = false;
}
function chooseProvider(value: unknown) {
	if (typeof value === "string") store.chooseProvider(value);
}
function modeValue() {
	const value = values.value.mode;
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: typeof value === "string"
			? value
			: null;
}
function textValue(key: string) {
	const value = values.value[key];
	return typeof value === "string" || typeof value === "number" ? value : undefined;
}
function hideImage(event: Event) {
	(event.target as HTMLImageElement).style.display = "none";
}
async function save() {
	if (await store.save()) {
		emit("created");
		open.value = false;
	}
}
function setAction(entity: string, action: string) {
	pii.actions[entity] = action;
}
function selectEntity(entity: string) {
	pii.entities = pii.entities.includes(entity) ? pii.entities.filter((value) => value !== entity) : [...pii.entities, entity];
}
onBeforeUnmount(store.dispose);
</script>
<template>
	<UiDialog
		:open="open"
		:width="1000"
		:closable="false"
		:show-footer="false"
		scroll-mode="overlay"
		class="guardrail-create-dialog"
		@update:open="!$event && close()"
		><div class="guardrail-create">
			<header>
				<h3>Create guardrail</h3>
				<button type="button" aria-label="Close" @click="close">✕</button>
			</header>
			<div class="guardrail-create-scroll">
				<div
					v-for="(step, index) in steps"
					:key="step"
					:class="[
						'guardrail-create-step',
						{ current: index === state.step, done: index < state.step, last: index === steps.length - 1 },
					]"
				>
					<div class="guardrail-step-indicator">
						<span>{{ index < state.step ? "✓" : index + 1 }}</span
						><i v-if="index < steps.length - 1" />
					</div>
					<div>
						<button type="button" class="guardrail-step-heading" @click="index < state.step && (state.step = index)">
							<span>{{ step }}</span
							><small v-if="step.includes('(Optional)') && index !== state.step">optional</small
							><small v-if="index < state.step" class="guardrail-step-edit">Edit</small>
						</button>
						<div v-if="index === state.step" class="guardrail-create-step-content">
							<template v-if="state.step === 0"
								><GuardrailFieldComponent
									label="Guardrail Name"
									required
									:error="values.guardrail_name ? undefined : state.errors.guardrail_name"
									><UiInput
										:model-value="textValue('guardrail_name')"
										:status="!values.guardrail_name && state.errors.guardrail_name ? 'error' : undefined"
										placeholder="Enter a name for this guardrail"
										@update:model-value="values.guardrail_name = $event" /></GuardrailFieldComponent
								><GuardrailFieldComponent label="Guardrail Provider" required :error="state.errors.provider"
									><UiSelect
										:model-value="provider"
										:options="providerOptions"
										:status="provider ? undefined : state.errors.provider ? 'error' : undefined"
										placeholder="Select a guardrail provider"
										searchable
										@update:model-value="chooseProvider"
										><template #option="{ option }"
											><div class="guardrail-provider-option">
												<img
													v-if="guardrailLogoMap[option.label]"
													:src="guardrailLogoMap[option.label]"
													alt=""
													@error="hideImage"
												/><span>{{ option.label }}</span>
											</div></template
										><template #value="{ option }"
											><div class="guardrail-provider-option">
												<img
													v-if="guardrailLogoMap[option.label]"
													:src="guardrailLogoMap[option.label]"
													alt=""
													@error="hideImage"
												/><span>{{ option.label }}</span>
											</div></template
										></UiSelect
									></GuardrailFieldComponent
								><GuardrailFieldComponent
									label="Mode"
									required
									tooltip="How the guardrail should be applied"
									:error="state.errors.mode"
									><UiSelect
										:model-value="modeValue()"
										:options="modes.map((value) => ({ value, label: value, description: modeDescriptions[value] }))"
										multiple
										@update:model-value="values.mode = $event"
										><template #option="{ option }"
											><div>
												<strong>{{ option.value }}</strong
												><UiTag v-if="option.value === 'pre_call'" color="green" style="margin-left: 8px"
													>Recommended</UiTag
												><small class="guardrail-mode-description">{{ option.description }}</small>
											</div></template
										></UiSelect
									></GuardrailFieldComponent
								><GuardrailFieldComponent
									label="Always On"
									tooltip="If enabled, this guardrail will be applied to all requests by default."
									><UiSelect
										:model-value="String(values.default_on)"
										:options="[
											{ value: 'true', label: 'Yes' },
											{ value: 'false', label: 'No' },
										]"
										@update:model-value="values.default_on = $event === 'true'" /></GuardrailFieldComponent
								><GuardrailParameterFieldsComponent
									v-if="provider && !store.isToolPermission.value && !isContent"
									v-model="values"
									:fields="fields"
									:errors="state.errors"
								/>
								<p v-if="provider && !store.isToolPermission.value && !isContent && !Object.keys(fields).length">
									No configuration fields available for this provider.
								</p></template
							><GuardrailPiiConfigurationComponent
								v-else-if="state.step === 1 && isPii && provider === 'PresidioPII' && settings"
								:entities="settings.supported_entities"
								:actions="settings.supported_actions"
								:selected-entities="pii.entities"
								:selected-actions="pii.actions"
								:entity-categories="settings.pii_entity_categories"
								@entity="selectEntity"
								@action="setAction"
							/><GuardrailContentFilterComponent
								v-else-if="isContent && settings?.content_filter_settings && state.step < 4"
								v-model="content"
								:settings="settings.content_filter_settings"
								:show-step="state.step === 1 ? 'categories' : state.step === 2 ? 'patterns' : 'keywords'"
							/><GuardrailEndpointSettingsComponent
								v-else-if="isContent && state.step === 4"
								v-model="endpoint"
							/><GuardrailToolPermissionsComponent
								v-else-if="store.isToolPermission.value"
								v-model="store.permissions.value"
							/>
							<div v-else-if="optional?.fields">
								<header class="guardrail-optional-header">
									<h3>Optional Parameters</h3>
									<p>{{ optional.description || "Configure additional settings for this guardrail provider" }}</p>
								</header>
								<GuardrailParameterFieldsComponent
									v-model="optionalValues"
									:fields="optional.fields"
									optional
									:errors="state.errors"
								/>
							</div>
						</div>
					</div>
				</div>
			</div>
			<footer>
				<UiButton @click="close">Cancel</UiButton><UiButton v-if="state.step > 0" @click="state.step--">Previous</UiButton
				><UiButton
					variant="primary"
					:loading="state.step === steps.length - 1 && state.pending"
					@click="state.step < steps.length - 1 ? store.next() : save()"
					>{{ state.step < steps.length - 1 ? "Next" : "Create Guardrail" }}</UiButton
				>
			</footer>
		</div></UiDialog
	>
</template>
