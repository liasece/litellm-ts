<script setup lang="ts">
import notificationManager from "../../notifications/logic/NotificationManager";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useAuthenticationStore } from "../../identity/stores/AuthenticationStore";
import UiAlert from "../../platform/ui/UiAlert.vue";
import UiDialog from "../../platform/ui/UiDialog.vue";
import UiTabs from "../../platform/ui/UiTabs.vue";
import { virtualKeysApi } from "../api/VirtualKeysApi";
import { canModifyVirtualKey } from "../logic/KeyPermissionLogic";
import type { KeyCatalog, VirtualKey } from "../support/VirtualKeyModels";
import KeyDetailHeader from "./KeyDetailHeaderComponent.vue";
import KeyOverview from "./KeyOverviewComponent.vue";
import KeySettingsSummary from "./KeySettingsSummaryComponent.vue";
import KeyEditForm from "./KeyEditFormComponent.vue";
import KeyDeleteDialog from "./KeyDeleteDialogComponent.vue";
import KeyRegenerateDialog from "./KeyRegenerateDialogComponent.vue";
import "./styles/VirtualKeyDetails.css";
const props = defineProps<{ keyData: VirtualKey; catalog: KeyCatalog; backButtonText?: string }>();
const emit = defineEmits<{ updated: [response: Record<string, unknown>]; deleted: [token: string]; close: [] }>();
const auth = useAuthenticationStore();
const current = ref<VirtualKey>({ ...props.keyData });
const tab = ref("overview");
const editing = ref(false);
const deleting = ref(false);
const regenerating = ref(false);
const pending = ref(false);
const error = ref("");
const editError = ref("");
const message = ref("");
const lastRegeneratedAt = ref<Date | null>(null);
const recentlyRegenerated = ref(false);
let timer: ReturnType<typeof setTimeout> | null = null;
const canModify = computed(() =>
	canModifyVirtualKey(current.value, auth.userRole.value, auth.state.session?.user_id || "", props.catalog.teams),
);
watch(
	() => props.keyData,
	(value) => {
		current.value = { ...value };
		tab.value = "overview";
		editing.value = false;
		error.value = "";
		message.value = "";
	},
	{ immediate: true },
);
function edit() {
	if (canModify.value) {
		editError.value = "";
		editing.value = true;
	}
}
function updated(response: Record<string, unknown>) {
	current.value = { ...current.value, ...response };
	emit("updated", response);
}
async function save(payload: Record<string, unknown>) {
	if (!canModify.value || pending.value) return;
	pending.value = true;
	editError.value = "";
	try {
		const result = await virtualKeysApi.updateKey(payload);
		updated(result);
		editing.value = false;
		message.value = "Key updated successfully";
		notificationManager.success("Key updated successfully");
	} catch (reason: unknown) {
		editError.value = reason instanceof Error ? reason.message : "Error updating key";
		notificationManager.fromBackend(reason);
	} finally {
		pending.value = false;
	}
}
function regenerated(response: Record<string, unknown>) {
	updated(response);
	lastRegeneratedAt.value = new Date();
	recentlyRegenerated.value = true;
	if (timer) clearTimeout(timer);
	timer = setTimeout(() => (recentlyRegenerated.value = false), 5000);
}
onBeforeUnmount(() => {
	if (timer) clearTimeout(timer);
});
defineExpose({ edit });
</script>
<template>
	<div class="vk-detail-content">
		<UiAlert v-if="error" type="error" class="vk-detail-notice">{{ error }}</UiAlert>
		<p v-if="message" role="status" class="vk-screen-reader-status">{{ message }}</p>
		<KeyDetailHeader
			:key-data="current"
			:can-modify="canModify"
			:premium="auth.state.session?.premium_user || false"
			:back-button-text="backButtonText"
			@back="emit('close')"
			@regenerate="regenerating = true"
			@remove="deleting = true"
		/>
		<UiTabs
			v-model="tab"
			appearance="tremor"
			:items="[
				{ key: 'overview', label: 'Overview' },
				{ key: 'settings', label: 'Settings' },
			]"
			class="vk-detail-tabs"
		/>
		<KeyOverview v-if="tab === 'overview'" :key-data="current" :catalog="catalog" />
		<KeySettingsSummary
			v-else
			:key-data="current"
			:catalog="catalog"
			:last-regenerated-at="lastRegeneratedAt"
			:recently-regenerated="recentlyRegenerated"
		/>
		<UiDialog
			v-model:open="editing"
			title="Edit Virtual Key"
			width="min(960px,100vw)"
			:show-footer="false"
			scroll-mode="overlay"
			class="vk-edit-modal"
			><KeyEditForm
				v-if="editing"
				:key-data="current"
				:catalog="catalog"
				:pending="pending"
				:error="editError"
				@save="save"
				@cancel="editing = false"
		/></UiDialog>
		<KeyDeleteDialog v-model:open="deleting" :key-data="current" @deleted="emit('deleted', $event)" />
		<KeyRegenerateDialog v-model:open="regenerating" :key-data="current" @updated="regenerated" />
	</div>
</template>
