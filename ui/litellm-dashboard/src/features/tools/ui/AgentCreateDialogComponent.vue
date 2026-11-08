<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import UiDialog from "../../platform/ui/UiDialog.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import UiFormField from "../../platform/ui/UiFormField.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiTag from "../../platform/ui/UiTag.vue";
import AccessFieldComponent from "../../access-control/ui/AccessFieldComponent.vue";
import AccessNoticeComponent from "../../access-control/ui/AccessNoticeComponent.vue";
import KeySecretDisplayComponent from "../../virtual-keys/ui/KeySecretDisplayComponent.vue";
import AgentFieldsComponent from "./AgentFieldsComponent.vue";
import AgentEntitlementsComponent from "./AgentEntitlementsComponent.vue";
import AgentGovernanceComponent from "./AgentGovernanceComponent.vue";
import AgentKeyStepComponent from "./AgentKeyStepComponent.vue";
import { agentsApi } from "../api/AgentsApi";
import { createAgentCreateStore } from "../stores/AgentCreateStore";
const open = defineModel<boolean>("open", { required: true });
const emit = defineEmits<{ saved: [] }>();
const store = createAgentCreateStore(),
	{ draft, options, entitlements, state, metadata, keys } = store,
	models = ref<string[]>([]),
	agents = ref<{ agent_id: string; agent_name: string }[]>([]);
const info = computed(() => metadata.value.find((item) => item.agent_type === options.value.type)),
	logo = computed(() =>
		options.value.type === "custom" ? null : info.value?.logo_url || metadata.value.find((item) => item.agent_type === "a2a")?.logo_url,
	),
	steps = ["Configure", "Entitlements", "Governance", "Agent Management", "Ready"];
watch(open, (value) => {
	if (value) store.reset();
});
watch(
	() => state.step,
	(step) => {
		if (step === 1 || step === 3)
			void agentsApi.models().then((value) => {
				models.value = value;
			});
		if (step === 1)
			void agentsApi.list(false).then((value) => {
				agents.value = value;
			});
		if (step === 3 && !keys.value.length)
			void agentsApi.keys(100).then((value) => {
				keys.value = value;
			});
	},
);
onMounted(() => {
	void agentsApi
		.metadata()
		.then((value) => {
			metadata.value = value;
		})
		.catch((error) => {
			state.error = error instanceof Error ? error.message : "Failed to load agent configuration";
		});
});
async function create() {
	if (await store.create()) emit("saved");
}
function selected(value: string | number | Array<string | number> | null | undefined) {
	if (typeof value === "string") store.changeType(value);
}
function close() {
	open.value = false;
	store.reset();
}
</script>
<template>
	<UiDialog
		scroll-mode="overlay"
		:open="open"
		:width="900"
		:show-footer="false"
		class="tools-agent-create-dialog"
		@update:open="!$event && close()"
		><template #title
			><div class="tools-agent-create-title">
				<img v-if="logo && state.step < 1" :src="logo" alt="Agent" width="24" height="24" />
				<h2>Add New Agent</h2>
			</div></template
		>
		<div class="tools-agent-create-body">
			<AccessNoticeComponent :error="state.error" />
			<ol class="tools-agent-steps">
				<li
					v-for="(step, index) in steps"
					:key="step"
					:class="{ 'tools-agent-step-current': state.step === index, 'tools-agent-step-complete': state.step > index }"
				>
					<span
						><UiIcon v-if="state.step > index" name="CheckOutlined" /><template v-else>{{ index + 1 }}</template></span
					><strong>{{ step }}</strong>
				</li>
			</ol>
			<form @submit.prevent="state.step === 3 ? create() : store.next()">
				<template v-if="state.step === 0"
					><UiFormField label="Agent Type" required
						><UiSelect
							:model-value="options.type"
							:options="
								metadata.map((item) => ({
									value: item.agent_type,
									label: item.agent_type_display_name,
									description: item.description || undefined,
								}))
							"
							size="large"
							@update:model-value="selected"
							><template #option="{ option }"
								><div class="tools-agent-type-option">
									<img
										:src="metadata.find((item) => item.agent_type === option.value)?.logo_url || ''"
										:alt="option.label"
										width="20"
										height="20"
									/>
									<div>
										<strong>{{ option.label }}</strong
										><small>{{ option.description }}</small>
									</div>
								</div></template
							><template #footer
								><div class="tools-agent-custom-option">
									<small>NOT LISTED?</small
									><button type="button" @click="store.changeType('custom')">
										<UiIcon name="AppstoreOutlined" />
										<div>
											<strong>Custom / Other <UiTag color="orange">GENERIC</UiTag></strong
											><span>For agents that don't follow a standard protocol — just needs a virtual key</span>
										</div>
									</button>
								</div></template
							></UiSelect
						></UiFormField
					>
					<div class="tools-agent-configure-fields">
						<template v-if="options.type === 'custom'"
							><AccessFieldComponent
								v-model="draft.agent_name"
								label="Agent Name"
								name="custom-agent-name"
								required
								placeholder="e.g. my-custom-agent"
								:error="state.errors.agent_name" /><AccessFieldComponent
								v-model="draft.description"
								label="Description"
								name="custom-agent-description"
								type="textarea"
								:rows="3"
								placeholder="Describe what this agent does…" /></template
						><template v-else-if="options.type === 'a2a' || info?.use_a2a_form_fields"
							><AgentFieldsComponent v-model="draft" :errors="state.errors" />
							<section v-if="info?.use_a2a_form_fields && info.credential_fields.length" class="tools-agent-extra-settings">
								<h4>{{ info.agent_type_display_name }} Settings</h4>
								<AgentFieldsComponent v-model="draft" :type-info="info" dynamic credentials-only /></section></template
						><AgentFieldsComponent
							v-else-if="info"
							v-model="draft"
							:type-info="info"
							dynamic
							:errors="state.errors"
						/></div></template
				><AgentEntitlementsComponent
					v-else-if="state.step === 1"
					v-model="entitlements"
					:models="models"
					:agents="agents"
				/><AgentGovernanceComponent v-else-if="state.step === 2" v-model="options" v-model:draft="draft" /><AgentKeyStepComponent
					v-else-if="state.step === 3"
					v-model="options"
					v-model:draft="draft"
					:keys="keys"
				/>
				<div v-else class="tools-agent-ready">
					<UiIcon name="CheckCircleFilled" :size="48" />
					<h3>Agent Created!</h3>
					<UiTag color="purple"><UiIcon name="RobotOutlined" />{{ state.createdName }}</UiTag>
					<div v-if="state.secret" class="tools-agent-created-secret"><KeySecretDisplayComponent :value="state.secret" /></div>
					<p v-if="state.assignedAlias">
						Key <strong>{{ state.assignedAlias }}</strong> has been assigned to this agent.
					</p>
					<p v-if="!state.secret && !state.assignedAlias && options.keyOption === 'skip'">
						No key assigned. You can create one from the Virtual Keys page.
					</p>
				</div>
				<footer class="tools-agent-wizard-footer">
					<div>
						<button v-if="state.step > 0 && state.step < 4" type="button" @click="state.step = Math.max(0, state.step - 1)">
							← Back
						</button>
					</div>
					<div>
						<UiButton v-if="state.step < 4" appearance="tremor" @click="close">Cancel</UiButton
						><UiButton v-if="state.step < 3" type="submit" appearance="tremor" variant="primary">Next →</UiButton
						><UiButton
							v-else-if="state.step === 3"
							type="submit"
							appearance="tremor"
							variant="primary"
							:loading="state.pending"
							>{{ state.pending ? "Creating..." : "Create Agent →" }}</UiButton
						><UiButton v-else appearance="tremor" variant="primary" @click="close">Done</UiButton>
					</div>
				</footer>
			</form>
		</div></UiDialog
	>
</template>
