<script setup lang="ts">
import { provide } from "vue";
import { createAuthenticationStore, authenticationStoreKey } from "../../src/features/identity/stores/AuthenticationStore";
import { createApplicationStore, applicationStoreKey } from "../../src/features/application/stores/ApplicationStore";
import { createPriceDisplayStore, priceDisplayStoreKey } from "../../src/features/platform/stores/PriceDisplayStore";
import ModelHubPageComponent from "../../src/features/model-hub/ui/ModelHubPageComponent.vue";
import PublicModelHubPageComponent from "../../src/features/model-hub/ui/PublicModelHubPageComponent.vue";
import NotificationLayerComponent from "../../src/features/notifications/ui/NotificationLayerComponent.vue";
import "../../src/features/application/ui/ApplicationShellStyles.css";
const auth = createAuthenticationStore(),
	publicView = ["public", "table"].includes(new URLSearchParams(window.location.search).get("view") ?? "");
auth.state.loading = false;
auth.state.initialized = true;
if (!publicView)
	auth.state.session = {
		authenticated: true,
		user_id: "fixture-admin",
		user_email: "admin@example.test",
		user_role: "proxy_admin",
		login_method: "fixture",
		premium_user: true,
		disabled_non_admin_personal_key_creation: false,
		server_root_path: "",
	};
provide(authenticationStoreKey, auth);
provide(applicationStoreKey, createApplicationStore());
provide(priceDisplayStoreKey, createPriceDisplayStore());
</script>
<template><PublicModelHubPageComponent v-if="publicView" /><ModelHubPageComponent v-else /><NotificationLayerComponent /></template>
