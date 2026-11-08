<script setup lang="ts">
import { ref } from "vue";
import ModelSettingsGrid from "../../src/features/models/ui/ModelSettingsGridComponent.vue";
import { normalizeModelDetails } from "../../src/features/models/logic/ModelDataLogic";
import { createModelEditDraft } from "../../src/features/models/logic/ModelEditLogic";
import { emptyModelCatalog } from "../../src/features/models/support/ModelModels";
const model = normalizeModelDetails({
	model_name: "gpt-4.1",
	litellm_params: { model: "openai/gpt-4.1", custom_llm_provider: "openai", tpm: 10 },
	model_info: { id: "fixture-model", input_cost_per_token: 0.000002, output_cost_per_token: 0.000008 },
});
const catalog = emptyModelCatalog();
catalog.providerFields = [{ provider: "OpenAI", provider_display_name: "OpenAI", litellm_provider: "openai", credential_fields: [] }];
const draft = ref(createModelEditDraft(model));
</script>
<template>
	<div style="width: 912px" class="model-edit-dialog">
		<ModelSettingsGrid v-model="draft" :model="model" :catalog="catalog" :model-names="['gpt-4.1']" editing /><output
			data-testid="model-tpm"
			>{{ draft.tpm }}</output
		><output data-testid="model-cache-control">{{ draft.cache_control }}</output>
	</div>
</template>
