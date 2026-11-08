<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue";
import ModelAliases from "../../src/features/models/ui/ModelAliasesComponent.vue";
import ModelHealth from "../../src/features/models/ui/ModelHealthComponent.vue";
import ModelRetries from "../../src/features/models/ui/ModelRetrySettingsComponent.vue";
import ModelPriceData from "../../src/features/models/ui/ModelPriceDataComponent.vue";
import NotificationLayer from "../../src/features/notifications/ui/NotificationLayerComponent.vue";
import { normalizeModelDetails } from "../../src/features/models/logic/ModelDataLogic";
import { createModelHealthStore } from "../../src/features/models/stores/ModelHealthStore";
import { emptyModelCatalog } from "../../src/features/models/support/ModelModels";
const mode = new URLSearchParams(location.search).get("mode");
const catalog = emptyModelCatalog();
catalog.router = { num_retries: 2, retry_policy: { RateLimitErrorRetries: 3 }, model_group_alias: { research: "base" } };
const models = [
	normalizeModelDetails({ model_name: "zeta", litellm_params: { model: "zeta" }, model_info: { id: "z-model" } }),
	normalizeModelDetails({ model_name: "alpha", litellm_params: { model: "alpha" }, model_info: { id: "a-model" } }),
];
const selected = ref("");
const health = createModelHealthStore();
health.initialize(models.map((model) => model.model_info.id ?? ""));
onBeforeUnmount(health.dispose);
</script>
<template>
	<main style="padding: 16px">
		<ModelAliases v-if="mode === 'aliases'" :catalog="catalog" />
		<ModelHealth v-else-if="mode === 'health'" :models="models" :catalog="catalog" :health="health" @select="selected = $event" />
		<ModelRetries v-else-if="mode === 'retries'" :catalog="catalog" :model-groups="['base', 'backup']" />
		<ModelPriceData v-else />
		<output data-testid="selected-health-model">{{ selected }}</output>
	</main>
	<NotificationLayer />
</template>
