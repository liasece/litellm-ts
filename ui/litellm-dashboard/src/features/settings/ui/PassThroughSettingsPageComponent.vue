<script setup lang="ts">
import { computed, onMounted, reactive } from "vue";
import { useAuthenticationStore } from "../../identity/stores/AuthenticationStore";
import { emptyModelCatalog } from "../../models/support/ModelModels";
import { loadModelCatalog } from "../../models/data/ModelCatalogData";
import PassThroughEndpoints from "../../models/ui/PassThroughEndpointsComponent.vue";
import "../../models/ui/ModelsStyles.css";
import "../../models/ui/ModelFormsStyles.css";
import "../../models/ui/ModelPassThroughStyles.css";
const auth = useAuthenticationStore(),
	catalog = reactive(emptyModelCatalog());
const role = computed(() => auth.userRole.value);
onMounted(async () => Object.assign(catalog, await loadModelCatalog()));
</script>
<template>
	<div class="model-pass-settings-page">
		<PassThroughEndpoints
			:catalog="catalog"
			:admin="role === 'Admin' || role === 'admin'"
			:premium="Boolean(auth.state.session?.premium_user)"
		/>
	</div>
</template>
