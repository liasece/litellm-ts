<script setup lang="ts">
import { ref } from "vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
import type { GuardrailCardInfo } from "../../data/GuardrailGardenData";
defineProps<{ card: GuardrailCardInfo }>();
const emit = defineEmits<{ select: [] }>(),
	failed = ref(false);
</script>
<template>
	<button type="button" class="guardrail-garden-card" @click="emit('select')">
		<header>
			<span v-if="failed || !card.logo" class="guardrail-garden-logo-fallback">{{ card.name.charAt(0) || "?" }}</span
			><img v-else :src="card.logo" alt="" @error="failed = true" /><strong>{{ card.name }}</strong>
		</header>
		<p>{{ card.description }}</p>
		<footer v-if="card.eval">
			<UiIcon name="CheckCircleFilled" :size="12" /><span>F1: {{ card.eval.f1 }}% · {{ card.eval.testCases }} test cases</span>
		</footer>
	</button>
</template>
