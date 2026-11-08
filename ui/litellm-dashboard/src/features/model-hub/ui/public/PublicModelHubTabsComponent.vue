<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import type { PublicModelHubStore } from "../../stores/PublicModelHubStore";
import {
	filterHubAgents,
	filterHubMcp,
	filterHubModels,
	uniqueFeatures,
	uniqueModes,
	uniqueProviders,
	uniqueSkills,
	uniqueTransports,
} from "../../logic/ModelHubFilterLogic";
import { getProviderLogoAndName } from "../../../providers/logic/ProviderIdentityLogic";
import ProviderLogoComponent from "../../../providers/ui/ProviderLogoComponent.vue";
import ModelHubModelsTableComponent from "../tables/ModelHubModelsTableComponent.vue";
import ModelHubAgentsTableComponent from "../tables/ModelHubAgentsTableComponent.vue";
import ModelHubMcpTableComponent from "../tables/ModelHubMcpTableComponent.vue";
import ModelHubHeroIconComponent from "../common/ModelHubHeroIconComponent.vue";
import UiCard from "../../../platform/ui/UiCard.vue";
import UiTabs from "../../../platform/ui/UiTabs.vue";
import UiSelect from "../../../platform/ui/UiSelect.vue";
import UiTooltip from "../../../platform/ui/UiTooltip.vue";
import UiLucideIcon from "../../../platform/ui/UiLucideIcon.vue";
import type { UiValue } from "../../../platform/ui/UiTypes";
const props = defineProps<{ store: PublicModelHubStore }>(),
	state = props.store.state,
	tab = ref("models"),
	visited = ref(new Set(["models"])),
	filters = reactive({
		model: "",
		agent: "",
		mcp: "",
		providers: [] as string[],
		modes: [] as string[],
		features: [] as string[],
		skills: [] as string[],
		transports: [] as string[],
	}),
	models = computed(() => filterHubModels(state.models, filters.model, filters.providers, filters.modes, filters.features, true)),
	agents = computed(() => filterHubAgents(state.agents, filters.agent, filters.skills)),
	servers = computed(() => filterHubMcp(state.mcp, filters.mcp, filters.transports)),
	tabs = computed(() => [
		{ key: "models", label: "Model Hub" },
		...(state.agents.length ? [{ key: "agents", label: "Agent Hub" }] : []),
		...(state.mcp.length ? [{ key: "mcp", label: "MCP Hub" }] : []),
	]);
watch(tab, (key) => (visited.value = new Set([...visited.value, key])));
const options = (values: string[]) => values.map((value) => ({ label: value, value }));
function strings(value: UiValue | UiValue[] | null) {
	return value === null ? [] : (Array.isArray(value) ? value : [value]).map(String);
}
</script>
<template>
	<UiCard appearance="tremor" class="hub-public-card hub-public-tabs">
		<UiTabs v-model="tab" :items="tabs" />
		<div v-show="tab === 'models'">
			<h2>Available Models</h2>
			<div class="hub-public-filters hub-public-filters--models">
				<div>
					<label
						>Search Models:<UiTooltip title="Smart search with relevance ranking for model names."
							><UiLucideIcon name="Info" :size="16" /></UiTooltip
					></label>
					<div class="hub-public-search">
						<ModelHubHeroIconComponent name="Search" :size="16" /><input
							v-model="filters.model"
							placeholder="Search model names..."
						/>
					</div>
				</div>
				<div>
					<label>Provider:</label
					><UiSelect
						:model-value="filters.providers"
						:options="options(uniqueProviders(state.models))"
						multiple
						clearable
						searchable
						size="large"
						placeholder="Select providers"
						@update:model-value="filters.providers = strings($event)"
						><template #option="{ option }"
							><div class="hub-inline">
								<ProviderLogoComponent
									:provider="String(option.value)"
									:logo="getProviderLogoAndName(String(option.value)).logo"
									image-class="hub-filter-provider"
									fallback-class="hub-hidden"
								/><span class="hub-capitalize">{{ option.label }}</span>
							</div></template
						></UiSelect
					>
				</div>
				<div>
					<label>Mode:</label
					><UiSelect
						:model-value="filters.modes"
						:options="options(uniqueModes(state.models))"
						multiple
						clearable
						size="large"
						placeholder="Select modes"
						@update:model-value="filters.modes = strings($event)"
					/>
				</div>
				<div>
					<label>Features:</label
					><UiSelect
						:model-value="filters.features"
						:options="options(uniqueFeatures(state.models))"
						multiple
						clearable
						size="large"
						placeholder="Select features"
						@update:model-value="filters.features = strings($event)"
					/>
				</div>
			</div>
			<ModelHubModelsTableComponent :rows="models" :loading="state.modelLoading" public-page @select="state.model = $event" />
			<p class="hub-count hub-public-count">Showing {{ models.length }} of {{ state.models.length }} models</p>
		</div>
		<div v-if="visited.has('agents') && state.agents.length" v-show="tab === 'agents'">
			<h2>Available Agents</h2>
			<div class="hub-public-filters">
				<div>
					<label
						>Search Agents:<UiTooltip title="Search agents by name or description"
							><UiLucideIcon name="Info" :size="16" /></UiTooltip
					></label>
					<div class="hub-public-search">
						<ModelHubHeroIconComponent name="Search" :size="16" /><input
							v-model="filters.agent"
							placeholder="Search agent names or descriptions..."
						/>
					</div>
				</div>
				<div>
					<label>Skills:</label
					><UiSelect
						:model-value="filters.skills"
						:options="options(uniqueSkills(state.agents))"
						multiple
						clearable
						size="large"
						placeholder="Select skills"
						@update:model-value="filters.skills = strings($event)"
					/>
				</div>
			</div>
			<ModelHubAgentsTableComponent :rows="agents" :loading="state.agentLoading" public-page @select="state.agent = $event" />
			<p class="hub-count hub-public-count">Showing {{ agents.length }} of {{ state.agents.length }} agents</p>
		</div>
		<div v-if="visited.has('mcp') && state.mcp.length" v-show="tab === 'mcp'">
			<h2>Available MCP Servers</h2>
			<div class="hub-public-filters">
				<div>
					<label
						>Search MCP Servers:<UiTooltip title="Search MCP servers by name or description"
							><UiLucideIcon name="Info" :size="16" /></UiTooltip
					></label>
					<div class="hub-public-search">
						<ModelHubHeroIconComponent name="Search" :size="16" /><input
							v-model="filters.mcp"
							placeholder="Search MCP server names or descriptions..."
						/>
					</div>
				</div>
				<div>
					<label>Transport:</label
					><UiSelect
						:model-value="filters.transports"
						:options="options(uniqueTransports(state.mcp))"
						multiple
						clearable
						size="large"
						placeholder="Select transport types"
						@update:model-value="filters.transports = strings($event)"
					/>
				</div>
			</div>
			<ModelHubMcpTableComponent :rows="servers" :loading="state.mcpLoading" public-page @select="state.server = $event" />
			<p class="hub-count hub-public-count">Showing {{ servers.length }} of {{ state.mcp.length }} MCP servers</p>
		</div>
	</UiCard>
</template>
<style>
.hub-public-tabs > .ui-card__body > .ui-tabs {
	margin-bottom: 16px;
}
.hub-public-tabs .ui-tabs__tab {
	font-size: 16px;
	line-height: 24px;
	padding-top: 16px;
	padding-bottom: 16px;
	border-bottom: 0;
}
.hub-public-card.hub-public-tabs h2 {
	margin-bottom: 32px;
}
.hub-public-tabs .ui-tabs__list {
	border-bottom: 0;
}
.hub-public-tabs .ui-tabs__list::after {
	content: "";
	position: absolute;
	left: 0;
	right: 0;
	bottom: 0;
	height: 1px;
	background: #f0f0f0;
	pointer-events: none;
}
.hub-public-tabs .ui-tabs__tab--active::after {
	content: "";
	position: absolute;
	left: 0;
	right: 0;
	bottom: 0;
	height: 2px;
	background: #1677ff;
	z-index: 1;
}
.hub-public-tabs .ui-tabs__tab:focus-visible {
	outline: none;
}
.hub-public-tabs .ui-tabs__tab:focus-visible::before {
	content: "";
	position: absolute;
	left: 0;
	right: 0;
	top: 16px;
	height: 24px;
	outline: 4px solid #91caff;
	outline-offset: 0;
	pointer-events: none;
}
.hub-public-filters {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 24px;
	padding: 24px;
	background: #f9fafb;
	border: 1px solid #e5e7eb;
	border-radius: 8px;
	margin-bottom: 32px;
}
.hub-public-filters--models {
	grid-template-columns: repeat(4, minmax(0, 1fr));
}
.hub-public-filters label {
	display: flex;
	align-items: center;
	gap: 8px;
	font-size: 14px;
	font-weight: 500;
	line-height: 20px;
	color: #374151;
	margin-bottom: 12px;
}
.hub-public-filters label .ui-lucide-icon {
	color: #9ca3af;
	cursor: help;
}
.hub-public-search {
	position: relative;
}
.hub-public-search > .hub-hero-icon {
	position: absolute;
	left: 12px;
	top: 50%;
	transform: translateY(-50%);
	color: #9ca3af;
}
.hub-public-search input::placeholder {
	color: #6b7280;
}
.hub-public-search input {
	width: 100%;
	background: #fff;
	border: 1px solid #d1d5db;
	border-radius: 8px;
	padding: 8px 16px 8px 40px;
	font-size: 14px;
	line-height: 20px;
}
.hub-public-search input:focus {
	outline: 2px solid #3b82f6;
	border-color: transparent;
}
.hub-filter-provider.provider-logo-image {
	height: 20px;
	width: 20px;
}
.hub-public-count {
	margin-top: 32px;
}
@media (max-width: 1023px) {
	.hub-public-filters--models {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
}
@media (max-width: 767px) {
	.hub-public-filters {
		grid-template-columns: 1fr;
	}
}
</style>
