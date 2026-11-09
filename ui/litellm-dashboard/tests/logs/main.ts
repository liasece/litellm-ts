import { createApp } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import LogsPageHarness from "./LogsPageHarness.vue";
import "../../src/features/platform/ui/styles/index.css";

// The page starts its live-tail socket from this preference; request-level tests drive refreshes themselves.
sessionStorage.setItem("liveTailEnabled", "false");
const router = createRouter({
	history: createMemoryHistory(),
	routes: [{ path: "/:pathMatch(.*)*", component: { render: () => null } }],
});
await router.push("/logs");
createApp(LogsPageHarness).use(router).mount("#logs");
