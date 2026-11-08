<script setup lang="ts">
defineProps<{ maskCanClose?: boolean }>();
defineEmits<{ allowMask: [] }>();
const text = defineModel<string>({ default: "" });
</script>
<template>
	<div class="paint-content">
		<label>Drawer field<input v-model="text" aria-label="Drawer field" /></label>
		<button type="button">Drawer action</button>
		<button v-if="maskCanClose === false" type="button" @click="$emit('allowMask')">Allow mask close</button>
		<p v-for="line in 70" :key="line">Scrollable drawer content {{ line }}. Foreground remains interactive.</p>
	</div>
</template>
<style scoped>
.paint-content label {
	display: block;
}
.paint-content input {
	display: block;
	width: 100%;
	height: 32px;
	border: 1px solid #d9d9d9;
	padding: 4px 11px;
	margin: 8px 0;
}
.paint-content button {
	padding: 4px 12px;
	border: 1px solid #d9d9d9;
	border-radius: 6px;
	margin: 0 8px 8px 0;
	background: white;
}
.paint-content p {
	margin: 8px 0;
}
</style>
