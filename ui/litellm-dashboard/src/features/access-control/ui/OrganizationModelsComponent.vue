<script setup lang="ts">
import { ref } from "vue";
import UiTag from "../../platform/ui/UiTag.vue";
import UiLucideIcon from "../../platform/ui/UiLucideIcon.vue";
defineProps<{ models: string[] }>();
const expanded = ref(false);
function label(model: string) {
	return model === "all-proxy-models" ? "All Proxy Models" : model.length > 30 ? model.slice(0, 30) + "..." : model;
}
</script>
<template>
	<div class="access-tags">
		<button
			v-if="models.length > 3"
			type="button"
			class="access-icon-action"
			:aria-label="expanded ? 'Collapse models' : 'Expand models'"
			@click="expanded = !expanded"
		>
			<UiLucideIcon :name="expanded ? 'ChevronDown' : 'ChevronRight'" :size="16" />
		</button>
		<div class="access-tags">
			<UiTag v-if="!models.length" appearance="tremor" size="xs" color="red">All Proxy Models</UiTag
			><UiTag
				v-for="(model, index) in expanded ? models : models.slice(0, 3)"
				:key="model + index"
				appearance="tremor"
				size="xs"
				:color="model === 'all-proxy-models' ? 'red' : 'blue'"
				>{{ label(model) }}</UiTag
			><button v-if="models.length > 3 && !expanded" type="button" class="access-more-models" @click="expanded = true">
				+{{ models.length - 3 }} more model{{ models.length - 3 === 1 ? "" : "s" }}
			</button>
		</div>
	</div>
</template>
