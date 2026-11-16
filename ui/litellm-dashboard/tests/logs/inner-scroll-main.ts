import { createApp } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import LogsPageHarness from "./LogsPageHarness.vue";
import "../../src/features/platform/ui/styles/index.css";

// 模拟生产 shell 的 application-main：页面本身不滚动，只有内层容器滚动。
sessionStorage.setItem("liveTailEnabled", "false");
const router = createRouter({
	history: createMemoryHistory(),
	routes: [{ path: "/:pathMatch(.*)*", component: { render: () => null } }],
});
await router.push("/logs");
createApp(LogsPageHarness).use(router).mount("#logs");
