<script setup lang="ts">
import { computed } from "vue";
import ModelLogo from "./ModelLogoComponent.vue";
import type { ModelFamily } from "../../../../../../src/shared/ModelFamily";

const props = defineProps<{
	/** 家族名；为空表示这一组没有识别出品牌。 */
	family: ModelFamily | null;
	/** 该组条目数，显示在家族名后面便于估量分组规模。 */
	count: number;
}>();
const label = computed(() => props.family ?? "Unknown brand");
</script>
<template>
	<span class="model-family-label">
		<ModelLogo :model="family ?? ''" :family="family" :size="16" />
		<span class="model-family-label__name">{{ label }}</span>
		<span class="model-family-label__count" :aria-label="count + ' models'">{{ count }}</span>
	</span>
</template>
<style scoped>
.model-family-label {
	display: inline-flex;
	align-items: center;
	gap: 8px;
	font-size: 12px;
	font-weight: 600;
	letter-spacing: 0.01em;
	color: var(--ui-text-secondary, #475467);
}
.model-family-label__name {
	color: var(--ui-text-primary, #101828);
}
.model-family-label__count {
	min-width: 20px;
	padding: 0 6px;
	border-radius: 999px;
	background: rgba(16, 24, 40, 0.06);
	color: var(--ui-text-secondary, #475467);
	font-size: 11px;
	font-weight: 500;
	text-align: center;
	line-height: 18px;
}
</style>
