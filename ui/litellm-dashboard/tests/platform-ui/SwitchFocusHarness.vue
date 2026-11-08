<script setup lang="ts">
import { ref } from "vue";
import UiSwitch from "../../src/features/platform/ui/UiSwitch.vue";
const tremor = ref(false),
	antd = ref(false);
</script>
<template>
	<main style="padding: 24px; display: flex; gap: 24px">
		<UiSwitch v-model="tremor" appearance="tremor" aria-label="Tremor choice" />
		<UiSwitch v-model="antd" aria-label="AntD choice" />
		<button>Outside action</button>
	</main>
</template>
