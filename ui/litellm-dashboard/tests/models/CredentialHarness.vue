<script setup lang="ts">
import { ref } from "vue";
import ModelCredentials from "../../src/features/models/ui/ModelCredentialsComponent.vue";
import { emptyModelCatalog } from "../../src/features/models/support/ModelModels";
const catalog = emptyModelCatalog();
catalog.credentials = [{ credential_name: "Research OpenAI", credential_info: { custom_llm_provider: "OpenAI" }, credential_values: {} }];
const changed = ref(0);
</script>
<template>
	<ModelCredentials :catalog="catalog" @changed="changed++" /><output data-testid="credentials-changed">{{ changed }}</output>
</template>
