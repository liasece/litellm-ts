<script setup lang="ts">
import { onBeforeUnmount, onMounted } from "vue";
import { createPublicModelHubStore } from "../../stores/PublicModelHubStore";
import { useApplicationStore } from "../../../application/stores/ApplicationStore";
import { applicationApi } from "../../../application/api/ApplicationApi";
import ApplicationNavbar from "../../../application/ui/ApplicationNavbar.vue";
import PublicModelHubIntroComponent from "./PublicModelHubIntroComponent.vue";
import PublicModelHubTabsComponent from "./PublicModelHubTabsComponent.vue";
import ModelHubModelDetailsComponent from "../details/ModelHubModelDetailsComponent.vue";
import ModelHubAgentDetailsComponent from "../details/ModelHubAgentDetailsComponent.vue";
import ModelHubMcpDetailsComponent from "../details/ModelHubMcpDetailsComponent.vue";
const store = createPublicModelHubStore(),
	state = store.state,
	application = useApplicationStore();
let disposed = false;
onMounted(() => {
	void store.load();
	void applicationApi
		.theme()
		.then((theme) => {
			if (!disposed) application.state.theme = theme;
		})
		.catch(() => undefined);
});
onBeforeUnmount(() => {
	disposed = true;
	store.dispose();
});
</script>
<template>
	<div class="hub-public">
		<ApplicationNavbar :collapsed="false" :mobile-open="false" public-page />
		<main class="hub-public__content">
			<PublicModelHubIntroComponent :store="store" /><PublicModelHubTabsComponent :store="store" />
		</main>
		<ModelHubModelDetailsComponent :model="state.model" public-page @close="state.model = null" />
		<ModelHubAgentDetailsComponent :agent="state.agent" public-page @close="state.agent = null" />
		<ModelHubMcpDetailsComponent :server="state.server" public-page @close="state.server = null" />
	</div>
</template>
