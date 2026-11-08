<script setup lang="ts">
import { ref } from "vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import { WELL_KNOWN_LOGOS } from "../support/McpLogoSupport";
const value = defineModel<string | undefined>();
const failed = ref(new Set<string>());
function custom(text: string | number | null) {
	value.value = String(text || "").trim() || undefined;
}
function hide(event: Event) {
	if (event.target instanceof HTMLImageElement) event.target.style.display = "none";
}
</script>
<template>
	<section class="tools-mcp-logo-selector">
		<label
			>Logo
			<UiTooltip title="Select a well-known logo or paste a URL to any image. The logo is shown on the admin and chat pages."
				><UiIcon name="InfoCircleOutlined" :size="14" /></UiTooltip
		></label>
		<div v-if="value" class="tools-mcp-logo-preview">
			<img :src="value" alt="Selected logo" width="40" height="40" @error="hide" /><span>{{ value }}</span
			><button type="button" aria-label="Remove logo" @click="value = undefined">✕</button>
		</div>
		<div class="tools-mcp-logo-grid">
			<template v-for="logo in WELL_KNOWN_LOGOS" :key="logo.name"
				><UiTooltip v-if="!failed.has(logo.url)" :title="logo.name"
					><button
						type="button"
						:class="{ 'tools-mcp-logo-selected': value === logo.url }"
						@click="value = value === logo.url ? undefined : logo.url"
					>
						<img :src="logo.url" :alt="logo.name" width="20" height="20" @error="failed.add(logo.url)" /></button></UiTooltip
			></template>
		</div>
		<UiInput
			class="tools-mcp-custom-logo"
			:model-value="value && !WELL_KNOWN_LOGOS.some((logo) => logo.url === value) ? value : ''"
			placeholder="Or paste a custom logo URL..."
			size="small"
			@update:model-value="custom"
			><template #prefix><UiIcon name="LinkOutlined" :size="14" /></template
		></UiInput>
	</section>
</template>
