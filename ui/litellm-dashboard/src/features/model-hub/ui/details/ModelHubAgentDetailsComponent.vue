<script setup lang="ts">
import { computed } from "vue";
import type { HubAgent } from "../../support/ModelHubModels";
import { agentCapabilities } from "../../logic/ModelHubFilterLogic";
import { agentCallCode, agentResolverCode } from "../../logic/ModelHubCodeLogic";
import ModelHubBadgeComponent from "../common/ModelHubBadgeComponent.vue";
import ModelHubCopyComponent from "../common/ModelHubCopyComponent.vue";
import ModelHubCodeExampleComponent from "./ModelHubCodeExampleComponent.vue";
import UiDialog from "../../../platform/ui/UiDialog.vue";
import ModelHubHeroIconComponent from "../common/ModelHubHeroIconComponent.vue";
const props = defineProps<{ agent: HubAgent | null; publicPage?: boolean }>(),
	emit = defineEmits<{ close: [] }>(),
	capabilities = computed(() => (props.agent ? agentCapabilities(props.agent) : []));
</script>
<template>
	<UiDialog
		:open="Boolean(agent)"
		:title="agent?.name || 'Agent Details'"
		:width="1000"
		:show-footer="false"
		scroll-mode="overlay"
		class="hub-details"
		:class="{ 'hub-details--public-agent': publicPage, 'hub-details--private-agent': !publicPage }"
		@update:open="!$event && emit('close')"
	>
		<template #title
			><span class="hub-inline"
				><span>{{ agent?.name || "Agent Details" }}</span
				><ModelHubCopyComponent v-if="publicPage && agent" :value="agent.name" title="Copy agent name" lucide :size="16" /></span
		></template>
		<div v-if="agent" class="hub-details__sections">
			<section>
				<h3>Agent Overview</h3>
				<div class="hub-details__grid hub-mb-16">
					<div>
						<strong>Name:</strong>
						<p>{{ agent.name }}</p>
					</div>
					<div>
						<strong>Version:</strong>
						<p v-if="publicPage">{{ agent.version }}</p>
						<ModelHubBadgeComponent v-else color="blue">v{{ agent.version }}</ModelHubBadgeComponent>
					</div>
					<template v-if="!publicPage"
						><div>
							<strong>Protocol Version:</strong>
							<p>{{ agent.protocolVersion }}</p>
						</div>
						<div>
							<strong>URL:</strong>
							<div class="hub-inline">
								<p class="hub-truncate">{{ agent.url }}</p>
								<ModelHubCopyComponent :value="agent.url" :size="14" />
							</div></div
					></template>
					<template v-else
						><div class="hub-span-2">
							<strong>Description:</strong>
							<p>{{ agent.description }}</p>
						</div>
						<a v-if="agent.url" :href="agent.url" target="_blank" rel="noopener noreferrer" class="hub-text-sm hub-break">{{
							agent.url
						}}</a></template
					>
				</div>
				<template v-if="!publicPage"
					><strong>Description:</strong>
					<p class="hub-mt-4">{{ agent.description }}</p></template
				>
			</section>
			<section v-if="capabilities.length">
				<h3>Capabilities</h3>
				<div class="hub-tags hub-gap-8">
					<ModelHubBadgeComponent
						v-for="capability in capabilities"
						:key="capability"
						color="green"
						:antd="publicPage"
						:class="{ 'hub-capitalize': publicPage }"
						>{{ capability }}</ModelHubBadgeComponent
					>
				</div>
			</section>
			<section v-if="!publicPage">
				<h3>Input/Output Modes</h3>
				<div class="hub-details__grid">
					<div v-for="(modes, index) in [agent.defaultInputModes, agent.defaultOutputModes]" :key="index">
						<strong>{{ index ? "Output" : "Input" }} Modes:</strong>
						<div class="hub-tags hub-mt-4">
							<ModelHubBadgeComponent v-for="mode in modes" :key="mode" :color="index ? 'purple' : 'blue'">{{
								mode
							}}</ModelHubBadgeComponent
							><span v-if="!modes.length">Not specified</span>
						</div>
					</div>
				</div>
			</section>
			<section v-if="agent.skills.length">
				<h3>Skills</h3>
				<div class="hub-details__skills">
					<div v-for="skill in agent.skills" :key="skill.id">
						<div class="hub-details__skill-heading">
							<div>
								<strong class="hub-text-base">{{ skill.name }}</strong>
								<p v-if="!publicPage" class="hub-text-xs hub-muted">ID: {{ skill.id }}</p>
							</div>
							<div v-if="!publicPage" class="hub-tags">
								<ModelHubBadgeComponent v-for="tag in skill.tags" :key="tag" color="purple" size="xs">{{
									tag
								}}</ModelHubBadgeComponent>
							</div>
						</div>
						<p class="hub-text-sm">{{ skill.description }}</p>
						<div v-if="publicPage" class="hub-tags hub-mt-8">
							<ModelHubBadgeComponent v-for="tag in skill.tags" :key="tag" color="purple" antd class="hub-text-xs">{{
								tag
							}}</ModelHubBadgeComponent>
						</div>
						<div v-if="!publicPage && skill.examples?.length" class="hub-mt-8">
							<strong class="hub-text-xs">Examples:</strong>
							<div class="hub-tags hub-mt-4">
								<ModelHubBadgeComponent v-for="example in skill.examples" :key="example" color="gray" size="xs">{{
									example
								}}</ModelHubBadgeComponent>
							</div>
						</div>
					</div>
				</div>
			</section>
			<section v-if="!publicPage && agent.supportsAuthenticatedExtendedCard">
				<h3>Additional Features</h3>
				<ModelHubBadgeComponent color="green">Supports Authenticated Extended Card</ModelHubBadgeComponent>
			</section>
			<template v-if="publicPage"
				><section>
					<h3>Input/Output Modes</h3>
					<div class="hub-details__grid">
						<div v-for="(modes, index) in [agent.defaultInputModes, agent.defaultOutputModes]" :key="index">
							<strong>{{ index ? "Output" : "Input" }} Modes:</strong>
							<div class="hub-tags hub-mt-4">
								<ModelHubBadgeComponent v-for="mode in modes" :key="mode" color="blue" antd>{{
									mode
								}}</ModelHubBadgeComponent>
							</div>
						</div>
					</div>
				</section>
				<a
					v-if="agent.documentationUrl"
					:href="agent.documentationUrl"
					target="_blank"
					rel="noopener noreferrer"
					class="hub-inline hub-doc-link"
					><ModelHubHeroIconComponent name="ExternalLink" :size="16" /><span>View Documentation</span></a
				>
				<section class="hub-details__examples">
					<h3>Usage Example (A2A Protocol)</h3>
					<ModelHubCodeExampleComponent
						title="Step 1: Retrieve Agent Card"
						:code="agentResolverCode(agent.url)"
						compact
					/><ModelHubCodeExampleComponent title="Step 2: Call the Agent" :code="agentCallCode" compact />
				</section>
			</template>
		</div>
	</UiDialog>
</template>
