<script setup lang="ts">
import type { HubMcp } from "../../support/ModelHubModels";
import { statusColor } from "../../logic/ModelHubFilterLogic";
import { adminMcpCode, publicMcpCode } from "../../logic/ModelHubCodeLogic";
import ModelHubBadgeComponent from "../common/ModelHubBadgeComponent.vue";
import ModelHubCopyComponent from "../common/ModelHubCopyComponent.vue";
import ModelHubCodeExampleComponent from "./ModelHubCodeExampleComponent.vue";
import CodeHighlightComponent from "../../../content/ui/CodeHighlightComponent.vue";
import UiDialog from "../../../platform/ui/UiDialog.vue";
import ModelHubHeroIconComponent from "../common/ModelHubHeroIconComponent.vue";
defineProps<{ server: HubMcp | null; publicPage?: boolean }>();
const emit = defineEmits<{ close: [] }>();
</script>
<template>
	<UiDialog
		:open="Boolean(server)"
		:title="server?.server_name || 'MCP Server Details'"
		:width="1000"
		:show-footer="false"
		scroll-mode="overlay"
		class="hub-details hub-details--mcp"
		@update:open="!$event && emit('close')"
	>
		<template #title
			><span class="hub-inline"
				><span>{{ server?.server_name || "MCP Server Details" }}</span
				><ModelHubCopyComponent
					v-if="publicPage && server"
					:value="server.server_name"
					title="Copy server name"
					lucide
					:size="16" /></span
		></template>
		<div v-if="server" class="hub-details__sections">
			<section>
				<h3>Server Overview</h3>
				<div class="hub-details__grid hub-mb-16">
					<div>
						<strong>Server Name:</strong>
						<p>{{ server.server_name }}</p>
					</div>
					<div v-if="!publicPage">
						<strong>Server ID:</strong>
						<div class="hub-inline">
							<p class="hub-text-xs hub-truncate">{{ server.server_id }}</p>
							<ModelHubCopyComponent :value="server.server_id" :size="14" />
						</div>
					</div>
					<div v-if="server.alias && !publicPage">
						<strong>Alias:</strong>
						<p>{{ server.alias }}</p>
					</div>
					<div>
						<strong>Transport:</strong
						><span :class="publicPage ? 'hub-tag-line' : undefined"
							><ModelHubBadgeComponent color="blue" :antd="publicPage">{{ server.transport }}</ModelHubBadgeComponent></span
						>
					</div>
					<div v-if="server.alias && publicPage">
						<strong>Alias:</strong>
						<p>{{ server.alias }}</p>
					</div>
					<div>
						<strong>Auth Type:</strong
						><span :class="publicPage ? 'hub-tag-line' : undefined"
							><ModelHubBadgeComponent :color="server.auth_type === 'none' ? 'gray' : 'green'" :antd="publicPage">{{
								server.auth_type
							}}</ModelHubBadgeComponent></span
						>
					</div>
					<div v-if="!publicPage">
						<strong>Status:</strong
						><ModelHubBadgeComponent :color="statusColor(server.status)">{{
							server.status || "unknown"
						}}</ModelHubBadgeComponent>
					</div>
					<template v-if="publicPage"
						><div class="hub-span-2">
							<strong>Description:</strong>
							<p>{{ server.mcp_info.description || "-" }}</p>
						</div>
						<a :href="server.url" target="_blank" rel="noopener noreferrer" class="hub-span-2 hub-inline hub-text-sm hub-break"
							><span>{{ server.url }}</span
							><ModelHubHeroIconComponent name="ExternalLink" :size="16" /></a
					></template>
				</div>
				<div v-if="!publicPage && server.description" class="hub-mt-8">
					<strong>Description:</strong>
					<p class="hub-mt-4">{{ server.description }}</p>
				</div>
			</section>
			<template v-if="!publicPage">
				<section>
					<h3>Connection Details</h3>
					<div class="hub-stack hub-gap-8">
						<div>
							<strong>URL:</strong>
							<div class="hub-inline hub-mt-4">
								<p class="hub-details__url hub-break">{{ server.url }}</p>
								<ModelHubCopyComponent :value="server.url" :size="14" />
							</div>
						</div>
						<div v-if="server.command">
							<strong>Command:</strong>
							<p class="hub-details__url hub-mono hub-mt-4">{{ server.command }}</p>
						</div>
					</div>
				</section>
				<section
					v-for="(values, index) in [server.allowed_tools, server.teams, server.mcp_access_groups]"
					v-show="values.length"
					:key="index"
				>
					<h3>{{ ["Allowed Tools", "Teams", "Access Groups"][index] }}</h3>
					<div class="hub-tags hub-gap-8">
						<ModelHubBadgeComponent v-for="value in values" :key="value" :color="['purple', 'blue', 'green'][index]">{{
							value
						}}</ModelHubBadgeComponent>
					</div>
				</section>
				<section>
					<h3>Metadata</h3>
					<div class="hub-details__grid">
						<div>
							<strong>Created By:</strong>
							<p>{{ server.created_by }}</p>
						</div>
						<div>
							<strong>Updated By:</strong>
							<p>{{ server.updated_by }}</p>
						</div>
						<div>
							<strong>Created At:</strong>
							<p class="hub-text-sm">{{ new Date(server.created_at).toLocaleString() }}</p>
						</div>
						<div>
							<strong>Updated At:</strong>
							<p class="hub-text-sm">{{ new Date(server.updated_at).toLocaleString() }}</p>
						</div>
						<div v-if="server.last_health_check">
							<strong>Last Health Check:</strong>
							<p class="hub-text-sm">{{ new Date(server.last_health_check).toLocaleString() }}</p>
						</div>
					</div>
					<div v-if="server.health_check_error" class="hub-details__health-error hub-mt-8">
						<strong>Health Check Error:</strong>
						<p class="hub-text-sm hub-mt-4">{{ server.health_check_error }}</p>
					</div>
				</section>
				<section>
					<h3>Usage Example</h3>
					<div class="hub-code-block">
						<CodeHighlightComponent :code="adminMcpCode(server.server_name)" language="python" theme="prism" />
					</div>
				</section>
			</template>
			<template v-else
				><section v-if="Object.keys(server.mcp_info).length">
					<h3>Additional Information</h3>
					<pre class="hub-details__json">{{ JSON.stringify(server.mcp_info, null, 2) }}</pre>
				</section>
				<ModelHubCodeExampleComponent title="Usage Example" :code="publicMcpCode(server.server_name)"
			/></template>
		</div>
	</UiDialog>
</template>
