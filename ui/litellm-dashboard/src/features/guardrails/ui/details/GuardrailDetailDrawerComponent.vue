<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from "vue";
import UiDrawer from "../../../platform/ui/UiDrawer.vue";
import UiButton from "../../../platform/ui/UiButton.vue";
import UiTabs from "../../../platform/ui/UiTabs.vue";
import UiSpinner from "../../../platform/ui/UiSpinner.vue";
import UiCard from "../../../platform/ui/UiCard.vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
import UiLucideIcon from "../../../platform/ui/UiLucideIcon.vue";
import { useAuthenticationStore } from "../../../identity/stores/AuthenticationStore";
import { createGuardrailDetailStore } from "../../stores/GuardrailDetailStore";
import { copyGuardrailText } from "../../support/GuardrailClipboardSupport";
import GuardrailOverviewComponent from "./GuardrailOverviewComponent.vue";
import GuardrailSettingsSummaryComponent from "./GuardrailSettingsSummaryComponent.vue";
import GuardrailEditDialogComponent from "./GuardrailEditDialogComponent.vue";
import GuardrailCustomCodeDialogComponent from "../custom-code/GuardrailCustomCodeDialogComponent.vue";
const props = defineProps<{ guardrailId: string; isAdmin: boolean }>(),
	emit = defineEmits<{ close: [] }>(),
	auth = useAuthenticationStore(),
	store = createGuardrailDetailStore(props.guardrailId, () => auth.isAuthorized.value),
	{ state, record } = store,
	copied = ref(false),
	config = computed(() => record.value?.guardrail_definition_location === "config");
let timer: ReturnType<typeof setTimeout> | undefined;
watch(
	auth.isAuthorized,
	() => {
		void store.load();
		void store.metadata();
	},
	{ immediate: true },
);
function edit() {
	if (record.value?.litellm_params.guardrail === "custom_code") state.customCode = true;
	else state.editing = true;
}
async function copy() {
	if (await copyGuardrailText(record.value?.guardrail_id)) {
		copied.value = true;
		clearTimeout(timer);
		timer = setTimeout(() => (copied.value = false), 2000);
	}
}
onBeforeUnmount(() => {
	store.dispose();
	clearTimeout(timer);
});
</script>
<template>
	<UiDrawer :open="true" :title="record?.guardrail_name || 'Guardrail Details'" class="guardrail-detail-drawer" @close="emit('close')"
		><template #title
			><span>{{ record?.guardrail_name || "Guardrail Details" }}</span
			><small v-if="record">{{ record.guardrail_id }}</small></template
		><template #extra
			><UiButton v-if="isAdmin && record && !config" @click="edit">{{
				record.litellm_params.guardrail === "custom_code" ? "Edit Code" : "Edit"
			}}</UiButton></template
		>
		<div v-if="state.loading" class="guardrail-detail-loading"><UiSpinner /></div>
		<div v-else-if="!record" class="guardrail-detail-content">Guardrail not found</div>
		<div v-else class="guardrail-detail-content">
			<div class="guardrail-detail-identifier">
				<h3>{{ record.guardrail_name || "Unnamed Guardrail" }}</h3>
				<div>
					<code>{{ record.guardrail_id }}</code
					><UiButton variant="text" size="small" :class="{ copied }" aria-label="Copy guardrail ID" @click="copy"
						><UiLucideIcon :name="copied ? 'CheckIcon' : 'CopyIcon'" :size="12"
					/></UiButton>
				</div>
			</div>
			<UiTabs
				v-model="state.tab"
				appearance="tremor"
				:items="[{ key: 'overview', label: 'Overview' }, ...(isAdmin ? [{ key: 'settings', label: 'Settings' }] : [])]"
			/><GuardrailOverviewComponent
				v-if="state.tab === 'overview'"
				:record="record"
				:content="store.content.value"
				:permissions="store.permissions.value"
				:is-admin="isAdmin"
				@edit-code="state.customCode = true"
			/><UiCard v-else
				><header class="guardrail-settings-heading">
					<h3>Guardrail Settings</h3>
					<UiIcon
						v-if="config"
						name="InfoCircleOutlined"
						title="Guardrail is defined in the config file and cannot be edited."
					/><UiButton v-if="!state.editing && !config" @click="edit"
						><UiIcon v-if="record.litellm_params.guardrail === 'custom_code'" name="CodeOutlined" />{{
							record.litellm_params.guardrail === "custom_code" ? "Edit Code" : "Edit Settings"
						}}</UiButton
					>
				</header>
				<GuardrailEditDialogComponent v-if="state.editing" :store="store" /><GuardrailSettingsSummaryComponent
					v-else
					:record="record"
					:permissions="store.permissions.value" /></UiCard
			><GuardrailCustomCodeDialogComponent v-model:open="state.customCode" :edit-data="record" @saved="store.load" /></div
	></UiDrawer>
</template>
