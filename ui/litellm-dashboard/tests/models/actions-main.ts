import { createApp } from "vue";
import ActionsHarness from "./ActionsHarness.vue";
import "../../src/features/platform/ui/styles/index.css";
import "../../src/features/models/ui/ModelsStyles.css";
import "../../src/features/models/ui/ModelFormsStyles.css";
createApp(ActionsHarness).mount("#model-actions");
