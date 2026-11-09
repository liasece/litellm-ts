<script setup lang="ts">
import { ref } from "vue";
import ModelMappingHelp from "../../src/features/models/ui/ModelMappingHelpComponent.vue";
import ModelActions from "../../src/features/models/ui/ModelActionsDialogComponent.vue";
import { normalizeModelDetails } from "../../src/features/models/logic/ModelDataLogic";
import { emptyModelCatalog } from "../../src/features/models/support/ModelModels";
import NotificationLayer from "../../src/features/notifications/ui/NotificationLayerComponent.vue";
const model = normalizeModelDetails({
	model_name: "research",
	litellm_params: { model: "openai/gpt-4.1" },
	model_info: { id: "fixture-model", fallbacks: [] },
});
const mode = ref<"fallback" | "override" | "settings" | null>(null);
const changed = ref(0);
</script>
<template>
	<main style="padding: 24px">
		<button @click="mode = 'fallback'">Open fallbacks</button><button @click="mode = 'settings'">Open storage settings</button
		><output data-testid="model-actions-changed">{{ changed }}</output>
	</main>
	<ModelActions
		:mode="mode"
		:model="model"
		:catalog="emptyModelCatalog()"
		:model-groups="['research', 'backup', 'last']"
		@close="mode = null"
		@changed="changed++"
	/>
	<div class="model-mapping-heading" style="margin: 24px">Public model naming<ModelMappingHelp kind="public" /></div>
	<NotificationLayer />
</template>
