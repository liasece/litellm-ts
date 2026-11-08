<script setup lang="ts">
import KeyPermissionSummaryComponent from "../../virtual-keys/ui/KeyPermissionSummaryComponent.vue";
import "../../virtual-keys/ui/styles/VirtualKeyDetails.css";
import type { AccessCatalog, AccessRecord } from "../support/AccessModels";
import { emptyAccessCatalog } from "../support/AccessModels";
withDefaults(defineProps<{ permission?: AccessRecord | null; inline?: boolean; catalog?: AccessCatalog }>(), {
	permission: null,
	catalog: emptyAccessCatalog,
});
</script>
<template>
	<div class="access-permission-summary" :class="{ 'access-permission-summary--inline': inline }">
		<header>
			<h3>Object Permissions</h3>
			<p v-if="!inline">Access control for Vector Stores and MCP Servers</p>
		</header>
		<KeyPermissionSummaryComponent :key-data="{ object_permission: permission }" :catalog="catalog" />
	</div>
</template>
