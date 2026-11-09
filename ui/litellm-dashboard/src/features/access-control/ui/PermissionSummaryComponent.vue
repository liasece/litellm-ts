<script setup lang="ts">
import KeyPermissionSummaryComponent from "../../virtual-keys/ui/KeyPermissionSummaryComponent.vue";
import "../../virtual-keys/ui/styles/VirtualKeyDetails.css";
import type { AccessRecord } from "../support/AccessModels";
withDefaults(defineProps<{ permission?: AccessRecord | null; inline?: boolean }>(), { permission: null });
</script>
<template>
	<div class="access-permission-summary" :class="{ 'access-permission-summary--inline': inline }">
		<header>
			<h3>Object Permissions</h3>
			<p v-if="!inline">Access control entries stored on this object</p>
		</header>
		<KeyPermissionSummaryComponent :key-data="{ object_permission: permission }" />
	</div>
</template>
