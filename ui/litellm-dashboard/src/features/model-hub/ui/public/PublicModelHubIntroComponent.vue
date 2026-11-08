<script setup lang="ts">
import { computed } from "vue";
import type { PublicModelHubStore } from "../../stores/PublicModelHubStore";
import { parseHubLinks } from "../../logic/ModelHubLinksLogic";
import UiCard from "../../../platform/ui/UiCard.vue";
import ModelHubHeroIconComponent from "../common/ModelHubHeroIconComponent.vue";
const props = defineProps<{ store: PublicModelHubStore }>(),
	links = computed(() => parseHubLinks(props.store.state.links));
function open(url: string) {
	window.open(url, "_blank");
}
</script>
<template>
	<UiCard appearance="tremor" class="hub-public-card"
		><h2>About</h2>
		<p class="hub-public-card__description">{{ store.state.description || "Proxy Server to call 100+ LLMs in the OpenAI format." }}</p>
		<div class="hub-public-card__version">
			<span><span>🔧</span>Built with litellm: v{{ store.state.version }}</span>
		</div></UiCard
	>
	<UiCard v-if="links.length" appearance="tremor" class="hub-public-card"
		><h2>Useful Links</h2>
		<div class="hub-public-links">
			<button v-for="link in links" :key="link.id" type="button" @click="open(link.url)">
				<ModelHubHeroIconComponent name="ExternalLink" :size="16" /><span>{{ link.displayName }}</span>
			</button>
		</div></UiCard
	>
	<UiCard appearance="tremor" class="hub-public-card"
		><h2>Health and Endpoint Status</h2>
		<p class="hub-public-card__health">Service status: {{ store.state.serviceStatus }}</p></UiCard
	>
</template>
