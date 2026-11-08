<script setup lang="ts">
import { computed, ref } from "vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiDialog from "../../platform/ui/UiDialog.vue";
import UiDrawer from "../../platform/ui/UiDrawer.vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import UiCheckbox from "../../platform/ui/UiCheckbox.vue";
import KeyHeroIcon from "../../platform/ui/UiHeroIcon.vue";
import ModelField from "./ModelFormFieldComponent.vue";
import ModelProviderFields from "./ModelProviderFieldsComponent.vue";
import ModelResourceDelete from "./ModelResourceDeleteDialogComponent.vue";
import { nextUiIdentity } from "../../platform/ui/UiIdentity";
import { Providers, providerLogoMap } from "../../providers/data/ProviderCatalogData";
import notification from "../../notifications/logic/NotificationManager";
import { createCredentialPayload, updateCredentialPayload } from "../logic/CredentialPayloadLogic";
import { modelsApi } from "../api/ModelsApi";
import { modelString, type ModelCredential, type ModelCatalog } from "../support/ModelModels";
const props = defineProps<{ catalog: ModelCatalog }>();
const emit = defineEmits<{ changed: [] }>();
const edit = ref<ModelCredential | null>(null),
	editorOpen = ref(false),
	details = ref<ModelCredential | null>(null),
	toDelete = ref<ModelCredential | null>(null);
const values = ref<Record<string, unknown>>({}),
	touched = new Set<string>(),
	deleted = ref<string[]>([]),
	errors = ref<Record<string, string>>({}),
	pending = ref(false);
const prefix = nextUiIdentity("credential");
const detailEntries = computed(() => [
	{ label: "Name", value: details.value?.credential_name ?? "—", mono: false },
	{ label: "Provider", value: details.value?.credential_info.custom_llm_provider ?? "—", mono: false },
	...Object.entries(details.value?.credential_info ?? {})
		.filter(([key, value]) => key !== "custom_llm_provider" && value !== undefined)
		.map(([label, value]) => ({ label, value: typeof value === "object" ? JSON.stringify(value) : String(value), mono: false })),
	...Object.entries(details.value?.credential_values ?? {}).map(([label, value]) => ({
		label,
		value: typeof value === "object" ? JSON.stringify(value) : String(value ?? "—"),
		mono: true,
	})),
]);
const providerOptions = Object.entries(Providers).map(([value, label]) => ({ value, label }));
const sensitive = computed(() =>
	Object.keys(edit.value?.credential_values ?? {}).filter((key) => /(?:key|token|secret|credential|password)/i.test(key)),
);
const currentProvider = computed(() => modelString(values.value.custom_llm_provider) || "OpenAI");
function open(credential?: ModelCredential) {
	edit.value = credential ?? null;
	values.value = credential
		? {
				credential_name: credential.credential_name,
				custom_llm_provider: credential.credential_info.custom_llm_provider,
				...credential.credential_values,
			}
		: { custom_llm_provider: "OpenAI" };
	errors.value = {};
	deleted.value = [];
	touched.clear();
	editorOpen.value = true;
}
function set(key: string, value: unknown) {
	values.value = { ...values.value, [key]: value };
	touched.add(key);
}
function provider(value: unknown) {
	const next = modelString(value);
	if (edit.value && next.toLowerCase() !== currentProvider.value.toLowerCase())
		for (const key of Object.keys(values.value))
			if (!["credential_name", "custom_llm_provider"].includes(key)) values.value[key] = undefined;
	set("custom_llm_provider", next);
}
async function save() {
	errors.value = {};
	if (!values.value.credential_name) errors.value.credential_name = "Credential name is required";
	if (!values.value.custom_llm_provider) errors.value.custom_llm_provider = "Required";
	const meta = props.catalog.providerFields.find(
		(item) => item.provider === currentProvider.value || item.provider_display_name === currentProvider.value,
	);
	for (const field of meta?.credential_fields ?? [])
		if (field.required && !values.value[field.key] && !(edit.value && field.key in edit.value.credential_values))
			errors.value[field.key] = "Required";
	if (Object.keys(errors.value).length) return;
	pending.value = true;
	try {
		if (edit.value)
			await modelsApi.updateCredential(
				edit.value.credential_name,
				updateCredentialPayload(values.value, touched, edit.value, deleted.value),
			);
		else await modelsApi.saveCredential(createCredentialPayload(values.value));
		notification.success(edit.value ? "Credential updated successfully" : "Credential added successfully");
		editorOpen.value = false;
		emit("changed");
	} catch (error) {
		notification.error(error instanceof Error ? error.message : "Failed to save credential");
	} finally {
		pending.value = false;
	}
}
async function remove() {
	if (!toDelete.value || pending.value) return;
	pending.value = true;
	try {
		await modelsApi.removeCredential(toDelete.value.credential_name);
		notification.success("Credential deleted successfully");
		emit("changed");
	} catch (error) {
		notification.error(error instanceof Error ? error.message : "Failed to delete credential");
	} finally {
		toDelete.value = null;
		pending.value = false;
	}
}
function toggleDelete(key: string, checked: boolean) {
	deleted.value = checked ? [...deleted.value, key] : deleted.value.filter((item) => item !== key);
}
</script>
<template>
	<div class="model-credentials">
		<UiButton appearance="tremor" variant="primary" @click="open()">Add Credential</UiButton>
		<p class="model-credentials__description">
			Configured credentials for different AI providers. Add and manage your API credentials.
		</p>
		<UiCard
			><div class="model-table-overflow">
				<table class="model-simple-table">
					<thead>
						<tr>
							<th>Credential Name</th>
							<th>Provider</th>
							<th>Actions</th>
						</tr>
					</thead>
					<tbody>
						<tr v-if="!catalog.credentials.length">
							<td colspan="4" class="model-table-empty">No credentials configured</td>
						</tr>
						<tr v-for="credential in catalog.credentials" :key="credential.credential_name">
							<td>
								<button class="model-link" @click="details = credential">{{ credential.credential_name }}</button>
							</td>
							<td>
								<span
									class="model-badge"
									:class="
										'model-badge--' +
										({ openai: 'blue', azure: 'indigo', anthropic: 'purple' }[
											modelString(credential.credential_info.custom_llm_provider).toLowerCase()
										] ?? 'gray')
									"
									>{{ credential.credential_info.custom_llm_provider || "-" }}</span
								>
							</td>
							<td>
								<UiButton
									appearance="tremor"
									variant="text"
									size="small"
									:aria-label="'Edit credential ' + credential.credential_name"
									@click="open(credential)"
									><template #icon><KeyHeroIcon name="PencilAltIcon" /></template></UiButton
								><UiButton
									appearance="tremor"
									variant="text"
									size="small"
									:aria-label="'Delete credential ' + credential.credential_name"
									@click="toDelete = credential"
									><template #icon><KeyHeroIcon name="TrashIcon" /></template
								></UiButton>
							</td>
						</tr>
					</tbody>
				</table></div
		></UiCard>
		<UiDialog
			v-if="editorOpen"
			v-model:open="editorOpen"
			:title="edit ? 'Edit Credential' : 'Add New Credential'"
			:width="600"
			scroll-mode="overlay"
			:show-footer="false"
			><form class="model-credential-form" @submit.prevent="save">
				<ModelField label="Credential Name:" :id="prefix + '-name'" required vertical :error="errors.credential_name"
					><UiInput
						:id="prefix + '-name'"
						:model-value="modelString(values.credential_name)"
						appearance="tremor"
						:disabled="!!edit"
						placeholder="Enter a friendly name for these credentials"
						@update:model-value="set('credential_name', $event)"
				/></ModelField>
				<ModelField
					label="Provider:"
					:id="prefix + '-provider'"
					required
					vertical
					tooltip="Helper to auto-populate provider specific fields"
					><UiSelect
						:id="prefix + '-provider'"
						:model-value="currentProvider"
						:options="providerOptions"
						searchable
						@update:model-value="provider"
						><template #value="{ option }"
							><span class="model-credential-provider-option"
								><img
									v-if="providerLogoMap[option.label]"
									class="model-provider-logo"
									:src="providerLogoMap[option.label]"
									alt=""
								/>{{ option.label }}</span
							></template
						>
						<template #option="{ option }"
							><span class="model-credential-provider-option"
								><img
									v-if="providerLogoMap[option.label]"
									class="model-provider-logo"
									:src="providerLogoMap[option.label]"
									alt=""
								/>{{ option.label }}</span
							></template
						></UiSelect
					></ModelField
				>
				<ModelProviderFields
					v-model="values"
					:provider="currentProvider"
					:catalog="catalog"
					:id-prefix="prefix"
					:errors="errors"
					vertical
					:edit="!!edit"
					:configured="Object.keys(edit?.credential_values ?? {})"
					@touched="touched.add($event)"
				/>
				<div v-for="key in sensitive" :key="key" class="model-field model-credential-secret-delete">
					<UiCheckbox :model-value="deleted.includes(key)" @update:model-value="toggleDelete(key, $event)"
						>Delete stored {{ key }}</UiCheckbox
					>
				</div>
				<div class="model-form-footer">
					<UiTooltip title="Get help on our github"
						><a href="https://github.com/BerriAI/litellm/issues" target="_blank" rel="noreferrer">Need Help?</a></UiTooltip
					>
					<div>
						<UiButton @click="editorOpen = false">Cancel</UiButton
						><UiButton type="submit" :loading="pending">{{ edit ? "Update Credential" : "Add Credential" }}</UiButton>
					</div>
				</div>
			</form></UiDialog
		>
		<UiDrawer
			:open="!!details"
			:title="details?.credential_name ?? 'Credential details'"
			class="model-detail-drawer"
			@update:open="!$event && (details = null)"
		>
			<template #title>
				<div class="model-credential-heading">
					<div>{{ details?.credential_name }}</div>
					<div class="model-inline">
						<UiButton appearance="tremor" @click="details && open(details)">Edit</UiButton>
						<UiButton appearance="tremor" danger @click="toDelete = details">Delete</UiButton>
					</div>
				</div>
			</template>
			<dl class="model-credential-descriptions">
				<div v-for="entry in detailEntries" :key="entry.label">
					<dt>{{ entry.label }}</dt>
					<dd>
						<span :class="{ 'model-mono model-credential-value': entry.mono }">{{ entry.value }}</span>
					</dd>
				</div>
			</dl></UiDrawer
		>
		<ModelResourceDelete
			:open="!!toDelete"
			title="Delete Credential?"
			message="Are you sure you want to delete this credential? This action cannot be undone and may break existing integrations."
			information-title="Credential Information"
			:information="[
				{ label: 'Credential Name', value: toDelete?.credential_name },
				{ label: 'Provider', value: toDelete?.credential_info.custom_llm_provider || '-' },
			]"
			:required-confirmation="toDelete?.credential_name"
			:pending="pending"
			@update:open="!$event && (toDelete = null)"
			@confirm="remove"
		/>
	</div>
</template>
