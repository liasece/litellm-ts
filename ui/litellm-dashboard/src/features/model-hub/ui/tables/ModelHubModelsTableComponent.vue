<script setup lang="ts">
import { computed } from "vue";
import type { HubModel } from "../../support/ModelHubModels";
import { hubModelColumns } from "../../data/ModelHubColumns";
import { compactTokens, formatCapabilityName, modelCapabilities, publicTokens } from "../../logic/ModelHubFilterLogic";
import { useMoneyFormatter } from "../../../platform/stores/PriceDisplayStore";
import { getModelLogoAndName } from "../../../providers/logic/ProviderIdentityLogic";
import ProviderLogoComponent from "../../../providers/ui/ProviderLogoComponent.vue";
import ModelHubDataTableComponent from "../common/ModelHubDataTableComponent.vue";
import ModelHubCopyComponent from "../common/ModelHubCopyComponent.vue";
import ModelHubBadgeComponent from "../common/ModelHubBadgeComponent.vue";
import ModelHubOverflowTagsComponent from "../common/ModelHubOverflowTagsComponent.vue";
import UiTooltip from "../../../platform/ui/UiTooltip.vue";
import UiButton from "../../../platform/ui/UiButton.vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
const props = defineProps<{ rows: HubModel[]; loading: boolean; publicPage?: boolean }>(),
	emit = defineEmits<{ select: [HubModel] }>(),
	columns = computed(() => hubModelColumns(Boolean(props.publicPage))),
	money = useMoneyFormatter();
const colors = ["green", "blue", "purple", "orange", "red", "yellow"];
function limits(row: HubModel) {
	return (
		[...(row.rpm ? ["RPM: " + row.rpm.toLocaleString()] : []), ...(row.tpm ? ["TPM: " + row.tpm.toLocaleString()] : [])].join(", ") ||
		"N/A"
	);
}
function cost(value: number | null | undefined, row: HubModel) {
	return value != null ? money(value * 1e6, props.publicPage ? 4 : 2, row) : props.publicPage ? "Free" : "-";
}
</script>
<template>
	<ModelHubDataTableComponent :rows="rows" :columns="columns" :loading="loading" default-sort="model_group" row-key="model_group">
		<template #cell-model_group="{ row }"
			><div v-if="publicPage" class="hub-cell-clip">
				<UiTooltip :title="row.model_group"
					><button type="button" class="hub-public-name" @click="emit('select', row)">
						<span>{{ row.model_group }}</span>
					</button></UiTooltip
				>
			</div>
			<div v-else class="hub-stack">
				<div class="hub-inline">
					<strong class="hub-text-sm">{{ row.model_group }}</strong
					><ModelHubCopyComponent :value="row.model_group" title="Copy model name" />
				</div>
				<p class="hub-mobile-only hub-text-xs">{{ row.providers.join(", ") }}</p>
			</div></template
		>
		<template #cell-providers="{ row }"
			><div class="hub-tags">
				<template v-if="publicPage"
					><span v-for="provider in row.providers" :key="provider" class="hub-provider"
						><ProviderLogoComponent
							:provider="provider"
							:logo="getModelLogoAndName(provider, row.model_group).logo"
							image-class="hub-provider__image"
							fallback-class="hub-hidden"
						/><span>{{ provider }}</span></span
					></template
				><template v-else
					><ModelHubBadgeComponent
						class="hub-text-xs"
						v-for="provider in row.providers.slice(0, 2)"
						:key="provider"
						color="blue"
						antd
						>{{ provider }}</ModelHubBadgeComponent
					><small v-if="row.providers.length > 2">+{{ row.providers.length - 2 }}</small></template
				>
			</div></template
		>
		<template #cell-mode="{ row }"
			><span v-if="publicPage" class="hub-inline"
				><span>{{
					row.mode?.toLowerCase() === "chat"
						? "💬"
						: row.mode?.toLowerCase() === "rerank"
							? "🔄"
							: row.mode?.toLowerCase() === "embedding"
								? "📄"
								: "🤖"
				}}</span
				>{{ row.mode || "Chat" }}</span
			><ModelHubBadgeComponent v-else-if="row.mode" color="green" size="sm">{{ row.mode }}</ModelHubBadgeComponent
			><span v-else>-</span></template
		>
		<template #cell-max_input_tokens="{ row }"
			><template v-if="publicPage">{{ publicTokens(row.max_input_tokens) }}</template>
			<div v-else class="hub-text-xs">
				<span>{{ row.max_input_tokens ? compactTokens(row.max_input_tokens) : "-" }}</span> /<span>{{ " " }}</span
				><span>{{ row.max_output_tokens ? compactTokens(row.max_output_tokens) : "-" }}</span>
			</div></template
		>
		<template #cell-max_output_tokens="{ row }">{{ publicTokens(row.max_output_tokens) }}</template>
		<template #cell-input_cost_per_token="{ row }"
			><template v-if="publicPage">{{ cost(row.input_cost_per_token, row) }}</template>
			<div v-else class="hub-stack hub-text-xs">
				<p>{{ cost(row.input_cost_per_token, row) }}</p>
				<p class="hub-text-gray-500">{{ cost(row.output_cost_per_token, row) }}</p>
			</div></template
		>
		<template #cell-output_cost_per_token="{ row }">{{ cost(row.output_cost_per_token, row) }}</template>
		<template #cell-features="{ row }"
			><ModelHubOverflowTagsComponent v-if="publicPage" :values="modelCapabilities(row).map(formatCapabilityName)" label="Features" />
			<div v-else class="hub-tags">
				<span v-if="!modelCapabilities(row).length" class="hub-text-xs">-</span
				><ModelHubBadgeComponent
					v-for="(capability, index) in modelCapabilities(row)"
					:key="capability"
					:color="colors[index % colors.length]"
					size="xs"
					>{{ formatCapabilityName(capability) }}</ModelHubBadgeComponent
				>
			</div></template
		>
		<template #cell-health_status="{ row }"
			><UiTooltip
				><ModelHubBadgeComponent
					:color="row.health_status === 'healthy' ? 'green' : row.health_status === 'unhealthy' ? 'red' : 'default'"
					antd
					><span class="hub-capitalize">{{ row.health_status ?? "Unknown" }}</span></ModelHubBadgeComponent
				><template #content
					><div>
						{{ row.health_response_time ? "Response Time: " + Number(row.health_response_time).toFixed(2) + "ms" : "N/A" }}
					</div>
					<div>
						{{ row.health_checked_at ? "Last Checked: " + new Date(row.health_checked_at).toLocaleString() : "N/A" }}
					</div></template
				></UiTooltip
			></template
		>
		<template #cell-rpm="{ row }"
			><span class="hub-text-xs hub-limits">{{ limits(row) }}</span></template
		>
		<template #cell-is_public_model_group="{ row }"
			><ModelHubBadgeComponent :color="row.is_public_model_group === true ? 'green' : 'gray'" size="xs">{{
				row.is_public_model_group === true ? "Yes" : "No"
			}}</ModelHubBadgeComponent></template
		>
		<template #cell-details="{ row }"
			><UiButton appearance="tremor" size="small" class="hub-details-button" @click="emit('select', row)"
				><template #icon><UiIcon name="InfoCircleOutlined" :size="12" /></template><span class="hub-desktop-detail">Details</span
				><span class="hub-mobile-detail">Info</span></UiButton
			></template
		>
	</ModelHubDataTableComponent>
</template>
