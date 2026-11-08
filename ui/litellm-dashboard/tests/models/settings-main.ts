import { createApp } from "vue";
import SettingsHarness from "./SettingsHarness.vue";
import "../../src/features/platform/ui/styles/index.css";
import "../../src/features/models/ui/ModelsStyles.css";
import { priceDisplayStoreKey, createPriceDisplayStore } from "../../src/features/platform/stores/PriceDisplayStore";
createApp(SettingsHarness).provide(priceDisplayStoreKey, createPriceDisplayStore()).mount("#model-settings");
