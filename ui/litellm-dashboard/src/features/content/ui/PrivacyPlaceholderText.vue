<script setup lang="ts">
import { computed } from "vue";
import { privacyPlaceholderTitle, splitPrivacyPlaceholders } from "../logic/PrivacyPlaceholderLogic";
defineOptions({ name: "PrivacyPlaceholderText" });
const props = defineProps<{ text: string }>();
const segments = computed(() => splitPrivacyPlaceholders(props.text));
</script>
<template>
	<template v-for="(segment, index) in segments" :key="index"
		><span
			v-if="segment.kind"
			class="privacy-token"
			:title="privacyPlaceholderTitle(segment.kind)"
			:aria-label="privacyPlaceholderTitle(segment.kind)"
			data-privacy-placeholder="true"
			>{{ segment.text }}</span
		><template v-else>{{ segment.text }}</template></template
	>
</template>
