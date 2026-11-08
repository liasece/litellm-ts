<script setup lang="ts">
import { onBeforeUnmount, watch } from "vue";
import { useAuthenticationStore } from "../../identity/stores/AuthenticationStore";
import { createYamlConfigDiffStore } from "../yaml-config-diff/stores/YamlConfigDiffStore";
import YamlConfigDiffDialog from "../yaml-config-diff/ui/YamlConfigDiffDialogComponent.vue";
const auth = useAuthenticationStore(),
	store = createYamlConfigDiffStore();
watch(
	[() => auth.state.session?.user_id ?? "", () => auth.userRole.value],
	([userId, role]) => {
		if (userId) void store.load(role);
		else void store.load("");
	},
	{ immediate: true },
);
onBeforeUnmount(store.dispose);
</script>
<template><YamlConfigDiffDialog :store="store" /></template>
