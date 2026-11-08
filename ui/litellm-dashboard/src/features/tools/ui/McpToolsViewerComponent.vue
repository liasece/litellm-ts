<script setup lang="ts">
import { onBeforeUnmount } from "vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import McpToolTestPanelComponent from "./McpToolTestPanelComponent.vue";
import { createMcpToolRunnerStore } from "../stores/McpToolRunnerStore";
import type { MCPServer } from "../support/McpModels";
import "../styles/McpToolsStyles.css";
const props = defineProps<{ server: MCPServer }>();
const runner = createMcpToolRunnerStore(props.server);
onBeforeUnmount(runner.dispose);
</script>
<template>
	<div class="tools-mcp-tools-wrapper">
		<UiCard class="tools-mcp-tools-viewer"
			><div class="tools-mcp-tools-layout">
				<aside>
					<h2>MCP Tools</h2>
					<section v-if="server.extra_headers?.length && server.alias" class="tools-mcp-extra-headers">
						<header>
							<strong><UiIcon name="KeyOutlined" />Additional Headers</strong
							><button type="button" @click="runner.showHeaders.value = !runner.showHeaders.value">
								{{ runner.showHeaders.value ? "Hide" : "Configure" }}
							</button>
						</header>
						<div v-if="runner.showHeaders.value">
							<label v-for="name in server.extra_headers" :key="name"
								>{{ name
								}}<UiInput v-model="runner.headerValues.value[name]" :placeholder="'Enter ' + name" size="small" /></label
							><UiButton
								variant="primary"
								size="small"
								:disabled="Object.values(runner.headerValues.value).every((value) => !value || !value.trim())"
								@click="runner.load().then(() => (runner.showHeaders.value = false))"
								>Load Tools</UiButton
							>
						</div>
						<p v-else-if="Object.keys(runner.headerValues.value).length" class="tools-mcp-headers-set">
							{{ Object.keys(runner.headerValues.value).length }} header(s) configured
						</p>
						<p v-else>This server requires additional headers. Click &quot;Configure&quot; to provide values.</p>
					</section>
					<h3>
						<UiIcon name="ToolOutlined" />Available Tools
						<b v-if="runner.tools.value.length">{{ runner.tools.value.length }}</b>
					</h3>
					<div v-if="runner.tools.value.length" class="tools-mcp-tool-search">
						<UiIcon name="SearchOutlined" /><UiInput v-model="runner.query.value" placeholder="Search tools..." clearable />
					</div>
					<div class="tools-mcp-tools-list">
						<p v-if="runner.loading.value">Loading tools...</p>
						<div v-else-if="runner.error.value" class="tools-mcp-tools-error">
							<p>Error: {{ runner.error.value }}</p>
						</div>
						<div v-else-if="!runner.tools.value.length" class="tools-mcp-tool-empty">
							<UiIcon name="ExperimentOutlined" :size="16" /><strong>No tools available</strong>
							<p>No tools found for this server</p>
						</div>
						<div v-else-if="!runner.filtered.value.length" class="tools-mcp-tool-empty">
							<UiIcon name="SearchOutlined" :size="24" /><strong>No tools found</strong>
							<p>No tools match &quot;{{ runner.query.value }}&quot;</p>
						</div>
						<template v-else
							><button
								v-for="tool in runner.filtered.value"
								:key="tool.name"
								type="button"
								:class="{ selected: runner.selected.value?.name === tool.name }"
								@click="runner.select(tool)"
							>
								<div>
									<img
										v-if="tool.mcp_info?.logo_url"
										:src="tool.mcp_info.logo_url"
										:alt="tool.mcp_info.server_name + ' logo'"
									/>
									<section>
										<h4>{{ tool.name }}</h4>
										<small>{{ tool.mcp_info?.server_name }}</small>
										<p v-if="tool.description">{{ tool.description }}</p>
									</section>
								</div>
								<footer v-if="runner.selected.value?.name === tool.name">
									<UiIcon name="CheckOutlined" :size="12" />Selected
								</footer>
							</button></template
						>
					</div>
				</aside>
				<main>
					<header><h2>Tool Testing Playground</h2></header>
					<div class="tools-mcp-testing-body">
						<McpToolTestPanelComponent
							v-if="runner.selected.value"
							:key="runner.selected.value.name"
							:tool="runner.selected.value"
							:runner="runner"
							@close="runner.select(null)"
						/>
						<div v-else class="tools-mcp-select-tool">
							<UiIcon name="RobotOutlined" :size="48" />
							<h3>Select a Tool to Test</h3>
							<p>Choose a tool from the left sidebar to start testing its functionality with custom inputs.</p>
						</div>
					</div>
				</main>
			</div></UiCard
		>
	</div>
</template>
