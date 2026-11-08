<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from "vue";
import UiTabs from "../../platform/ui/UiTabs.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiPopover from "../../platform/ui/UiPopover.vue";
import { useAuthenticationStore } from "../../identity/stores/AuthenticationStore";
import { isAdminRole } from "../../identity/logic/UserRoleLogic";
import { createGuardrailsStore } from "../stores/GuardrailsStore";
import { getGuardrailLogoAndName } from "../logic/GuardrailProviderLogic";
import { legacyGuardrailText } from "../support/GuardrailClipboardSupport";
import GuardrailDeleteDialogComponent from "./GuardrailDeleteDialogComponent.vue";
import GuardrailGardenComponent from "./garden/GuardrailGardenComponent.vue";
import GuardrailTableComponent from "./GuardrailTableComponent.vue";
import GuardrailDetailDrawerComponent from "./details/GuardrailDetailDrawerComponent.vue";
import GuardrailCreateDialogComponent from "./editor/GuardrailCreateDialogComponent.vue";
import GuardrailCustomCodeDialogComponent from "./custom-code/GuardrailCustomCodeDialogComponent.vue";
import GuardrailTestPlaygroundComponent from "./test/GuardrailTestPlaygroundComponent.vue";
import GuardrailSubmissionsComponent from "./submissions/GuardrailSubmissionsComponent.vue";
import "../styles/GuardrailsStyles.css";
import "../styles/GuardrailGardenStyles.css";
import "../styles/GuardrailEditorStyles.css";
import "../styles/GuardrailContentStyles.css";
import "../styles/GuardrailDetailsStyles.css";
const auth = useAuthenticationStore(),
	store = createGuardrailsStore(() => auth.isAuthorized.value),
	{ rows, state, deletingRecord } = store,
	popover = ref<InstanceType<typeof UiPopover>>(),
	admin = computed(() => isAdminRole(auth.userRole.value)),
	tabs = computed(() => [
		{ key: "garden", label: "Guardrail Garden" },
		{ key: "guardrails", label: "Guardrails" },
		{ key: "test", label: "Test Playground", disabled: !store.canTest.value },
		{ key: "submissions", label: "Submitted Guardrails" },
	]);
watch(auth.isAuthorized, () => void store.load(), { immediate: true });
function add(custom = false) {
	state.selectedId = "";
	popover.value?.hide();
	if (custom) state.customCode = true;
	else state.add = true;
}
onBeforeUnmount(store.dispose);
</script>
<template>
	<main class="guardrails-page">
		<UiTabs v-model="state.tab" :items="tabs" appearance="tremor" /><GuardrailGardenComponent
			v-if="state.tab === 'garden'"
			@created="store.load"
		/>
		<div v-else-if="state.tab === 'guardrails'">
			<div class="guardrail-list-controls">
				<UiPopover ref="popover" trigger="click" placement="bottomLeft" popup-class="guardrail-add-menu"
					><UiButton appearance="tremor" variant="primary" :disabled="!auth.isAuthorized.value"
						><span>+ Add New Guardrail&nbsp;</span><UiIcon name="DownOutlined" /></UiButton
					><template #content
						><button type="button" @click="add()"><UiIcon name="PlusOutlined" />Add Provider Guardrail</button
						><button type="button" @click="add(true)">
							<UiIcon name="CodeOutlined" />Create Custom Code Guardrail
						</button></template
					></UiPopover
				>
			</div>
			<GuardrailTableComponent
				:rows="rows"
				:loading="state.loading"
				@select="state.selectedId = $event"
				@delete="store.remove"
			/><GuardrailDetailDrawerComponent
				v-if="state.selectedId"
				:key="state.selectedId"
				:guardrail-id="state.selectedId"
				:is-admin="admin"
				@close="state.selectedId = ''"
			/><GuardrailCreateDialogComponent v-model:open="state.add" @created="store.load" /><GuardrailCustomCodeDialogComponent
				v-model:open="state.customCode"
				@saved="store.load"
			/><GuardrailDeleteDialogComponent
				v-model:open="state.deleteOpen"
				title="Delete Guardrail"
				:message="
					'Are you sure you want to delete guardrail: ' + deletingRecord?.guardrail_name + '? This action cannot be undone.'
				"
				information-title="Guardrail Information"
				:information="[
					{ label: 'Name', value: deletingRecord?.guardrail_name },
					{ label: 'ID', value: deletingRecord?.guardrail_id, code: true },
					{
						label: 'Provider',
						value: deletingRecord ? getGuardrailLogoAndName(deletingRecord.litellm_params.guardrail).displayName : undefined,
					},
					{ label: 'Mode', value: legacyGuardrailText(deletingRecord?.litellm_params.mode) },
					{ label: 'Default On', value: deletingRecord?.litellm_params.default_on ? 'Yes' : 'No' },
				]"
				:pending="state.deleting"
				@confirm="store.confirmDelete"
			/>
		</div>
		<GuardrailTestPlaygroundComponent
			v-else-if="state.tab === 'test'"
			:rows="rows"
			:loading="state.loading"
		/><GuardrailSubmissionsComponent v-else />
	</main>
</template>
