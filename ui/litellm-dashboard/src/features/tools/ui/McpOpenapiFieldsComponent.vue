<script setup lang="ts">
import { onMounted, ref, computed } from "vue";
import { mcpApi } from "../api/McpServersApi";
import type { OpenAPIEntry } from "../support/McpModels";
import type { createMcpEditorStore } from "../stores/McpEditorStore";
import McpFieldComponent from "./McpFieldComponent.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
const props = defineProps<{ store: ReturnType<typeof createMcpEditorStore>; editing?: boolean }>();
const presets = ref<OpenAPIEntry[]>([]),
	loading = ref(false),
	selected = ref(""),
	failed = ref(new Set<string>());
const draft = computed(() => props.store.draft.value);
onMounted(async () => {
	if (props.editing) return;
	loading.value = true;
	try {
		presets.value = await mcpApi.openapi();
	} catch {
		presets.value = [];
	} finally {
		loading.value = false;
	}
});
function preset(entry: OpenAPIEntry) {
	selected.value = entry.name;
	props.store.preset(entry);
}
function spec(value: unknown) {
	draft.value.spec_path = value;
	selected.value = "";
	props.store.clearPreset();
}
const format = computed(
	() =>
		({
			bearer_token: "Authorization: Bearer {key}",
			token: "Authorization: token {key}",
			api_key: "x-api-key: {key}",
			basic: "Authorization: Basic {key}",
			authorization: "Authorization: {key}",
		})[String(draft.value.auth_type)] || "",
);
</script>
<template>
	<div v-if="!editing && (presets.length || loading)" class="tools-mcp-presets">
		<label>Popular APIs</label>
		<p v-if="loading" class="tools-mcp-loading">Loading...</p>
		<div v-else class="tools-mcp-preset-grid">
			<button
				v-for="entry in presets"
				:key="entry.name"
				type="button"
				:title="entry.description"
				:class="{ selected: selected === entry.name }"
				@click="preset(entry)"
			>
				<span v-if="failed.has(entry.name)">{{ (entry.title || entry.name).charAt(0) }}</span
				><img v-else :src="entry.icon_url" :alt="entry.title || entry.name" @error="failed.add(entry.name)" /><small>{{
					entry.title || entry.name
				}}</small>
			</button>
		</div>
		<p>Select an API to pre-fill the spec URL and OAuth 2.0 settings, or enter your own spec URL below.</p>
	</div>
	<McpFieldComponent
		:model-value="draft.spec_path"
		label="OpenAPI Spec URL"
		tooltip="URL to an OpenAPI specification (JSON or YAML). MCP tools will be automatically generated from the API endpoints defined in the spec."
		placeholder="https://petstore3.swagger.io/api/v3/openapi.json"
		required
		:error="store.errors.value.spec_path"
		@update:model-value="spec"
	/><template v-if="!editing"
		><McpFieldComponent
			v-model="draft.is_byok"
			label="BYOK (Bring Your Own Key)"
			tooltip="When enabled, each user provides their own API key for this service. Keys are stored per-user and never shared."
			type="switch" /><template v-if="draft.is_byok"
			><aside v-if="draft.auth_type && draft.auth_type !== 'none'" class="tools-mcp-byok-hint">
				<UiIcon name="InfoCircleOutlined" /><span
					>User keys will be sent as: <code>{{ format }}</code></span
				>
			</aside>
			<aside v-else-if="!draft.auth_type" class="tools-mcp-byok-hint tools-mcp-byok-hint--warning">
				<UiIcon name="InfoCircleOutlined" /><span
					>Set the <strong>Authentication Type</strong> below to specify how user keys are sent (e.g., Bearer Token, API Key
					header).</span
				>
			</aside>
			<McpFieldComponent
				v-model="draft.byok_description"
				label="Access Description"
				tooltip="List of permissions shown to users in the connection modal (e.g. 'Create and manage Jira issues')"
				type="select"
				multiple
				creatable
				placeholder="Add access description items (press Enter after each)" /><McpFieldComponent
				v-model="draft.byok_api_key_help_url"
				label="API Key Help URL"
				tooltip="Optional link shown to users to help them find their API key"
				placeholder="https://docs.example.com/api-keys" /></template
	></template>
</template>
