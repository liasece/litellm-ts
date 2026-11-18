<script setup lang="ts">
import { ref } from "vue";
import ModelAliasConvertDialog from "../../src/features/models/ui/ModelAliasConvertDialogComponent.vue";
import type { DisplayProxyModel } from "../../src/features/models/support/ModelModels";
/** 两条部署同属一个公共名：转换要一起删掉，否则剩下的 override 会盖住新别名。 */
function deployment(id: string, name = "gpt-5.5"): DisplayProxyModel {
	return {
		model_name: name,
		litellm_params: { model: "openai/" + name },
		model_info: { id, db_model: true, override_model_name: "gpt-5.6-terra" },
		provider: "openai",
		litellm_model_name: "openai/" + name,
		input_cost: null,
		output_cost: null,
		cache_read_input_cost: null,
		api_base: null,
		cleanedLitellmParams: {},
		max_tokens: null,
		max_input_tokens: null,
	};
}
const model = deployment("id-1");
const open = ref(true),
	converted = ref("");
</script>
<template>
	<ModelAliasConvertDialog
		v-if="open"
		:open="true"
		:model="model"
		@close="open = false"
		@converted="converted = Object.keys($event).join(',')"
	/>
	<p data-testid="converted">{{ converted }}</p>
</template>
