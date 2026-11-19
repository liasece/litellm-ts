<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { cooldownDeadlineForSnapshot, formatCooldownDuration } from "../logic/ModelCooldownLogic";
import { useModelCooldownClock } from "../stores/ModelCooldownClock";
import type { ModelCooldown } from "../support/ModelModels";

const props = defineProps<{ cooldown: ModelCooldown }>();
const now = useModelCooldownClock();
const deadline = ref(0);
watch(
	() => props.cooldown,
	(cooldown) => {
		deadline.value = cooldownDeadlineForSnapshot(cooldown);
	},
	{ immediate: true },
);
const remaining = computed(() => Math.max(0, deadline.value - now.value)),
	label = computed(() => formatCooldownDuration(remaining.value)),
	duration = computed(() => formatCooldownDuration(props.cooldown.duration_ms)),
	title = computed(() =>
		label.value === null
			? "Fallback cooldown has expired"
			: `Failed request triggered fallback. Cooldown ${duration.value ?? "0s"} total, ${label.value} remaining.`,
	);
</script>
<template>
	<span v-if="label" class="model-badge model-badge--red model-cooldown" data-testid="model-cooldown" :title="title" :aria-label="title"
		>Cooldown {{ label }}</span
	>
	<span v-else class="model-muted" data-testid="model-cooldown-empty">-</span>
</template>
