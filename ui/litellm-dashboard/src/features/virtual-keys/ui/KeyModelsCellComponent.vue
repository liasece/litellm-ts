<script setup lang="ts">
import { ref } from "vue";
import UiTag from "../../platform/ui/UiTag.vue";
import UiHeroIcon from "../../platform/ui/UiHeroIcon.vue";
const props = defineProps<{ models: readonly string[] }>();
const expanded = ref(false);
function label(model: string) {
	if (model === "all-proxy-models") return "All Proxy Models";
	if (model === "all-team-models") return "All Team Models";
	return model.length > 30 ? model.slice(0, 30) + "..." : model;
}
</script>
<template>
	<div class="vk-models-cell" :class="{ 'vk-models-cell--empty': !models.length }">
		<UiTag v-if="!props.models.length" color="red" appearance="tremor" size="xs"><p class="vk-model-label">All Proxy Models</p></UiTag>
		<template v-else>
			<button
				v-if="models.length > 3"
				type="button"
				class="vk-models-toggle"
				:aria-expanded="expanded"
				aria-label="Expand models"
				@click="expanded = !expanded"
			>
				<UiHeroIcon :name="expanded ? 'ChevronDownIcon' : 'ChevronRightIcon'" :size="12" />
			</button>
			<div class="vk-models-list">
				<UiTag
					v-for="(model, index) in expanded ? models : models.slice(0, 3)"
					:key="model + index"
					:color="model === 'all-proxy-models' ? 'red' : 'blue'"
					appearance="tremor"
					size="xs"
				>
					<p class="vk-model-label">{{ label(model) }}</p>
				</UiTag>
				<UiTag v-if="models.length > 3 && !expanded" appearance="tremor" size="xs" color="gray" class="vk-models-more">
					<p class="vk-model-label">+{{ models.length - 3 }} {{ models.length === 4 ? "more model" : "more models" }}</p>
				</UiTag>
			</div>
		</template>
	</div>
</template>
