<script setup lang="ts">
import { computed, ref } from "vue";
import UiTabs from "../../platform/ui/UiTabs.vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiLucideIcon from "../../platform/ui/UiLucideIcon.vue";
import McpFeatureCardComponent from "./McpFeatureCardComponent.vue";
import McpCodeBlockComponent from "./McpCodeBlockComponent.vue";
import { getApiBaseUrl } from "../../platform/api/HttpApiClient";
import { mcpConnectionExamples, mcpExampleHeaders } from "../logic/McpConnectLogic";
import "../styles/McpConnectStyles.css";
const tab = ref("openai"),
	base = getApiBaseUrl(),
	examples = mcpConnectionExamples(base),
	tabs = [
		{ key: "openai", label: "OpenAI API", icon: "Code" },
		{ key: "litellm", label: "LiteLLM Proxy", icon: "Zap" },
		{ key: "cursor", label: "Cursor", icon: "Terminal" },
		{ key: "http", label: "Streamable HTTP", icon: "Globe" },
	];
const meta = computed(() =>
	tab.value === "openai"
		? {
				title: "OpenAI Responses API Integration",
				text: "Connect OpenAI Responses API to your LiteLLM MCP server for seamless tool integration",
				icon: "Code",
			}
		: tab.value === "litellm"
			? {
					title: "LiteLLM Proxy API Integration",
					text: "Connect to LiteLLM Proxy Responses API for seamless tool integration with multiple model providers",
					icon: "Zap",
				}
			: tab.value === "cursor"
				? {
						title: "Cursor IDE Integration",
						text: "Use tools directly from Cursor IDE with LiteLLM MCP. Enable your AI assistant to perform real-world tasks without leaving your coding environment.",
						icon: "Terminal",
					}
				: {
						title: "Streamable HTTP Transport",
						text: "Connect to LiteLLM MCP using HTTP transport. Compatible with any MCP client that supports HTTP streaming.",
						icon: "Globe",
					},
);
const headers = JSON.stringify({ "x-litellm-api-key": "Bearer YOUR_LITELLM_API_KEY" }, null, 2),
	openaiEnv = 'export OPENAI_API_KEY="sk-..."',
	litellmEnv = 'export LITELLM_API_KEY="sk-..."';
</script>
<template>
	<div class="tools-mcp-connect">
		<header>
			<h2>Connect to your MCP client</h2>
			<p>
				Use tools directly from any MCP client with LiteLLM MCP. Enable your AI assistant to perform real-world tasks through a
				simple, secure connection.
			</p>
		</header>
		<div class="tools-mcp-connect-tabs-border">
			<UiTabs v-model="tab" :items="tabs" appearance="tremor" class="tools-mcp-connect-tabs"
				><template v-for="item in tabs" :key="item.key" #[`tab-${item.key}`]
					><span class="tools-mcp-connect-tab-label"
						><UiLucideIcon :name="item.icon" :size="18" />{{ item.label }}</span
					></template
				></UiTabs
			>
		</div>
		<div :class="['tools-mcp-connect-panel', 'tools-mcp-connect-panel--' + tab]">
			<section class="tools-mcp-connect-banner">
				<div class="tools-mcp-connect-banner-heading">
					<UiLucideIcon :name="meta.icon" :size="24" />
					<h4>{{ meta.title }}</h4>
				</div>
				<p>{{ meta.text }}</p>
			</section>
			<template v-if="tab === 'openai' || tab === 'litellm'"
				><McpFeatureCardComponent
					icon="KeyIcon"
					:title="tab === 'openai' ? 'API Key Setup' : 'Virtual Key Setup'"
					:description="
						tab === 'openai'
							? 'Configure your OpenAI API key for authentication'
							: 'Configure your LiteLLM Proxy Virtual Key for authentication'
					"
					><div class="tools-mcp-connect-space">
						<p v-if="tab === 'openai'">
							Get your API key from the
							<a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer"
								>OpenAI platform<UiLucideIcon name="ExternalLink" :size="12"
							/></a>
						</p>
						<p v-else>Get your Virtual Key from your LiteLLM Proxy dashboard or contact your administrator</p>
						<McpCodeBlockComponent
							title="Environment Variable"
							:code="tab === 'openai' ? openaiEnv : litellmEnv"
						/></div></McpFeatureCardComponent
				><McpFeatureCardComponent
					icon="ServerIcon"
					title="MCP Server Information"
					description="Connection details for your LiteLLM MCP server"
					><McpCodeBlockComponent title="Server URL" :code="base + '/mcp'" /></McpFeatureCardComponent
				><McpFeatureCardComponent
					icon="Code"
					title="Implementation Example"
					:description="
						tab === 'openai'
							? 'Complete cURL example for using the Responses API'
							: 'Complete cURL example for using the LiteLLM Proxy Responses API'
					"
					:server-name="tab === 'openai' ? 'Zapier Gmail' : 'Zapier_MCP'"
					><template #default="{ enabled }"
						><McpCodeBlockComponent
							:code="
								mcpExampleHeaders(
									tab === 'openai' ? examples.openai : examples.litellm,
									tab === 'openai' ? 'Zapier Gmail' : 'Zapier_MCP',
									enabled,
								)
							" /></template></McpFeatureCardComponent></template
			><UiCard v-else-if="tab === 'cursor'" appearance="antd" class="tools-mcp-cursor-steps"
				><h5>Setup Instructions</h5>
				<section>
					<b>1</b>
					<div>
						<strong>Open Cursor Settings</strong>
						<span class="tools-mcp-cursor-step-copy"
							>Use the keyboard shortcut <code>⇧+⌘+J</code> (Mac) or <code>Ctrl+Shift+J</code> (Windows/Linux)</span
						>
					</div>
				</section>
				<section>
					<b>2</b>
					<div>
						<strong>Navigate to MCP Tools</strong>
						<span class="tools-mcp-cursor-step-copy"
							>Go to the &quot;MCP Tools&quot; tab and click &quot;New MCP Server&quot;</span
						>
					</div>
				</section>
				<section>
					<b>3</b>
					<div>
						<strong>Add Configuration</strong>
						<span class="tools-mcp-cursor-step-copy">
							Copy the JSON configuration below and paste it into Cursor, then save with <code>Cmd+S</code> or
							<code>Ctrl+S</code>
						</span>
						<McpFeatureCardComponent
							icon="Code"
							title="Configuration"
							description="Cursor MCP configuration"
							server-name="Zapier Gmail"
							><template #default="{ enabled }"
								><McpCodeBlockComponent :code="mcpExampleHeaders(examples.cursor, 'Zapier Gmail', enabled)" /></template
						></McpFeatureCardComponent>
					</div></section></UiCard
			><McpFeatureCardComponent
				v-else
				icon="Globe"
				title="Universal MCP Connection"
				description="Use this URL with any MCP client that supports HTTP transport"
				><div class="tools-mcp-connect-space">
					<p>
						Each MCP client supports different transports. Refer to your client documentation to determine the appropriate
						transport method.
					</p>
					<McpCodeBlockComponent title="Server URL" :code="base + '/mcp'" /><McpCodeBlockComponent
						title="Headers Configuration"
						:code="headers"
					/><a href="https://modelcontextprotocol.io/docs/concepts/transports" target="_blank" rel="noopener noreferrer"
						><UiLucideIcon name="ExternalLink" :size="14" />Learn more about MCP transports</a
					>
				</div></McpFeatureCardComponent
			>
		</div>
	</div>
</template>
