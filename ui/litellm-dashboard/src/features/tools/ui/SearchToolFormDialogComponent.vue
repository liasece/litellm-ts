<script setup lang="ts">
import { ref, watch } from "vue";
import UiDialog from "../../platform/ui/UiDialog.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiFormField from "../../platform/ui/UiFormField.vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import SearchConnectionResultComponent from "./SearchConnectionResultComponent.vue";
import { searchToolsApi } from "../api/SearchToolsApi";
import { searchDraft, searchDraftErrors, searchToolPayload } from "../logic/SearchToolLogic";
import type { SearchTool, SearchProvider, SearchDraft } from "../support/SearchToolModels";
const open = defineModel<boolean>("open", { required: true });
const props = defineProps<{ tool?: SearchTool | null; providers: SearchProvider[] }>();
const emit = defineEmits<{ saved: []; notice: [message: string]; error: [message: string] }>();
const draft = ref<SearchDraft>({}),
	errors = ref<Record<string, string>>({}),
	pending = ref(false),
	testing = ref(false),
	testOpen = ref(false),
	passwordVisible = ref(false),
	testVersion = ref(0),
	testParams = ref<Record<string, unknown>>({});
watch(open, (value) => {
	if (value) {
		draft.value = searchDraft(props.tool ?? undefined);
		errors.value = {};
	}
});
async function submit() {
	errors.value = searchDraftErrors(draft.value, Boolean(props.tool));
	if (Object.keys(errors.value).length) return;
	pending.value = true;
	try {
		if (props.tool?.search_tool_id) await searchToolsApi.update(props.tool.search_tool_id, searchToolPayload(draft.value));
		else await searchToolsApi.create(searchToolPayload(draft.value));
		emit("notice", props.tool ? "Search tool updated successfully" : "Search tool created successfully");
		emit("saved");
		open.value = false;
	} catch (error) {
		emit("error", props.tool ? "Failed to update search tool" : "Error creating search tool: " + String(error));
	} finally {
		pending.value = false;
	}
}
function test() {
	errors.value = searchDraftErrors(draft.value, false, true);
	if (Object.keys(errors.value).length) {
		emit("error", "Please fill in Search Provider and API Key before testing");
		return;
	}
	testParams.value = { search_provider: draft.value.search_provider, api_key: draft.value.api_key, api_base: draft.value.api_base };
	++testVersion.value;
	testing.value = true;
	testOpen.value = true;
}
function hideImage(event: Event) {
	if (event.target instanceof HTMLImageElement) event.target.style.display = "none";
}
</script>
<template>
	<UiDialog
		scroll-mode="overlay"
		v-model:open="open"
		:title="tool ? 'Edit Search Tool' : undefined"
		:width="tool ? 600 : 800"
		:show-footer="Boolean(tool)"
		:class="{ 'tools-search-create-dialog': !tool }"
		@ok="submit"
	>
		<template v-if="!tool" #title
			><div class="tools-search-create-title">
				<span>🔍</span>
				<h2>Add New Search Tool</h2>
			</div></template
		>
		<form class="tools-search-form" :class="{ 'tools-search-form--create': !tool }" @submit.prevent="submit">
			<UiFormField for="search-tool-name" label="Search Tool Name" required :error="errors.search_tool_name">
				<template v-if="!tool" #label
					>Search Tool Name<UiTooltip
						title="A unique name to identify this search tool configuration (e.g., 'perplexity-search', 'tavily-news-search')."
						><UiIcon name="InfoCircleOutlined" /></UiTooltip
				></template>
				<UiInput
					id="search-tool-name"
					v-model="draft.search_tool_name"
					:appearance="tool ? 'antd' : 'tremor'"
					:placeholder="tool ? 'e.g., my-perplexity-search' : 'e.g., perplexity-search, my-tavily-tool'"
				/>
			</UiFormField>
			<UiFormField for="search-tool-provider" label="Search Provider" required :error="errors.search_provider">
				<template v-if="!tool" #label
					>Search Provider<UiTooltip
						title="Select the search provider you want to use. Each provider has different capabilities and pricing."
						><UiIcon name="InfoCircleOutlined" /></UiTooltip
				></template>
				<UiSelect
					id="search-tool-provider"
					v-model="draft.search_provider"
					:options="providers.map((p) => ({ value: p.provider_name, label: p.ui_friendly_name }))"
					placeholder="Select a search provider"
					:status="errors.search_provider ? 'error' : undefined"
					:size="tool ? 'middle' : 'large'"
					:searchable="!tool"
					><template #option="{ option }"
						><div class="tools-provider-label">
							<img
								v-if="!tool"
								:src="'/ui/assets/logos/' + option.value + '.png'"
								alt=""
								width="20"
								height="20"
								@error="hideImage"
							/>{{ option.label }}
						</div></template
					></UiSelect
				>
			</UiFormField>
			<UiFormField for="search-tool-api-key" label="API Key" :help="tool ? 'API key for the search provider' : undefined">
				<template v-if="!tool" #label
					>API Key<UiTooltip title="The API key for authenticating with the search provider. This will be securely stored."
						><UiIcon name="InfoCircleOutlined" /></UiTooltip
				></template>
				<div :class="{ 'tools-search-password': Boolean(tool) }">
					<UiInput
						id="search-tool-api-key"
						v-model="draft.api_key"
						:type="passwordVisible ? 'text' : 'password'"
						:appearance="tool ? 'antd' : 'tremor'"
						:placeholder="tool ? 'Enter API key' : 'Enter your API key'"
					/><button
						v-if="tool"
						type="button"
						:aria-label="passwordVisible ? 'Hide password' : 'Show password'"
						@click="passwordVisible = !passwordVisible"
					>
						<UiIcon :name="passwordVisible ? 'EyeOutlined' : 'EyeInvisibleOutlined'" />
					</button>
				</div>
			</UiFormField>
			<UiFormField for="search-tool-description" :label="tool ? 'Description' : 'Description (Optional)'"
				><UiInput
					id="search-tool-description"
					v-model="draft.description"
					multiline
					:rows="3"
					:placeholder="tool ? 'Description of this search tool' : 'Brief description of this search tool\'s purpose'"
			/></UiFormField>
			<footer v-if="!tool" class="tools-search-create-footer">
				<a href="https://github.com/BerriAI/litellm/issues" target="_blank" rel="noopener noreferrer" title="Get help on our github"
					>Need Help?</a
				>
				<div class="tools-tags">
					<UiButton appearance="tremor" variant="primary" :loading="testing" @click="test">Test Connection</UiButton
					><UiButton type="submit" appearance="tremor" variant="primary" :loading="pending">Add Search Tool</UiButton>
				</div>
			</footer>
		</form></UiDialog
	>
	<UiDialog
		scroll-mode="overlay"
		v-model:open="testOpen"
		title="Connection Test Results"
		:width="700"
		@update:open="!$event && (testing = false)"
		><SearchConnectionResultComponent
			v-if="testOpen"
			:key="testVersion"
			:params="testParams"
			@complete="testing = false"
			@success="emit('notice', 'Connection test successful!')"
		/><template #footer
			><UiButton
				appearance="tremor"
				variant="primary"
				@click="
					testOpen = false;
					testing = false;
				"
				>Close</UiButton
			></template
		></UiDialog
	>
</template>
