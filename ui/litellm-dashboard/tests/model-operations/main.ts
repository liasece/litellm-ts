import { createApp } from "vue";
import OperationsHarness from "./OperationsHarness.vue";
import "../../src/features/platform/ui/styles/index.css";
import "../../src/features/models/ui/ModelsStyles.css";
import "../../src/features/models/ui/ModelOperationsStyles.css";
createApp(OperationsHarness).mount("#model-operations");
