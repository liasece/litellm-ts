<script setup lang="ts">
import { ref } from "vue";
import UiTabs from "../../platform/ui/UiTabs.vue";
import ModelAddForm from "./ModelAddFormComponent.vue";
import ModelAutoRouter from "./ModelAutoRouterComponent.vue";
import type { ModelCatalog } from "../support/ModelModels";
defineProps<{ catalog: ModelCatalog; admin: boolean; teamAdmin: boolean; premium: boolean; userId: string }>();
defineEmits<{ created: [] }>();
const tab = ref("model");
</script>
<template>
	<UiTabs
		v-model="tab"
		appearance="tremor"
		class="model-add-tabs"
		:items="[
			{ key: 'model', label: 'Add Model' },
			{ key: 'router', label: 'Add Auto Router' },
		]"
		><ModelAddForm
			v-if="tab === 'model'"
			:catalog="catalog"
			:admin="admin"
			:team-admin="teamAdmin"
			:premium="premium"
			:user-id="userId"
			@created="$emit('created')" /><ModelAutoRouter v-else :catalog="catalog" :admin="admin" @created="$emit('created')"
	/></UiTabs>
</template>
