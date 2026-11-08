<script setup lang="ts">
import { computed } from "vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import McpFieldComponent from "./McpFieldComponent.vue";
import McpLogoSelectorComponent from "./McpLogoSelectorComponent.vue";
import McpOpenapiFieldsComponent from "./McpOpenapiFieldsComponent.vue";
import McpAuthenticationComponent from "./McpAuthenticationComponent.vue";
import type { createMcpEditorStore } from "../stores/McpEditorStore";
const props = defineProps<{ store: ReturnType<typeof createMcpEditorStore>; editing?: boolean }>();
const draft = computed({ get: () => props.store.draft.value, set: (value) => props.store.setDraft(value) }),
	errors = computed(() => props.store.errors.value);
const transports = [
	{ value: "http", label: "Streamable HTTP (Recommended)" },
	{ value: "sse", label: "Server-Sent Events (SSE)" },
	{ value: "stdio", label: "Standard Input/Output (stdio)" },
	{ value: "openapi", label: "OpenAPI Spec" },
];
const stdioPlaceholder = JSON.stringify(
	{
		mcpServers: {
			"circleci-mcp-server": {
				command: "npx",
				args: ["-y", "@circleci/mcp-server-circleci"],
				env: { CIRCLECI_TOKEN: "your-circleci-token", CIRCLECI_BASE_URL: "https://circleci.com" },
			},
		},
	},
	null,
	2,
);
</script>
<template>
	<div class="tools-mcp-server-fields">
		<McpFieldComponent
			v-model="draft.server_name"
			label="MCP Server Name"
			:appearance="editing ? 'antd' : 'tremor'"
			:tooltip="
				editing
					? undefined
					: 'Best practice: Use a descriptive name that indicates the server’s purpose (e.g., GitHub_MCP, Email_Service). Cannot contain spaces or hyphens; use underscores instead. Names must comply with SEP-986 and will be rejected if invalid (https://modelcontextprotocol.io/specification/2025-11-25/server/tools#tool-names).'
			"
			:placeholder="editing ? undefined : 'e.g., GitHub_MCP, Zapier_MCP, etc.'"
			:error="errors.server_name"
		/><McpFieldComponent
			v-model="draft.alias"
			label="Alias"
			:appearance="editing ? 'antd' : 'tremor'"
			:tooltip="
				editing
					? undefined
					: 'A short, unique identifier for this server. Defaults to the server name if not provided. Cannot contain spaces or hyphens; use underscores instead.'
			"
			:placeholder="editing ? undefined : 'e.g., GitHub_MCP, Zapier_MCP, etc.'"
			:error="errors.alias"
			@change="store.markAliasEdited"
		/><McpFieldComponent
			v-model="draft.description"
			label="Description"
			:appearance="editing ? 'antd' : 'tremor'"
			:placeholder="editing ? undefined : 'Brief description of what this server does'"
		/><McpLogoSelectorComponent :model-value="store.config.value.logo" @update:model-value="store.setLogo" /><McpFieldComponent
			v-if="!editing"
			v-model="draft.source_url"
			label="GitHub / Source URL"
			appearance="tremor"
			placeholder="https://github.com/org/mcp-server"
		/><McpFieldComponent
			v-model="draft.transport"
			:searchable="false"
			:clearable="false"
			label="Transport Type"
			type="select"
			:options="transports"
			:size="editing ? 'middle' : 'large'"
			placeholder="Select transport"
			required
			:error="errors.transport"
			@change="store.transportChanged"
		/><McpFieldComponent
			v-if="draft.transport === 'http' || draft.transport === 'sse' || (editing && !draft.transport)"
			v-model="draft.url"
			label="MCP Server URL"
			placeholder="https://your-mcp-server.com"
			required
			:error="errors.url"
		/><McpOpenapiFieldsComponent v-if="draft.transport === 'openapi'" :store="store" :editing="editing" /><template
			v-if="draft.transport === 'stdio'"
			><div :class="{ 'tools-mcp-stdio-edit': editing }">
				<template v-if="editing"
					><p>
						Configure the stdio transport used to launch the MCP server process. You can either fill in the fields below or
						paste a JSON configuration.
					</p>
					<McpFieldComponent
						v-model="draft.command"
						label="Command"
						placeholder="e.g., npx"
						required
						:error="errors.command" /><McpFieldComponent
						v-model="draft.args"
						label="Args"
						type="select"
						size="large"
						multiple
						creatable
						placeholder="Add args (press enter or comma)" /><McpFieldComponent
						v-model="draft.env_json"
						label="Environment (JSON object)"
						type="textarea"
						:rows="6"
						:placeholder="JSON.stringify({ KEY: 'value' }, null, 2)"
						:error="errors.env_json" /></template
				><McpFieldComponent
					v-model="draft.stdio_config"
					label="Stdio Configuration (JSON)"
					tooltip="Paste your stdio MCP server configuration in JSON format. You can use the full mcpServers structure from config.yaml or just the inner server configuration."
					type="textarea"
					:rows="12"
					:placeholder="stdioPlaceholder"
					:required="!editing"
					:error="errors.stdio_config"
				/></div></template
		><template v-else-if="editing || draft.transport"
			><McpAuthenticationComponent
				v-if="editing"
				v-model="draft"
				:oauth="store.oauth"
				:errors="errors"
				editing
				:docs-url="store.docsUrl.value" />
			<details v-else class="tools-mcp-auth-collapse" open>
				<summary>
					<UiIcon name="RightOutlined" :size="12" />
					<h3>Authentication</h3>
				</summary>
				<McpAuthenticationComponent
					v-model="draft"
					:oauth="store.oauth"
					:errors="errors"
					:docs-url="store.docsUrl.value"
				/></details
		></template>
	</div>
</template>
