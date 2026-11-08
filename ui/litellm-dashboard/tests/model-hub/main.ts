import { createApp } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import ModelHubHarness from "./ModelHubHarness.vue";
import "../../src/features/platform/ui/styles/index.css";
const parameters = new URLSearchParams(window.location.search),
	view = parameters.get("view"),
	path = view === "table" ? "/ui/model_hub_table" : view === "public" ? "/ui/model_hub" : "/ui/model-hub",
	router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:pathMatch(.*)*", component: ModelHubHarness }] });
await router.push({ path, query: parameters.get("key") ? { key: parameters.get("key") } : {} });
createApp(ModelHubHarness).use(router).mount("#app");
