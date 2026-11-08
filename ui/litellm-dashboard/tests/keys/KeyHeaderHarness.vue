<script setup lang="ts">
import KeyDetailHeader from "../../src/features/virtual-keys/ui/KeyDetailHeaderComponent.vue";
import type { VirtualKey } from "../../src/features/virtual-keys/support/VirtualKeyModels";
const key: VirtualKey = {
	token: "visual-key-hash-1",
	token_id: "visual-key-hash-1",
	key_alias: "Research API",
	user_id: "visual-admin",
	user_email: "admin@example.test",
	created_at: "2026-11-07T10:00:00.000Z",
	updated_at: "2026-11-07T10:00:00.000Z",
	last_active: "2026-11-07T10:00:00.000Z",
	models: [],
	metadata: {},
};
</script>
<template>
	<div class="header-fixture"><KeyDetailHeader :key-data="key" can-modify can-reset :premium="false" /></div>
</template>
<style>
.header-fixture {
	width: 1072px;
}
@media (max-width: 639px) {
	.header-fixture {
		width: 232px;
	}
}
</style>
