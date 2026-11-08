import { createApp, defineComponent } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import PlaygroundHarness from "./PlaygroundHarness.vue";
import "../../src/features/platform/ui/styles/index.css";
const router = createRouter({
	history: createMemoryHistory("/ui"),
	routes: [{ path: "/:pathMatch(.*)*", component: defineComponent({ render: () => null }) }],
});
const id = new URLSearchParams(window.location.search).get("id");
await router.replace({ path: "/chat", query: id ? { id } : {} });
createApp(PlaygroundHarness).use(router).mount("#playground");
