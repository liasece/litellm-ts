<script setup lang="ts">
import type { ChatInferenceStore } from "../../stores/ChatInferenceStore";
import ModelLogo from "../../../providers/ui/ModelLogoComponent.vue";
import MarkdownContent from "../../../content/ui/MarkdownContent.vue";
defineProps<{ store: ChatInferenceStore }>();
</script>
<template>
	<div class="chat-comparison">
		<div v-for="(exchange, index) in store.state.exchanges" :key="index" class="chat-comparison__exchange">
			<div class="chat-comparison__user">
				<div>{{ exchange.userMessage }}</div>
			</div>
			<div class="chat-comparison__cards">
				<article v-for="(model, modelIndex) in store.state.selected" :key="model">
					<header v-if="index === 0">
						<ModelLogo :model="model" v-bind="store.state.modelIcons.get(model)" /><strong>Response {{ modelIndex + 1 }}</strong
						><span>{{ model }}</span>
					</header>
					<div>
						<span
							v-if="index === store.state.exchanges.length - 1 && store.state.streamingModels.has(model)"
							class="chat-comparison__streaming"
							>●</span
						><MarkdownContent v-if="exchange.responses[model]" :source="exchange.responses[model]" /><span
							v-else
							class="chat-muted"
							>{{
								index === store.state.exchanges.length - 1 && store.state.streamingModels.has(model) ? "Generating…" : "—"
							}}</span
						>
					</div>
				</article>
			</div>
		</div>
	</div>
</template>
