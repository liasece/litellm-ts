<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { modelHubApi } from "../../api/ModelHubApi";
import { hubMarketplaceColumns } from "../../data/ModelHubColumns";
import {
	categoryColor,
	filterMarketplace,
	installCommand,
	marketplaceCategories,
	sourceDisplay,
} from "../../logic/ModelHubMarketplaceLogic";
import type { HubMarketplace } from "../../support/ModelHubModels";
import ModelHubDataTableComponent from "../common/ModelHubDataTableComponent.vue";
import ModelHubBadgeComponent from "../common/ModelHubBadgeComponent.vue";
import ModelHubCopyComponent from "../common/ModelHubCopyComponent.vue";
import UiInput from "../../../platform/ui/UiInput.vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
import UiTabs from "../../../platform/ui/UiTabs.vue";
import UiCard from "../../../platform/ui/UiCard.vue";
const data = ref<HubMarketplace | null>(null),
	loading = ref(true),
	search = ref(""),
	category = ref("All"),
	controller = new AbortController();
let disposed = false;
const rows = computed(() => filterMarketplace(data.value?.plugins ?? [], search.value, category.value)),
	categories = computed(() => (data.value ? marketplaceCategories(data.value.plugins) : ["All"])),
	tabs = computed(() =>
		categories.value.map((key) => {
			const count = filterMarketplace(data.value?.plugins ?? [], search.value, key).length;
			return { key, label: key + (count > 0 ? " (" + count + ")" : "") };
		}),
	);
onMounted(async () => {
	try {
		const result = await modelHubApi.marketplace(controller.signal);
		if (!disposed) data.value = result;
	} catch {
		/* The original marketplace shows its empty failure card. */
	} finally {
		if (!disposed) loading.value = false;
	}
});
onBeforeUnmount(() => {
	disposed = true;
	controller.abort();
});
</script>
<template>
	<UiCard v-if="!data && !loading" appearance="tremor" class="hub-marketplace__failure"
		><div class="hub-marketplace__failure-content">Failed to load marketplace. Please try again later.</div></UiCard
	>
	<div v-else class="hub-marketplace">
		<UiInput
			v-model="search"
			size="large"
			clearable
			placeholder="Search plugins by name, description, or keywords..."
			class="hub-marketplace__search"
			><template #prefix><UiIcon name="SearchOutlined" /></template
		></UiInput>
		<UiTabs v-model="category" :items="tabs" appearance="tremor" class="hub-admin-tabs" />
		<UiCard appearance="tremor">
			<ModelHubDataTableComponent :rows="rows" :columns="hubMarketplaceColumns" :loading="loading" default-sort="name" row-key="name">
				<template #cell-name="{ row }"
					><div class="hub-stack">
						<div class="hub-inline">
							<strong class="hub-text-sm">{{ row.name }}</strong
							><ModelHubCopyComponent :value="installCommand(row)" title="Copy install command" />
						</div>
						<p class="hub-mobile-only hub-text-xs hub-text-gray-600">{{ row.description || "No description" }}</p>
					</div></template
				>
				<template #cell-description="{ row }"
					><p class="hub-clamp hub-text-xs">{{ row.description || "-" }}</p></template
				>
				<template #cell-version="{ row }"
					><ModelHubBadgeComponent v-if="row.version" color="blue" size="sm">v{{ row.version }}</ModelHubBadgeComponent
					><span v-else class="hub-text-xs hub-muted">-</span></template
				>
				<template #cell-category="{ row }"
					><ModelHubBadgeComponent :color="categoryColor(row.category)" size="sm">{{
						row.category || "Uncategorized"
					}}</ModelHubBadgeComponent></template
				>
				<template #cell-source="{ row }"
					><span class="hub-text-xs hub-text-gray-600">{{ sourceDisplay(row) }}</span></template
				>
				<template #cell-keywords="{ row }"
					><div class="hub-tags">
						<ModelHubBadgeComponent
							v-for="(keyword, index) in row.keywords?.slice(0, 3) || []"
							:key="index"
							color="gray"
							size="xs"
							>{{ keyword }}</ModelHubBadgeComponent
						><ModelHubBadgeComponent v-if="(row.keywords?.length || 0) > 3" color="gray" size="xs"
							>+{{ (row.keywords?.length || 0) - 3 }}</ModelHubBadgeComponent
						>
					</div></template
				>
				<template #cell-install_command="{ row }"
					><div class="hub-inline">
						<code class="hub-marketplace__command">{{ installCommand(row) }}</code
						><ModelHubCopyComponent
							:value="installCommand(row)"
							title="Copy command"
							boxed
							:size="16"
							class="hub-marketplace__copy"
						/></div
				></template>
			</ModelHubDataTableComponent>
		</UiCard>
		<p class="hub-count">
			Showing {{ rows.length }} of {{ data?.plugins.length || 0 }} plugin{{ data?.plugins.length !== 1 ? "s" : ""
			}}<template v-if="search"> matching "{{ search }}"</template><template v-if="category !== 'All'"> in {{ category }}</template>
		</p>
	</div>
</template>
<style>
.hub-marketplace__search {
	max-width: 448px;
	margin-bottom: 16px;
}
.hub-marketplace__search .ui-input__affix {
	color: #9ca3af;
}
.hub-marketplace__command {
	flex: 0 1 auto;
	min-width: 0;
	font: 12px/16px var(--ui-font-mono);
	padding: 4px 8px;
	background: #f3f4f6;
	border-radius: 4px;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	max-width: 200px;
}

.hub-marketplace__failure-content {
	padding: 48px;
	text-align: center;
	color: #6b7280;
	font-size: 12.4px;
	line-height: 18.4px;
}
</style>
