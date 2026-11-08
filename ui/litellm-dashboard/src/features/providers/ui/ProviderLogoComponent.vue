<script setup lang="ts">
import { ref } from "vue";
withDefaults(defineProps<{ provider: string; logo?: string | null; alt?: string; imageClass?: string; fallbackClass?: string }>(), {
	logo: null,
	alt: undefined,
	imageClass: undefined,
	fallbackClass: undefined,
});
const failed = ref(false);
</script>
<template>
	<span v-if="!logo || failed" class="provider-logo-fallback" :class="fallbackClass">{{ provider.charAt(0) || "-" }}</span
	><img v-else :src="logo" :alt="alt ?? provider + ' logo'" class="provider-logo-image" :class="imageClass" @error="failed = true" />
</template>
<style>
.provider-logo-image {
	width: 16px;
	height: 16px;
	object-fit: contain;
}
.provider-logo-fallback {
	display: flex;
	width: 16px;
	height: 16px;
	align-items: center;
	justify-content: center;
	border-radius: 9999px;
	background: #e5e7eb;
	font-size: 12px;
	line-height: 16px;
}
</style>
