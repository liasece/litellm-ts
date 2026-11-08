import { createApp } from "vue";
import CredentialHarness from "./CredentialHarness.vue";
import "../../src/features/platform/ui/styles/index.css";
import "../../src/features/models/ui/ModelsStyles.css";
createApp(CredentialHarness).mount("#credential-fixture");
