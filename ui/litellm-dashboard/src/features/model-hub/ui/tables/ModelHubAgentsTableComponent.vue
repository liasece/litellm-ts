<script setup lang="ts">
import { computed } from "vue";
import type { HubAgent } from "../../support/ModelHubModels";
import { hubAgentColumns } from "../../data/ModelHubColumns";
import { agentCapabilities } from "../../logic/ModelHubFilterLogic";
import ModelHubDataTableComponent from "../common/ModelHubDataTableComponent.vue";
import ModelHubCopyComponent from "../common/ModelHubCopyComponent.vue";
import ModelHubBadgeComponent from "../common/ModelHubBadgeComponent.vue";
import ModelHubOverflowTagsComponent from "../common/ModelHubOverflowTagsComponent.vue";
import UiTooltip from "../../../platform/ui/UiTooltip.vue";
import UiButton from "../../../platform/ui/UiButton.vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
const props = defineProps<{ rows: HubAgent[]; loading: boolean; publicPage?: boolean }>(),
	emit = defineEmits<{ select: [HubAgent] }>(),
	columns = computed(() => hubAgentColumns(Boolean(props.publicPage)));
</script>
<template>
	<ModelHubDataTableComponent :rows="rows" :columns="columns" :loading="loading" default-sort="name" row-key="name">
		<template #cell-name="{ row }"
			><UiTooltip v-if="publicPage" :title="row.name"
				><button type="button" class="hub-public-name" @click="emit('select', row)">
					<span>{{ row.name }}</span>
				</button></UiTooltip
			>
			<div v-else class="hub-stack">
				<div class="hub-inline">
					<strong class="hub-text-sm">{{ row.name }}</strong
					><ModelHubCopyComponent :value="row.name" title="Copy agent name" />
				</div>
				<p class="hub-mobile-only hub-text-xs">{{ row.description }}</p>
			</div></template
		>
		<template #cell-description="{ row }"
			><UiTooltip v-if="publicPage" :title="row.description"
				><p class="hub-text-sm hub-public-desc">
					{{ row.description.length > 80 ? row.description.slice(0, 80) + "..." : row.description }}
				</p></UiTooltip
			>
			<p v-else class="hub-clamp hub-text-xs">{{ row.description || "-" }}</p></template
		>
		<template #cell-version="{ row }"
			><span v-if="publicPage" class="hub-text-sm">{{ row.version }}</span
			><ModelHubBadgeComponent v-else color="blue" size="sm">v{{ row.version }}</ModelHubBadgeComponent></template
		>
		<template #cell-protocolVersion="{ row }"
			><span class="hub-text-xs">{{ row.protocolVersion || "-" }}</span></template
		>
		<template #cell-provider="{ row }"
			><span v-if="row.provider" class="hub-text-sm hub-medium">{{ row.provider.organization }}</span
			><span v-else class="hub-muted">-</span></template
		>
		<template #cell-skills="{ row }"
			><ModelHubOverflowTagsComponent
				v-if="publicPage"
				:values="row.skills.map((skill) => skill.name)"
				color="purple"
				label="Skills"
			/>
			<div v-else class="hub-stack">
				<strong class="hub-text-xs">{{ row.skills.length }} skill{{ row.skills.length !== 1 ? "s" : "" }}</strong>
				<div v-if="row.skills.length" class="hub-tags">
					<ModelHubBadgeComponent
						class="hub-text-xs"
						v-for="skill in row.skills.slice(0, 2)"
						:key="skill.id"
						color="purple"
						antd
						>{{ skill.name }}</ModelHubBadgeComponent
					><span v-if="row.skills.length > 2" class="hub-text-xs hub-muted">+{{ row.skills.length - 2 }}</span>
				</div>
			</div></template
		>
		<template #cell-capabilities="{ row }"
			><div class="hub-tags">
				<span v-if="!agentCapabilities(row).length" class="hub-muted">-</span
				><ModelHubBadgeComponent
					v-for="capability in agentCapabilities(row)"
					:key="capability"
					color="green"
					:antd="publicPage"
					size="xs"
					:class="{ 'hub-capitalize': publicPage, 'hub-text-xs': publicPage }"
					>{{ capability }}</ModelHubBadgeComponent
				>
			</div></template
		>
		<template #cell-defaultInputModes="{ row }"
			><div class="hub-stack hub-text-xs">
				<p><strong>In:</strong> {{ row.defaultInputModes.join(", ") || "-" }}</p>
				<p><strong>Out:</strong> {{ row.defaultOutputModes.join(", ") || "-" }}</p>
			</div></template
		>
		<template #cell-is_public="{ row }"
			><ModelHubBadgeComponent :color="row.is_public === true ? 'green' : 'gray'" size="xs">{{
				row.is_public === true ? "Yes" : "No"
			}}</ModelHubBadgeComponent></template
		>
		<template #cell-details="{ row }"
			><UiButton appearance="tremor" size="small" class="hub-details-button" @click="emit('select', row)"
				><template #icon><UiIcon name="InfoCircleOutlined" /></template><span class="hub-desktop-detail">Details</span
				><span class="hub-mobile-detail">Info</span></UiButton
			></template
		>
	</ModelHubDataTableComponent>
</template>
