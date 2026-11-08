<script setup lang="ts">
import { computed, ref, reactive, onBeforeUnmount, watch } from "vue";
import UiDrawer from "../../platform/ui/UiDrawer.vue";
import UiTabs from "../../platform/ui/UiTabs.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiLucideIcon from "../../platform/ui/UiLucideIcon.vue";
import { useAuthenticationStore } from "../../identity/stores/AuthenticationStore";
import { promptsApi } from "../api/PromptsApi";
import { getBasePromptId, getCurrentVersion, extractPromptModel, promptVariables } from "../logic/PromptDisplayLogic";
import { notificationManager } from "../../notifications/logic/NotificationManager";
import { copyToolText } from "../../tools/support/ToolClipboardSupport";
import type { PromptInfoResponse } from "../support/PromptModels";
import PromptCodeDialogComponent from "./PromptCodeDialogComponent.vue";
import PromptDeleteDialogComponent from "./PromptDeleteDialogComponent.vue";
import PromptDetailsPanelsComponent from "./PromptDetailsPanelsComponent.vue";
const props = defineProps<{ promptId: string; admin: boolean }>(),
	emit = defineEmits<{ close: []; deleted: []; edit: [value: PromptInfoResponse] }>(),
	auth = useAuthenticationStore(),
	response = ref<PromptInfoResponse | null>(null),
	loading = ref(true),
	tab = ref("overview"),
	copied = reactive<Record<string, boolean>>({}),
	deleting = ref(false),
	pending = ref(false),
	base = computed(() => getBasePromptId(response.value?.prompt_spec)),
	version = computed(() => getCurrentVersion(response.value?.prompt_spec)),
	tabs = computed(() => [
		{ key: "overview", label: "Overview" },
		...(response.value?.raw_prompt_template ? [{ key: "template", label: "Prompt Template" }] : []),
		...(props.admin ? [{ key: "details", label: "Details" }] : []),
		{ key: "raw", label: "Raw JSON" },
	]);
let generation = 0;
const timers = new Set<ReturnType<typeof setTimeout>>();
watch(
	() => [props.promptId, auth.isAuthorized.value],
	async () => {
		const current = ++generation;
		loading.value = true;
		if (!auth.isAuthorized.value) {
			response.value = null;
			loading.value = false;
			return;
		}
		try {
			const value = await promptsApi.detail(props.promptId);
			if (current === generation) response.value = value;
		} catch {
			if (current === generation) {
				response.value = null;
				notificationManager.fromBackend("Failed to load prompt information");
			}
		} finally {
			if (current === generation) loading.value = false;
		}
	},
	{ immediate: true },
);
async function copy(text: string, key: string) {
	if (!(await copyToolText(text))) return;
	copied[key] = true;
	const timer = setTimeout(() => {
		copied[key] = false;
		timers.delete(timer);
	}, 2000);
	timers.add(timer);
}
async function remove() {
	if (!auth.isAuthorized.value) return;
	pending.value = true;
	try {
		await promptsApi.delete(base.value);
		notificationManager.success('Prompt "' + base.value + '" deleted successfully');
		emit("deleted");
		emit("close");
	} catch {
		notificationManager.fromBackend("Failed to delete prompt");
	} finally {
		pending.value = false;
		deleting.value = false;
	}
}
onBeforeUnmount(() => {
	++generation;
	for (const timer of timers) clearTimeout(timer);
});
</script>
<template>
	<UiDrawer open aria-label="Prompt Details" class="prompt-details-drawer" @close="emit('close')"
		><template #title
			><div class="prompt-details-title">
				<div>
					<div>Prompt Details</div>
					<small v-if="response && !loading">{{ base }}</small>
				</div>
				<div v-if="response && !loading">
					<PromptCodeDialogComponent
						:prompt-id="base"
						:model="extractPromptModel(response.prompt_spec) || 'gpt-4o'"
						:prompt-variables="promptVariables(response.raw_prompt_template?.content)"
						:version="version"
					/><UiButton @click="emit('edit', response)">Edit</UiButton
					><UiButton v-if="admin" danger @click="deleting = true">Delete</UiButton>
				</div>
			</div></template
		>
		<div v-if="loading" class="prompt-details-loading"><UiIcon name="LoadingOutlined" :size="14" /></div>
		<div v-else-if="!response" class="prompt-details-not-found">Prompt not found</div>
		<div v-else class="prompt-details-body">
			<div class="prompt-identifier-bar">
				<span>{{ base }}</span
				><UiButton variant="text" size="small" aria-label="Copy prompt ID" @click="copy(base, 'prompt-id')"
					><template #icon><UiLucideIcon :name="copied['prompt-id'] ? 'CheckIcon' : 'CopyIcon'" :size="12" /></template
				></UiButton>
			</div>
			<UiTabs v-model="tab" appearance="tremor" :items="tabs" /><PromptDetailsPanelsComponent
				:response="response"
				:tab="tab"
				:prompt-id="base"
				:version="version"
				:copied="copied"
				@copy="copy"
			/><PromptDeleteDialogComponent v-model:open="deleting" :prompt-id="base" :pending="pending" @confirm="remove" /></div
	></UiDrawer>
</template>
