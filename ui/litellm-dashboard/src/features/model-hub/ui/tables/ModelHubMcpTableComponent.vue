<script setup lang="ts">
import { computed } from "vue";
import type { HubMcp } from "../../support/ModelHubModels";
import { hubMcpColumns } from "../../data/ModelHubColumns";
import { statusColor } from "../../logic/ModelHubFilterLogic";
import ModelHubDataTableComponent from "../common/ModelHubDataTableComponent.vue";
import ModelHubCopyComponent from "../common/ModelHubCopyComponent.vue";
import ModelHubBadgeComponent from "../common/ModelHubBadgeComponent.vue";
import UiTooltip from "../../../platform/ui/UiTooltip.vue";
import UiButton from "../../../platform/ui/UiButton.vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
const props = defineProps<{ rows: HubMcp[]; loading: boolean; publicPage?: boolean }>(),
	emit = defineEmits<{ select: [HubMcp] }>(),
	columns = computed(() => hubMcpColumns(Boolean(props.publicPage)));
function description(row: HubMcp) {
	return props.publicPage ? String(row.mcp_info.description ?? "-") : row.description || "-";
}
</script>
<template>
	<ModelHubDataTableComponent :rows="rows" :columns="columns" :loading="loading" default-sort="server_name" row-key="server_id">
		<template #cell-server_name="{ row }"
			><UiTooltip v-if="publicPage" :title="row.server_name"
				><button type="button" class="hub-public-name" @click="emit('select', row)">
					<span>{{ row.server_name }}</span>
				</button></UiTooltip
			>
			<div v-else class="hub-stack">
				<div class="hub-inline">
					<strong class="hub-text-sm">{{ row.server_name }}</strong
					><ModelHubCopyComponent :value="row.server_name" title="Copy server name" />
				</div>
				<p class="hub-mobile-only hub-text-xs">{{ description(row) }}</p>
			</div></template
		>
		<template #cell-description="{ row }"
			><UiTooltip v-if="publicPage" :title="description(row)"
				><p class="hub-text-sm hub-public-desc">
					{{ description(row).length > 80 ? description(row).slice(0, 80) + "..." : description(row) }}
				</p></UiTooltip
			>
			<p v-else class="hub-clamp hub-text-xs">{{ description(row) }}</p></template
		>
		<template #cell-url="{ row }"
			><component :is="publicPage ? UiTooltip : 'span'" :title="publicPage ? row.url : undefined"
				><div class="hub-inline">
					<span :class="publicPage ? 'hub-mono hub-text-xs' : 'hub-text-xs hub-truncate'">{{
						publicPage && row.url.length > 40 ? row.url.slice(0, 40) + "..." : row.url
					}}</span
					><ModelHubCopyComponent
						:value="row.url"
						title="Copy URL"
						:tooltip="!publicPage"
						:lucide="publicPage"
					/></div></component
		></template>
		<template #cell-transport="{ row }"
			><ModelHubBadgeComponent
				color="blue"
				size="sm"
				:antd="publicPage"
				:class="{ 'hub-uppercase': publicPage, 'hub-text-xs': publicPage }"
				>{{ row.transport }}</ModelHubBadgeComponent
			></template
		>
		<template #cell-auth_type="{ row }"
			><ModelHubBadgeComponent
				:color="row.auth_type === 'none' ? 'gray' : 'green'"
				size="sm"
				:antd="publicPage"
				:class="{ 'hub-capitalize': publicPage, 'hub-text-xs': publicPage }"
				>{{ row.auth_type }}</ModelHubBadgeComponent
			></template
		>
		<template #cell-status="{ row }"
			><ModelHubBadgeComponent :color="statusColor(row.status)" size="sm">{{
				row.status || "unknown"
			}}</ModelHubBadgeComponent></template
		>
		<template #cell-allowed_tools="{ row }"
			><div class="hub-stack">
				<strong class="hub-text-xs">{{
					row.allowed_tools.length
						? row.allowed_tools.length + " tool" + (row.allowed_tools.length !== 1 ? "s" : "")
						: "All tools"
				}}</strong>
				<div v-if="row.allowed_tools.length" class="hub-tags">
					<ModelHubBadgeComponent
						class="hub-text-xs"
						v-for="(tool, index) in row.allowed_tools.slice(0, 2)"
						:key="index"
						color="purple"
						antd
						>{{ tool }}</ModelHubBadgeComponent
					><span v-if="row.allowed_tools.length > 2" class="hub-text-xs hub-muted">+{{ row.allowed_tools.length - 2 }}</span>
				</div>
			</div></template
		>
		<template #cell-created_by="{ row }"
			><span class="hub-text-xs">{{ row.created_by || "-" }}</span></template
		>
		<template #cell-is_public="{ row }"
			><ModelHubBadgeComponent :color="row.mcp_info.is_public === true ? 'green' : 'gray'" size="xs">{{
				row.mcp_info.is_public === true ? "Yes" : "No"
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
