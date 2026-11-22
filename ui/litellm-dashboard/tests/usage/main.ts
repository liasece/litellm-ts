import { createApp } from "vue";
import QuotaWindowsHarness from "./QuotaWindowsHarness.vue";
import "../../src/features/platform/ui/styles/index.css";
import "../../src/features/usage/styles/UsageQuotaStyles.css";
createApp(QuotaWindowsHarness).mount("#quota-windows");
