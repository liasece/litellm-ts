<script setup lang="ts">
import { provide } from "vue";
import { applicationStoreKey, createApplicationStore } from "../../src/features/application/stores/ApplicationStore";
import LogsPageComponent from "../../src/features/logs/ui/LogsPageComponent.vue";
import { authenticationStoreKey, createAuthenticationStore } from "../../src/features/identity/stores/AuthenticationStore";
import { createPriceDisplayStore, priceDisplayStoreKey } from "../../src/features/platform/stores/PriceDisplayStore";

provide(authenticationStoreKey, createAuthenticationStore());
provide(applicationStoreKey, createApplicationStore());
provide(priceDisplayStoreKey, createPriceDisplayStore());
</script>

<template>
	<LogsPageComponent />
</template>
