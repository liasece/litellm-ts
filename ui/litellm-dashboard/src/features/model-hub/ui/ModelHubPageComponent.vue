<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { useAuthenticationStore } from "../../identity/stores/AuthenticationStore";
import { isAdminRole } from "../../identity/logic/UserRoleLogic";
import { getApiBaseUrl } from "../../platform/api/HttpApiClient";
import { createModelHubStore } from "../stores/ModelHubStore";
import { copyHubText } from "../logic/ModelHubClipboardLogic";
import type { HubModel } from "../support/ModelHubModels";
import UiTabs from "../../platform/ui/UiTabs.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiLucideIcon from "../../platform/ui/UiLucideIcon.vue";
import ModelHubLinksComponent from "./links/ModelHubLinksComponent.vue";
import ModelHubMarketplaceComponent from "./marketplace/ModelHubMarketplaceComponent.vue";
import ModelHubModelsTableComponent from "./tables/ModelHubModelsTableComponent.vue";
import ModelHubAgentsTableComponent from "./tables/ModelHubAgentsTableComponent.vue";
import ModelHubMcpTableComponent from "./tables/ModelHubMcpTableComponent.vue";
import ModelHubModelFiltersComponent from "./filters/ModelHubModelFiltersComponent.vue";
import ModelHubPublishDialogComponent from "./forms/ModelHubPublishDialogComponent.vue";
import ModelHubModelDetailsComponent from "./details/ModelHubModelDetailsComponent.vue";
import ModelHubAgentDetailsComponent from "./details/ModelHubAgentDetailsComponent.vue";
import ModelHubMcpDetailsComponent from "./details/ModelHubMcpDetailsComponent.vue";
import "./ModelHubStyles.css";
const auth = useAuthenticationStore(),
	store = createModelHubStore(),
	state = store.state,
	admin = computed(() => isAdminRole(auth.userRole.value)),
	publicUrl = computed(() => {
		void auth.state.config;
		return getApiBaseUrl() + "/ui/model_hub_table";
	}),
	filtered = ref<HubModel[]>([]),
	publishing = reactive({ models: false, agents: false, mcp: false }),
	tabs = [
		{ key: "models", label: "Model Hub" },
		{ key: "agents", label: "Agent Hub" },
		{ key: "mcp", label: "MCP Hub" },
		{ key: "marketplace", label: "Claude Code Plugin Marketplace" },
	];
onMounted(() => void store.load());
onBeforeUnmount(store.dispose);
</script>
<template>
	<section class="hub-page">
		<div class="hub-page__inner">
			<header class="hub-header">
				<div>
					<h1>AI Hub</h1>
					<p>
						{{
							admin
								? "Make models, agents, and MCP servers public for developers to know what's available."
								: "A list of all public model names personally available to you."
						}}
					</p>
				</div>
				<div class="hub-header__url">
					<span>Model Hub URL:</span>
					<div>
						<span>{{ publicUrl }}</span
						><button type="button" class="hub-copy" title="Copy URL" @click="copyHubText(publicUrl)">
							<UiLucideIcon name="Copy" :size="16" />
						</button>
					</div>
				</div>
			</header>
			<div v-if="admin" class="hub-page__links"><ModelHubLinksComponent /></div>
			<UiTabs v-model="state.tab" :items="tabs" appearance="tremor" class="hub-admin-tabs" />
			<div v-show="state.tab === 'models'">
				<UiCard appearance="tremor" class="hub-resource-card"
					><header v-if="admin">
						<UiButton appearance="tremor" variant="primary" @click="publishing.models = true"
							>Select Models to Make Public</UiButton
						>
					</header>
					<ModelHubModelFiltersComponent :models="state.models" @change="filtered = $event" /><ModelHubModelsTableComponent
						:rows="filtered"
						:loading="state.modelLoading"
						@select="state.model = $event"
				/></UiCard>
				<p class="hub-count">Showing {{ filtered.length }} of {{ state.models.length }} models</p>
			</div>
			<div v-show="state.tab === 'agents'">
				<UiCard appearance="tremor" class="hub-resource-card"
					><header v-if="admin">
						<UiButton appearance="tremor" variant="primary" @click="publishing.agents = true"
							>Select Agents to Make Public</UiButton
						>
					</header>
					<ModelHubAgentsTableComponent :rows="state.agents" :loading="state.agentLoading" @select="state.agent = $event"
				/></UiCard>
				<p class="hub-count">Showing {{ state.agents.length }} agent{{ state.agents.length !== 1 ? "s" : "" }}</p>
			</div>
			<div v-show="state.tab === 'mcp'">
				<UiCard appearance="tremor" class="hub-resource-card"
					><header v-if="admin">
						<UiButton appearance="tremor" variant="primary" @click="publishing.mcp = true"
							>Select MCP Servers to Make Public</UiButton
						>
					</header>
					<ModelHubMcpTableComponent :rows="state.mcp" :loading="state.mcpLoading" @select="state.server = $event"
				/></UiCard>
				<p class="hub-count">Showing {{ state.mcp.length }} MCP server{{ state.mcp.length !== 1 ? "s" : "" }}</p>
			</div>
			<ModelHubMarketplaceComponent v-show="state.tab === 'marketplace'" />
		</div>
		<ModelHubModelDetailsComponent :model="state.model" @close="state.model = null" />
		<ModelHubAgentDetailsComponent :agent="state.agent" @close="state.agent = null" />
		<ModelHubMcpDetailsComponent :server="state.server" @close="state.server = null" />
		<ModelHubPublishDialogComponent
			v-model:open="publishing.models"
			kind="models"
			:models="state.models"
			:agents="state.agents"
			:servers="state.mcp"
			@success="store.models"
		/>
		<ModelHubPublishDialogComponent
			v-model:open="publishing.agents"
			kind="agents"
			:models="state.models"
			:agents="state.agents"
			:servers="state.mcp"
			@success="store.agents"
		/>
		<ModelHubPublishDialogComponent
			v-model:open="publishing.mcp"
			kind="mcp"
			:models="state.models"
			:agents="state.agents"
			:servers="state.mcp"
			@success="store.mcp"
		/>
	</section>
</template>
