<script setup lang="ts">
import { onBeforeUnmount, reactive, ref, watch } from "vue";
import { useAuthenticationStore } from "../../../identity/stores/AuthenticationStore";
import { policiesApi } from "../../api/PoliciesApi";
import { attachmentData, errorText } from "../../logic/PolicyLogic";
import { createPolicyScopeOptionsStore } from "../../stores/PolicyScopeOptionsStore";
import { notificationManager } from "../../../notifications/logic/NotificationManager";
import type { Policy, AttachmentForm, AttachmentImpact } from "../../support/PolicyModels";
import PolicySelectComponent from "../common/PolicySelectComponent.vue";
import PolicyTagInputComponent from "../common/PolicyTagInputComponent.vue";
import PolicyRadioComponent from "../common/PolicyRadioComponent.vue";
import PolicyDividerComponent from "../common/PolicyDividerComponent.vue";
import PolicyImpactPreviewComponent from "./PolicyImpactPreviewComponent.vue";
import UiDialog from "../../../platform/ui/UiDialog.vue";
import UiFormField from "../../../platform/ui/UiFormField.vue";
import UiButton from "../../../platform/ui/UiButton.vue";
import UiTooltip from "../../../platform/ui/UiTooltip.vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
const props = defineProps<{ open: boolean; policies: Policy[] }>(),
	emit = defineEmits<{ close: []; saved: [] }>();
const form = reactive<AttachmentForm>({ policy_names: [], teams: [], keys: [], models: [], tags: [] }),
	scope = ref("global"),
	saving = ref(false),
	estimating = ref(false),
	error = ref(""),
	impact = ref<AttachmentImpact | null>(null),
	options = createPolicyScopeOptionsStore(useAuthenticationStore().state.session?.user_id);
const fields = [
	{
		key: "teams",
		loading: "teamsLoading",
		label: "Teams",
		placeholder: "Select or enter team aliases",
		tooltip: "Select team aliases or enter custom patterns. Supports wildcards (e.g., healthcare-*)",
	},
	{
		key: "keys",
		loading: "keysLoading",
		label: "Keys",
		placeholder: "Select or enter key aliases",
		tooltip: "Select key aliases or enter custom patterns. Supports wildcards (e.g., dev-*)",
	},
	{
		key: "models",
		loading: "modelsLoading",
		label: "Models",
		placeholder: "Select or enter model names (e.g., gpt-4, bedrock/*)",
		tooltip: "Model names this attachment applies to. Supports wildcards (e.g., gpt-4*). Leave empty to apply to all models.",
	},
] as const;
function reset() {
	Object.assign(form, { policy_names: [], teams: [], keys: [], models: [], tags: [] });
	scope.value = "global";
	impact.value = null;
	error.value = "";
}
watch(
	() => props.open,
	(open) => {
		if (open) void options.load();
		else reset();
	},
	{ immediate: true },
);
onBeforeUnmount(options.dispose);
function valid() {
	error.value = form.policy_names.length ? "" : "Please select at least one policy";
	return !error.value;
}
async function preview() {
	if (!valid()) return;
	estimating.value = true;
	try {
		impact.value = await policiesApi.impact(
			attachmentData(form, form.policy_names[0]!, scope.value === "global" ? "global" : "specific"),
		);
	} catch {
		/* Retain the previous preview while an estimate is unavailable. */
	} finally {
		estimating.value = false;
	}
}
async function save() {
	if (!valid()) return;
	saving.value = true;
	try {
		const result = await Promise.allSettled(
				form.policy_names.map((name) =>
					policiesApi.createAttachment(attachmentData(form, name, scope.value === "global" ? "global" : "specific")),
				),
			),
			success = result.filter((r) => r.status === "fulfilled").length,
			failed = result.filter((r): r is PromiseRejectedResult => r.status === "rejected");
		if (success && !failed.length)
			notificationManager.success(success === 1 ? "Attachment created successfully" : success + " attachments created successfully");
		else if (success) notificationManager.fromBackend(success + " attachments created, " + failed.length + " failed");
		else throw failed[0]?.reason instanceof Error ? failed[0].reason : new Error("Failed to create attachments");
		reset();
		emit("saved");
		emit("close");
	} catch (error) {
		notificationManager.fromBackend("Failed to create attachment: " + errorText(error));
	} finally {
		saving.value = false;
	}
}
</script>
<template>
	<UiDialog
		:open="open"
		title="Create Policy Attachment"
		:width="600"
		:show-footer="false"
		scroll-mode="overlay"
		class="policy-form-dialog"
		@update:open="!$event && emit('close')"
		><form @submit.prevent="save">
			<UiFormField label="Policies" required :error="error"
				><PolicySelectComponent
					v-model="form.policy_names"
					:options="policies.map((p) => ({ value: p.policy_name, label: p.policy_name }))"
					multiple
					searchable
					placeholder="Select policies to attach"
			/></UiFormField>
			<PolicyDividerComponent>Scope</PolicyDividerComponent
			><UiFormField label="Scope Type" class="policy-attachment-scope"
				><div class="policy-radios">
					<PolicyRadioComponent v-model="scope" value="specific">Specific (teams, keys, models, or tags)</PolicyRadioComponent
					><PolicyRadioComponent v-model="scope" value="global">Global (applies to all requests)</PolicyRadioComponent>
				</div></UiFormField
			>
			<template v-if="scope === 'specific'"
				><UiFormField v-for="field in fields" :key="field.key" :label="field.label"
					><template #label
						>{{ field.label
						}}<UiTooltip :title="field.tooltip"
							><UiIcon name="QuestionCircleOutlined" class="policy-attachment-label-help" /></UiTooltip></template
					><PolicySelectComponent
						v-model="form[field.key]"
						:options="options.state[field.key].map((value) => ({ value, label: value }))"
						multiple
						searchable
						creatable
						:token-separators="[',']"
						:loading="options.state[field.loading]"
						:placeholder="options.state[field.loading] ? 'Loading ' + field.key + '...' : field.placeholder"
				/></UiFormField>
				<UiFormField label="Tags"
					><template #label
						>Tags<UiTooltip
							title="Match against tags set in key or team metadata. Use exact values (e.g., healthcare) or wildcard patterns (e.g., health-*) where * matches any suffix."
							><UiIcon name="QuestionCircleOutlined" class="policy-attachment-label-help" /></UiTooltip></template
					><PolicyTagInputComponent
						v-model="form.tags"
						placeholder="Type a tag and press Enter (e.g. healthcare, prod-*)"
						:separators="[',', ' ']"
					/>
					<div class="policy-attachment-extra">
						<span class="policy-attachment-extra__text">
							Matches tags from key/team <code>metadata.tags</code> or tags passed dynamically in the request body. Use
							<code>*</code> as a suffix wildcard (e.g., <code>prod-*</code> matches <code>prod-us</code>,
							<code>prod-eu</code>).
						</span>
					</div></UiFormField
				></template
			>
			<PolicyImpactPreviewComponent v-if="impact" :impact="impact" />
			<div class="policy-form-actions">
				<UiButton appearance="tremor" variant="default" @click="emit('close')">Cancel</UiButton
				><UiButton v-if="scope === 'specific'" appearance="tremor" variant="default" :loading="estimating" @click="preview"
					>Estimate Impact</UiButton
				><UiButton variant="primary" appearance="tremor" type="submit" :loading="saving">Create Attachment</UiButton>
			</div>
		</form></UiDialog
	>
</template>

<style>
.policy-attachment-scope > .ui-form-field__control {
	display: flex;
	align-items: center;
	min-height: 32px;
}
.policy-attachment-scope .policy-radio:last-child {
	margin-right: 0;
}
.policy-attachment-label-help {
	margin-inline-start: 4px;
	color: #00000073;
	cursor: help;
}
.policy-attachment-extra {
	min-height: 24px;
	font: 14px/22px var(--ui-font-antd);
	color: #00000073;
}
.policy-attachment-extra__text {
	font-size: 12px;
	line-height: 1.5714285714285714;
}
.policy-attachment-extra__text code {
	margin: 0 0.2em;
	padding: 0.2em 0.4em 0.1em;
	font-size: 85%;
	font-family: SFMono-Regular, Consolas, "Liberation Mono", Menlo, Courier, monospace;
	background: rgba(150, 150, 150, 0.1);
	border: 1px solid rgba(100, 100, 100, 0.2);
	border-radius: 3px;
}
</style>
