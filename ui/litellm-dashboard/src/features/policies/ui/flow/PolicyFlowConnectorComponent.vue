<script setup lang="ts">
import PolicyHeroIconComponent from "../common/PolicyHeroIconComponent.vue";
defineEmits<{ insert: [] }>();
</script>
<template>
	<div class="policy-flow-connector">
		<i /><button type="button" title="Insert step" @click="$emit('insert')"><PolicyHeroIconComponent name="Plus" :size="12" /></button
		><i />
	</div>
</template>
