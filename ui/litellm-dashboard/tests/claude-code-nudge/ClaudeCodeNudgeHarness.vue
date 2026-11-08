<script setup lang="ts">
import { provide } from "vue";
import { createAuthenticationStore, authenticationStoreKey } from "../../src/features/identity/stores/AuthenticationStore";
import ApplicationClaudeCodeNudgeComponent from "../../src/features/application/ui/ApplicationClaudeCodeNudgeComponent.vue";
import NotificationLayerComponent from "../../src/features/notifications/ui/NotificationLayerComponent.vue";
import MessageLayerComponent from "../../src/features/notifications/ui/MessageLayerComponent.vue";
const auth = createAuthenticationStore();
auth.state.loading = false;
auth.state.initialized = true;
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
</script>
<template><ApplicationClaudeCodeNudgeComponent /><NotificationLayerComponent /><MessageLayerComponent /></template>
