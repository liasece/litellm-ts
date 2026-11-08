<script setup lang="ts">
import { computed } from "vue";
import UiDialog from "../../platform/ui/UiDialog.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiLucideIcon from "../../platform/ui/UiLucideIcon.vue";
import { useAuthenticationStore } from "../../identity/stores/AuthenticationStore";
import { notificationManager } from "../../notifications/logic/NotificationManager";
import { createPromptEditorStore } from "../stores/PromptEditorStore";
import { promptVariables } from "../logic/PromptDisplayLogic";
import type { PromptInfoResponse } from "../support/PromptModels";
import PromptCodeDialogComponent from "./PromptCodeDialogComponent.vue";
import PromptModelConfigComponent from "./PromptModelConfigComponent.vue";
import PromptToolsComponent from "./PromptToolsComponent.vue";
import PromptVariableTextareaComponent from "./PromptVariableTextareaComponent.vue";
import PromptMessagesComponent from "./PromptMessagesComponent.vue";
import PromptConversationComponent from "./PromptConversationComponent.vue";
import PromptPublishDialogComponent from "./PromptPublishDialogComponent.vue";
import PromptToolDialogComponent from "./PromptToolDialogComponent.vue";
import PromptHistoryComponent from "./PromptHistoryComponent.vue";
const open = defineModel<boolean>("open", { required: true }),
	props = defineProps<{ initial?: PromptInfoResponse | null }>(),
	emit = defineEmits<{ saved: [] }>(),
	auth = useAuthenticationStore(),
	store = createPromptEditorStore(props.initial),
	{ prompt, state, dotprompt } = store,
	version = computed(() => (state.activeVersionId?.includes(".v") ? "v" + state.activeVersionId.split(".v")[1] : null)),
	variables = computed(() =>
		promptVariables([prompt.value.developerMessage, ...prompt.value.messages.map((message) => message.content)].join(" ")),
	),
	toolJson = computed(() => (state.editingTool !== null ? prompt.value.tools[state.editingTool]?.json : ""));
async function save() {
	if (!auth.isAuthorized.value) {
		notificationManager.fromBackend("Access token is required");
		return;
	}
	if (await store.save()) {
		emit("saved");
		open.value = false;
	}
}
function saveClick() {
	if (!store.needsPublish()) void save();
}
</script>
<template>
	<UiDialog
		v-model:open="open"
		:show-footer="false"
		scroll-mode="overlay"
		width="min(1440px, calc(100vw - 32px))"
		class="prompt-editor-dialog"
		><div class="prompt-editor-root">
			<div class="prompt-editor">
				<header class="prompt-editor-header">
					<div>
						<UiButton appearance="tremor" variant="text" size="small" data-prompt-size="xs" @click="open = false"
							><template #icon><UiLucideIcon name="ArrowLeftIcon" :size="16" /></template>Back</UiButton
						><UiInput v-model="prompt.name" style="width: 200px" /><span v-if="version" class="prompt-editor-version">{{
							version
						}}</span
						><span class="prompt-editor-draft">Draft</span><small>Unsaved changes</small>
					</div>
					<div>
						<PromptCodeDialogComponent
							:prompt-id="prompt.name"
							:model="prompt.model"
							:prompt-variables="variables"
							:version="version?.replace('v', '') || '1'"
						/><UiButton v-if="state.editMode" appearance="tremor" @click="state.history = true"
							><template #icon><UiLucideIcon name="ClockIcon" :size="20" /></template>History</UiButton
						><UiButton appearance="tremor" variant="primary" :loading="state.saving" :disabled="state.saving" @click="saveClick"
							><template #icon><UiLucideIcon name="SaveIcon" :size="20" /></template
							>{{ state.editMode ? "Update" : "Save" }}</UiButton
						>
					</div>
				</header>
				<div class="prompt-editor-columns">
					<div class="prompt-editor-left">
						<div class="prompt-editor-model-bar">
							<PromptModelConfigComponent
								v-model:model="prompt.model"
								v-model:temperature="prompt.config.temperature"
								v-model:max-tokens="prompt.config.max_tokens"
							/>
							<div class="prompt-editor-view-switch">
								<button type="button" :class="{ selected: state.view === 'pretty' }" @click="state.view = 'pretty'">
									PRETTY</button
								><button type="button" :class="{ selected: state.view === 'dotprompt' }" @click="state.view = 'dotprompt'">
									DOTPROMPT
								</button>
							</div>
						</div>
						<div v-if="state.view === 'pretty'" class="prompt-editor-cards">
							<PromptToolsComponent
								:tools="prompt.tools"
								@add="store.editTool()"
								@edit="store.editTool"
								@remove="prompt.tools.splice($event, 1)"
							/><UiCard :padding="12" class="prompt-developer-card"
								><label>Developer message</label>
								<p class="prompt-developer-description">Optional system instructions for the model</p>
								<PromptVariableTextareaComponent
									v-model="prompt.developerMessage"
									placeholder="e.g., You are a helpful assistant..."
									:rows="3" /></UiCard
							><PromptMessagesComponent
								:messages="prompt.messages"
								@add="store.addMessage"
								@update="store.updateMessage"
								@remove="store.removeMessage"
								@move="store.moveMessage"
							/>
						</div>
						<div v-else class="prompt-dotprompt-view">
							<header>
								<h3>Generated .prompt file</h3>
								<p>This is the dotprompt format that will be saved to the database</p>
							</header>
							<div class="prompt-dotprompt-code">
								<pre>{{ dotprompt }}</pre>
							</div>
						</div>
					</div>
					<div class="prompt-editor-right"><PromptConversationComponent :prompt="prompt" /></div>
				</div>
				<PromptPublishDialogComponent
					v-model:open="state.publish"
					v-model:name="prompt.name"
					:pending="state.saving"
					@publish="save"
				/><PromptToolDialogComponent
					v-if="state.toolModal"
					v-model:open="state.toolModal"
					:initial-json="toolJson"
					@save="store.saveTool"
				/><PromptHistoryComponent
					v-model:open="state.history"
					:prompt-id="initial?.prompt_spec.prompt_id || prompt.name"
					:active-version-id="state.activeVersionId"
					@select="store.loadVersion"
				/>
			</div></div
	></UiDialog>
</template>
