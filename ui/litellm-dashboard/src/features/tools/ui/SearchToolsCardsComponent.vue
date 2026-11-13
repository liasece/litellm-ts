<script setup lang="ts">
import AccessActionComponent from "../../access-control/ui/AccessActionComponent.vue";
import UiTag from "../../platform/ui/UiTag.vue";
import ProviderLogo from "../../providers/ui/ProviderLogoComponent.vue";
import type { SearchProvider, SearchTool } from "../support/SearchToolModels";

const props = defineProps<{ rows: readonly SearchTool[]; providers: readonly SearchProvider[] }>();
const emit = defineEmits<{ select: [tool: SearchTool]; edit: [tool: SearchTool]; delete: [tool: SearchTool] }>();
function providerName(value: SearchTool): string {
	return (
		props.providers.find((provider) => provider.provider_name === value.litellm_params.search_provider)?.ui_friendly_name ||
		value.litellm_params.search_provider ||
		"-"
	);
}
function providerLogo(value: SearchTool): string | null {
	const name = value.litellm_params.search_provider;
	return name ? "/ui/assets/logos/" + name + ".png" : null;
}
function date(value: unknown): string {
	return value ? new Date(String(value)).toLocaleDateString() : "-";
}
</script>

<template>
	<ul class="tools-tool-cards">
		<li v-for="tool in rows" :key="tool.search_tool_id" class="tools-tool-card" @click="emit('select', tool)">
			<div class="tools-tool-card__head">
				<div class="tools-tool-card__identity">
					<span class="tools-tool-card__name" :title="tool.search_tool_name">{{ tool.search_tool_name }}</span>
					<span class="tools-tool-card__provider"
						><ProviderLogo :provider="providerName(tool)" :logo="providerLogo(tool)" />{{ providerName(tool) }}</span
					>
				</div>
				<UiTag :color="tool.is_from_config ? 'default' : 'blue'">{{ tool.is_from_config ? "Config" : "DB" }}</UiTag>
			</div>
			<div class="tools-tool-card__facts">
				<div class="tools-tool-card__fact">
					<span>Search Tool ID</span>
					<button
						v-if="!tool.is_from_config"
						type="button"
						class="tools-resource-id"
						:title="tool.search_tool_id"
						@click.stop="emit('select', tool)"
					>
						{{ tool.search_tool_id }}
					</button>
					<span v-else class="tools-tool-card__muted">From config file</span>
				</div>
				<div class="tools-tool-card__fact">
					<span>Created</span>
					<span>{{ date(tool.created_at) }}</span>
				</div>
				<div class="tools-tool-card__fact">
					<span>Updated</span>
					<span>{{ date(tool.updated_at) }}</span>
				</div>
			</div>
			<div class="tools-tool-card__actions">
				<AccessActionComponent
					name="SquarePen"
					:label="
						tool.is_from_config
							? 'Config search tool cannot be edited on the dashboard. Please edit it from the config file.'
							: 'Edit search tool'
					"
					:disabled="tool.is_from_config"
					@click="emit('edit', tool)"
				/>
				<AccessActionComponent
					name="Trash2"
					:label="
						tool.is_from_config
							? 'Config search tool cannot be deleted on the dashboard. Please delete it from the config file.'
							: 'Delete search tool'
					"
					:disabled="tool.is_from_config"
					@click="emit('delete', tool)"
				/>
			</div>
		</li>
	</ul>
</template>
