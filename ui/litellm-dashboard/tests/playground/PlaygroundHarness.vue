<script setup lang="ts">
import { provide } from "vue";
import { createAuthenticationStore, authenticationStoreKey } from "../../src/features/identity/stores/AuthenticationStore";
import { createPriceDisplayStore, priceDisplayStoreKey } from "../../src/features/platform/stores/PriceDisplayStore";
import PlaygroundPageComponent from "../../src/features/playground/ui/PlaygroundPageComponent.vue";
import MessageLayerComponent from "../../src/features/notifications/ui/MessageLayerComponent.vue";
import ChatPageComponent from "../../src/features/playground/ui/ChatPageComponent.vue";
const auth = createAuthenticationStore();
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
auth.state.loading = false;
auth.state.initialized = true;
provide(authenticationStoreKey, auth);
provide(priceDisplayStoreKey, createPriceDisplayStore());
const consumer = new URLSearchParams(window.location.search).get("view") === "consumer";
</script>
<template><ChatPageComponent v-if="consumer" /><PlaygroundPageComponent v-else /><MessageLayerComponent /></template>
