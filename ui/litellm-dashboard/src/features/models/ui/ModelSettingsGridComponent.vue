<script setup lang="ts">
import { computed, ref, watch } from "vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiInputNumber from "../../platform/ui/UiInputNumber.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import UiCheckbox from "../../platform/ui/UiCheckbox.vue";
import ModelSettingCell from "./ModelSettingCellComponent.vue";
import ModelValueList from "./ModelValueListComponent.vue";
import ModelSuggestionInput from "./ModelSuggestionInputComponent.vue";
import ModelProviderSelect from "./ModelProviderSelectComponent.vue";
import ModelCacheControl from "./ModelCacheControlComponent.vue";
import { basicModelFields, isCodexReasoningModel, type ModelBasicField } from "../logic/ModelEditLogic";
import {
	modelInput,
	modelRecord,
	modelString,
	modelStrings,
	modelOptions,
	type DisplayProxyModel,
	type ModelCatalog,
} from "../support/ModelModels";
import { modelPriceIdentity } from "../logic/ModelDataLogic";
import { usePriceDisplayStore } from "../../platform/stores/PriceDisplayStore";
import { modelsApi } from "../api/ModelsApi";
import {
	isManagedProviderSlug,
	isSubscriptionProviderSlug,
	subscriptionModelName,
} from "../../subscriptions/logic/SubscriptionProviderLogic";
import { getServerRootPath } from "../../platform/api/HttpApiClient";
import type { UiSelectOption } from "../../platform/ui/UiTypes";
const draft = defineModel<Record<string, unknown>>({ required: true });
const props = defineProps<{ model: DisplayProxyModel; catalog: ModelCatalog; editing: boolean; modelNames: string[] }>();
const price = usePriceDisplayStore(),
	managedModels = ref<string[]>([]),
	capabilities = ref<UiSelectOption[]>([]);
const credential = computed(
	() =>
		props.catalog.credentials.find(
			(credential) =>
				credential.credential_name ===
				(props.editing ? draft.value.litellm_credential_name : props.model.litellm_params.litellm_credential_name),
		)?.credential_values,
);
const params = computed(() => props.model.litellm_params),
	info = computed(() => props.model.model_info);
const provider = computed(() =>
	modelString(props.editing ? draft.value.custom_llm_provider : params.value.custom_llm_provider).toLowerCase(),
);
const subscriptionSlug = computed(() => (isSubscriptionProviderSlug(provider.value) ? provider.value : ""));
const managedProvider = computed(() => isManagedProviderSlug(provider.value));
const visibleModelFields = computed(() =>
	managedProvider.value ? basicModelFields.filter((field) => field.key !== "api_base") : basicModelFields,
);
const accountHref = computed(() => {
	const root = getServerRootPath().replace(/\/+$/, "");
	const query = new URLSearchParams({ page: "subscriptions" });
	if (subscriptionSlug.value) query.set("provider", subscriptionSlug.value);
	return (root === "/" ? "" : root) + "/ui/?" + query.toString();
});
const efforts = computed(() =>
	modelOptions([
		...(isCodexReasoningModel(provider.value, props.editing ? draft.value.litellm_model_name : props.model.litellm_model_name)
			? ["minimal"]
			: []),
		"low",
		"medium",
		"high",
		"xhigh",
		"max",
	]),
);
const knownModels = computed(() =>
	subscriptionSlug.value
		? managedModels.value
		: provider.value === "cliproxy"
			? managedModels.value
			: Object.entries(props.catalog.costs)
					.filter(([, entry]) => {
						const slug = modelString(entry.litellm_provider);
						return slug === provider.value || slug.startsWith(provider.value + "_") || slug.startsWith(provider.value + "-");
					})
					.map(([name]) => name)
					.sort(),
);
const wildcards = computed(() =>
	props.catalog.hub
		.filter(
			(model) =>
				modelStrings(model.providers).includes((props.model.litellm_model_name ?? "").split("/")[0]) &&
				model.model_group !== props.model.litellm_model_name,
		)
		.map((model) => ({ value: modelString(model.model_group), label: modelString(model.model_group) })),
);
function inherited(field: ModelBasicField) {
	return !!field.source && credential.value !== undefined && Object.prototype.hasOwnProperty.call(credential.value, field.source);
}
function display(field: ModelBasicField): unknown {
	const source = field.source ?? field.key,
		fromCredential = inherited(field),
		value = fromCredential
			? credential.value?.[source]
			: source === "model_name"
				? props.model.model_name
				: source === "model"
					? props.model.litellm_model_name
					: source.startsWith("override_")
						? info.value[source]
						: (params.value[source] ?? info.value[source]);
	if (field.key === "input_cost" || field.key === "output_cost") {
		if (value == null) return null;
		return props.editing && fromCredential
			? "$" + (Number(value) * 1e6).toFixed(4)
			: price.format(Number(value) * 1e6, 4, modelPriceIdentity(props.model));
	}
	return value;
}
function text(value: unknown) {
	return value == null || value === "" || value === "Not Set" ? "-" : typeof value === "object" ? JSON.stringify(value) : String(value);
}
function setProvider(value: unknown) {
	const next = modelString(value);
	draft.value.custom_llm_provider = next;
	if (isManagedProviderSlug(next))
		Object.assign(draft.value, { api_base: "", api_key: "", delete_api_key: true, litellm_credential_name: "" });
}
let generation = 0;
watch(
	() => [props.editing, provider.value] as const,
	async ([editing, slug]) => {
		const current = ++generation;
		if (!editing) return;
		const unsupported = props.model.model_info.supports_function_calling === false;
		capabilities.value = [
			{ value: "vision", label: unsupported ? "Vision (requires function calling)" : "Vision", disabled: unsupported },
		];
		const results = await Promise.allSettled([
			modelsApi.fetchModelCapabilities(),
			slug === "cliproxy"
				? modelsApi.fetchManagedModels().then((ids) => ids.map((id) => "cliproxy/" + id))
				: isSubscriptionProviderSlug(slug)
					? modelsApi.fetchSubscriptionModels(slug).then((ids) => ids.map((id) => subscriptionModelName(slug, id)))
					: Promise.resolve([]),
		]);
		if (current !== generation) return;
		if (results[0].status === "fulfilled")
			capabilities.value = Object.entries(modelRecord(results[0].value.capabilities)).map(([id, value]) => ({
				value: id,
				label:
					id.charAt(0).toUpperCase() +
					id.slice(1) +
					(unsupported ? " (requires function calling)" : modelRecord(value).enabled ? "" : " (globally off)"),
				disabled: unsupported,
			}));
		if (results[1].status === "fulfilled") managedModels.value = [...results[1].value].sort();
	},
	{ immediate: true },
);
</script>
<template>
	<div class="model-settings-grid">
		<ModelSettingCell
			v-for="field in visibleModelFields"
			:key="field.key"
			:label="editing ? (field.editLabel ?? field.label) : field.label"
			:tooltip="field.tooltip"
			><template v-if="inherited(field)"
				><div class="model-inherited-value" :class="{ 'model-inherited-value--editing': editing }">
					{{ text(display(field)) }}<small>(from Credentials)</small>
				</div></template
			><template v-else-if="!editing"
				><span :class="display(field) == null ? 'model-unset' : ''">{{ text(display(field)) }}</span></template
			><ModelSuggestionInput
				v-else-if="field.kind === 'suggestion'"
				:model-value="modelString(draft[field.key])"
				:options="field.key === 'model_name' ? modelNames : knownModels"
				:placeholder="'Enter ' + (field.key === 'model_name' ? 'model name' : 'LiteLLM model name')"
				:input-label="field.label"
				@update:model-value="draft[field.key] = $event" /><UiSelect
				v-else-if="field.kind === 'override'"
				:model-value="modelString(draft.override_model_name) || null"
				:options="modelOptions(modelNames.filter((name) => name !== model.model_name))"
				clearable
				searchable
				placeholder="No override"
				@update:model-value="draft.override_model_name = $event" /><UiSelect
				v-else-if="field.kind === 'effort'"
				:model-value="modelString(draft.override_reasoning_effort) || null"
				:options="efforts"
				clearable
				placeholder="Preserve request value"
				aria-label="Override Reasoning Effort"
				@update:model-value="draft.override_reasoning_effort = $event" /><ModelProviderSelect
				v-else-if="field.kind === 'provider'"
				clearable
				:model-value="modelString(draft.custom_llm_provider) || null"
				:catalog="catalog"
				value-field="litellm_provider"
				aria-label="Custom LLM Provider"
				@update:model-value="setProvider" /><UiInputNumber
				v-else-if="field.kind === 'number'"
				:model-value="typeof draft[field.key] === 'number' ? (draft[field.key] as number) : null"
				appearance="tremor"
				:step="0.01"
				:placeholder="field.placeholder"
				:aria-label="field.label"
				@update:model-value="draft[field.key] = $event" /><UiInput
				v-else
				:model-value="modelInput(draft[field.key])"
				appearance="tremor"
				:placeholder="field.placeholder"
				:aria-label="field.label"
				@update:model-value="draft[field.key] = $event"
		/></ModelSettingCell>
		<ModelSettingCell label="Model Access Groups" full-width
			><UiSelect
				v-if="editing"
				:model-value="modelStrings(draft.model_access_group)"
				:options="modelOptions(catalog.accessGroups)"
				max-tag-count="responsive"
				multiple
				searchable
				creatable
				:token-separators="[',']"
				clearable
				placeholder="Select existing groups or type to create new ones"
				@update:model-value="draft.model_access_group = $event" /><ModelValueList
				v-else
				:value="info.access_groups"
				empty-label="No groups assigned"
				color="blue"
		/></ModelSettingCell>
		<ModelSettingCell v-if="managedProvider" label="Credentials"
			><div class="model-managed-credential-notice">
				{{
					subscriptionSlug
						? "This subscription model uses the managed account pool. Add, rotate or disable accounts in Subscription accounts; no API key or base URL is stored on the deployment."
						: "CLIProxy uses the managed runtime endpoint and internal key. No API key is required."
				}}
				<a v-if="subscriptionSlug" :href="accountHref">Manage subscription accounts</a>
			</div></ModelSettingCell
		><template v-else
			><ModelSettingCell label="Existing Credentials"
				><template v-if="editing"
					><label class="model-edit-credential-label"
						>Credential Source<UiSelect
							:model-value="modelString(draft.litellm_credential_name)"
							:options="[
								{ value: '', label: 'Manual' },
								...catalog.credentials.map((credential) => ({
									value: credential.credential_name,
									label: credential.credential_name,
								})),
							]"
							searchable
							clearable
							placeholder="Select or search for existing credentials"
							@update:model-value="draft.litellm_credential_name = $event" /></label></template
				><span v-else>{{ params.litellm_credential_name || "Manual" }}</span></ModelSettingCell
			>
			<div v-if="editing && !draft.litellm_credential_name" class="model-edit-manual-key">
				<label
					>Manual API Key<UiInput
						:model-value="modelString(draft.api_key)"
						type="password"
						visibility-toggle
						placeholder="No API key configured"
						autocomplete="off"
						@update:model-value="draft.api_key = $event" /></label
				><UiCheckbox :model-value="Boolean(draft.delete_api_key)" @update:model-value="draft.delete_api_key = $event"
					>Delete stored manual API key</UiCheckbox
				>
			</div></template
		>
		<ModelSettingCell v-if="model.litellm_model_name?.includes('*')" label="Health Check Model"
			><UiSelect
				v-if="editing"
				:model-value="modelString(draft.health_check_model) || null"
				:options="wildcards"
				searchable
				clearable
				placeholder="Select existing health check model"
				@update:model-value="draft.health_check_model = $event"
			/><span v-else>{{ info.health_check_model || "-" }}</span></ModelSettingCell
		>
		<ModelSettingCell label="Cache Control" :full-width="editing"
			><ModelCacheControl v-if="editing" v-model="draft" /><template v-else
				><div v-if="params.cache_control_injection_points" class="model-small model-muted">
					<p
						v-for="(item, index) in Array.isArray(params.cache_control_injection_points)
							? params.cache_control_injection_points
							: []"
						:key="index"
					>
						{{ modelRecord(item).location }}<span v-if="modelRecord(item).role"> · {{ modelRecord(item).role }}</span
						><span v-if="modelRecord(item).index !== undefined"> · index {{ modelRecord(item).index }}</span>
					</p>
				</div>
				<span v-else class="model-unset">-</span></template
			></ModelSettingCell
		>
		<ModelSettingCell label="Injected Built-in Capabilities" full-width
			><UiSelect
				v-if="editing"
				:model-value="modelStrings(draft.enabled_builtin_capabilities)"
				:options="capabilities"
				multiple
				clearable
				aria-label="Injected Built-in Capabilities"
				placeholder="Select capabilities injected for this model"
				@update:model-value="draft.enabled_builtin_capabilities = $event"
			/><span v-else>{{ modelStrings(info.enabled_builtin_capabilities).join(", ") || "-" }}</span></ModelSettingCell
		>
		<ModelSettingCell
			v-for="field in [
				{ key: 'model_info', label: 'Model Info', value: info },
				{ key: 'litellm_extra_params', label: 'LiteLLM Params', value: params },
			]"
			:key="field.key"
			:label="field.label"
			full-width
			><details class="model-json-details">
				<summary>{{ editing ? "Edit raw JSON" : Object.keys(field.value).length + " fields · expand JSON" }}</summary>
				<UiInput
					v-if="editing"
					:model-value="modelString(draft[field.key])"
					multiline
					:rows="8"
					class="model-mono"
					:aria-label="field.label + ' JSON'"
					@update:model-value="draft[field.key] = $event"
				/>
				<pre v-else>{{ JSON.stringify(field.value, null, 2) }}</pre>
			</details></ModelSettingCell
		>
		<ModelSettingCell label="Team ID">{{ info.team_id || "-" }}</ModelSettingCell>
	</div>
</template>
