import { createApp } from "vue";
import ApplicationRoot from "../features/application/ui/ApplicationRoot.vue";
import { applicationRouter } from "../features/application/runtime/ApplicationRouter";
import "../features/platform/ui/styles/index.css";

createApp(ApplicationRoot).use(applicationRouter).mount("#app");
