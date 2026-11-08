import { createApp } from "vue";
import KeyHeaderHarness from "./KeyHeaderHarness.vue";
import "../../src/features/platform/ui/styles/index.css";
import "../../src/features/virtual-keys/ui/styles/VirtualKeyDetails.css";
createApp(KeyHeaderHarness).mount("#key-header");
