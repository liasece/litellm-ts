<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiLucideIcon from "../../platform/ui/UiLucideIcon.vue";
import AccessHeroIconComponent from "../../access-control/ui/AccessHeroIconComponent.vue";
import SearchToolTesterComponent from "./SearchToolTesterComponent.vue";
import type { SearchTool, SearchProvider } from "../support/SearchToolModels";
defineProps<{ tool: SearchTool; providers: SearchProvider[] }>();
defineEmits<{ back: []; error: [message: string]; notice: [message: string] }>();
const copied = ref<Record<string, boolean>>({}),
	timers = new Set<ReturnType<typeof setTimeout>>();
async function copy(text: string | undefined, key: string) {
	if (!text) return;
	await navigator.clipboard.writeText(text);
	copied.value[key] = true;
	const timer = setTimeout(() => {
		copied.value[key] = false;
		timers.delete(timer);
	}, 2000);
	timers.add(timer);
}
onBeforeUnmount(() => timers.forEach(clearTimeout));
</script>
<template>
	<section class="tools-search-details">
		<header>
			<UiButton appearance="tremor" variant="link" @click="$emit('back')"
				><template #icon><AccessHeroIconComponent name="ArrowLeft" /></template>Back to All Search Tools</UiButton
			>
			<div>
				<h3>{{ tool.search_tool_name }}</h3>
				<UiButton
					size="small"
					variant="text"
					:class="{ 'tools-copy-done': copied.name }"
					aria-label="Copy search tool name"
					@click="copy(tool.search_tool_name, 'name')"
					><template #icon><UiLucideIcon :name="copied.name ? 'Check' : 'Copy'" :size="12" /></template
				></UiButton>
			</div>
			<div>
				<code>{{ tool.search_tool_id || "From config (YAML)" }}</code
				><UiButton
					v-if="tool.search_tool_id"
					size="small"
					variant="text"
					:class="{ 'tools-copy-done': copied.id }"
					aria-label="Copy search tool ID"
					@click="copy(tool.search_tool_id, 'id')"
					><template #icon><UiLucideIcon :name="copied.id ? 'Check' : 'Copy'" :size="12" /></template
				></UiButton>
			</div>
		</header>
		<div class="tools-search-cards">
			<UiCard
				><p>Provider</p>
				<h3>
					{{
						providers.find((p) => p.provider_name === tool.litellm_params.search_provider)?.ui_friendly_name ||
						tool.litellm_params.search_provider
					}}
				</h3></UiCard
			><UiCard
				><p>API Key</p>
				<p>{{ tool.litellm_params.api_key ? "****" : "Not set" }}</p></UiCard
			><UiCard
				><p>Created At</p>
				<p>{{ tool.created_at ? new Date(tool.created_at).toLocaleString() : "Unknown" }}</p></UiCard
			>
		</div>
		<UiCard v-if="tool.search_tool_info?.description" class="tools-search-description-card"
			><p>Description</p>
			<p>{{ tool.search_tool_info.description }}</p></UiCard
		><SearchToolTesterComponent :name="tool.search_tool_name" @error="$emit('error', $event)" @notice="$emit('notice', $event)" />
	</section>
</template>
