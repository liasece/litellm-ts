<script setup lang="ts">
import { ref, watch } from "vue";
import UiDialog from "../../platform/ui/UiDialog.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import AccessFieldComponent from "../../access-control/ui/AccessFieldComponent.vue";
import { claudePluginsApi } from "../api/ClaudePluginsApi";
import { pluginDraft, pluginPayload, validatePluginDraft } from "../logic/PluginDraftLogic";
import { pluginCategories, type ClaudePlugin, type PluginDraft } from "../support/PluginModels";
const open = defineModel<boolean>("open", { required: true });
const props = defineProps<{ plugin?: ClaudePlugin | null }>();
const emit = defineEmits<{ saved: []; error: [message: string] }>();
const draft = ref<PluginDraft>(pluginDraft()),
	errors = ref<Record<string, string>>({}),
	pending = ref(false);
watch(open, (value) => {
	if (value) {
		draft.value = pluginDraft(props.plugin ?? undefined);
		errors.value = {};
	}
});
function sourceChanged() {
	draft.value.repo = undefined;
	draft.value.url = undefined;
	draft.value.path = undefined;
}
async function submit() {
	errors.value = validatePluginDraft(draft.value);
	if (Object.keys(errors.value).length) return;
	pending.value = true;
	try {
		await claudePluginsApi.register(pluginPayload(draft.value));
		emit("saved");
		open.value = false;
	} catch {
		emit("error", "Failed to register plugin");
	} finally {
		pending.value = false;
	}
}
const optionalFields = [
	{ key: "version", label: "Version (Optional)", placeholder: "1.0.0", help: "Semantic version (e.g., 1.0.0)" },
	{
		key: "description",
		label: "Description (Optional)",
		placeholder: "A plugin that helps with...",
		help: "Brief description of what the plugin does",
		type: "textarea",
	},
	{ key: "keywords", label: "Keywords (Optional)", placeholder: "search, web, api", help: "Comma-separated list of keywords for search" },
	{
		key: "authorName",
		label: "Author Name (Optional)",
		placeholder: "Your Name or Organization",
		help: "Name of the plugin author or organization",
	},
	{
		key: "authorEmail",
		label: "Author Email (Optional)",
		placeholder: "author@example.com",
		help: "Contact email for the plugin author",
	},
	{
		key: "homepage",
		label: "Homepage (Optional)",
		placeholder: "https://example.com",
		help: "URL to the plugin's homepage or documentation",
	},
];
</script>
<template>
	<UiDialog
		scroll-mode="overlay"
		v-model:open="open"
		:title="plugin ? 'Edit Claude Code Plugin' : 'Add New Claude Code Plugin'"
		:width="700"
		:show-footer="false"
		class="tools-plugin-dialog"
		><form class="tools-plugin-form" @submit.prevent="submit">
			<AccessFieldComponent
				v-model="draft.name"
				name="plugin-name"
				label="Plugin Name"
				placeholder="my-awesome-plugin"
				required
				:error="errors.name"
				tooltip="Unique identifier in kebab-case format (e.g., my-awesome-plugin)"
			/><AccessFieldComponent
				v-model="draft.sourceType"
				name="plugin-source"
				label="Source Type"
				type="select"
				required
				:options="[
					{ value: 'github', label: 'GitHub' },
					{ value: 'url', label: 'Git URL' },
					{ value: 'git-subdir', label: 'Git Subdir' },
				]"
				@change="sourceChanged"
			/><AccessFieldComponent
				v-if="draft.sourceType === 'github'"
				v-model="draft.repo"
				name="plugin-repo"
				label="GitHub Repository"
				placeholder="anthropics/claude-code"
				required
				:error="errors.repo"
				tooltip="Format: organization/repository (e.g., anthropics/claude-code)"
			/><AccessFieldComponent
				v-else
				v-model="draft.url"
				name="plugin-url"
				label="Git URL"
				placeholder="https://github.com/org/repo.git"
				required
				:error="errors.url"
				tooltip="Full git URL to the repository"
			/><AccessFieldComponent
				v-if="draft.sourceType === 'git-subdir'"
				v-model="draft.path"
				name="plugin-path"
				label="Subdirectory Path"
				placeholder="plugins/plugin-name"
				required
				:error="errors.path"
				tooltip="Path to the plugin directory within the repository (e.g., plugins/plugin-name)"
			/><template v-for="(field, index) in optionalFields" :key="field.key"
				><AccessFieldComponent
					v-model="draft[field.key]"
					:name="'plugin-' + field.key"
					:label="field.label"
					:type="field.type === 'textarea' ? 'textarea' : 'text'"
					:rows="3"
					:placeholder="field.placeholder"
					:error="errors[field.key]"
					:tooltip="field.help" /><AccessFieldComponent
					v-if="index === 1"
					v-model="draft.category"
					name="plugin-category"
					label="Category (Optional)"
					type="select"
					:options="pluginCategories.map((value) => ({ value, label: value }))"
					placeholder="Select or type a category"
					tooltip="Select a category or enter a custom one"
			/></template>
			<footer class="tools-form-footer">
				<UiButton appearance="tremor" :disabled="pending" @click="open = false">Cancel</UiButton
				><UiButton type="submit" appearance="tremor" variant="primary" :loading="pending">{{
					pending ? (plugin ? "Saving..." : "Registering...") : plugin ? "Save Changes" : "Register Plugin"
				}}</UiButton>
			</footer>
		</form></UiDialog
	>
</template>
