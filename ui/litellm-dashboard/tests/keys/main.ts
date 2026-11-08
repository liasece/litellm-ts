import { createApp } from "vue";
import KeyEditHarness from "./KeyEditHarness.vue";
import "../../src/features/platform/ui/styles/index.css";
import "../../src/features/virtual-keys/ui/styles/VirtualKeyDetails.css";
import { authenticationStoreKey, createAuthenticationStore } from "../../src/features/identity/stores/AuthenticationStore";
import { priceDisplayStoreKey, createPriceDisplayStore } from "../../src/features/platform/stores/PriceDisplayStore";
createApp(KeyEditHarness)
	.provide(authenticationStoreKey, createAuthenticationStore())
	.provide(priceDisplayStoreKey, createPriceDisplayStore())
	.mount("#key-edit");
