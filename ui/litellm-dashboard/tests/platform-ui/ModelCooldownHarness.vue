<script setup lang="ts">
import { ref } from "vue";
import ModelCooldownBadge from "../../src/features/models/ui/ModelCooldownBadgeComponent.vue";
import type { ModelCooldown } from "../../src/features/models/support/ModelModels";

const cooldown = ref<ModelCooldown>({
	deployment_id: "failed-deployment",
	duration_ms: 60_000,
	remaining_ms: 3_000,
	expires_at: "2026-11-19T10:00:03.000Z",
});
</script>
<template>
	<ModelCooldownBadge :cooldown="cooldown" />
</template>
