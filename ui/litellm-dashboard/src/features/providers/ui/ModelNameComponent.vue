<script setup lang="ts">
import { computed } from "vue";
import ModelLogo from "./ModelLogoComponent.vue";
import { modelProviderHint } from "../logic/ProviderIdentityLogic";
const props = withDefaults(
	defineProps<{
		/** 用于识别图标的模型名；通常也是展示文本。 */
		model?: string | null;
		/** 展示文本覆盖，例如友好名称；图标仍由 model 决定。 */
		name?: string | null;
		/** 已知供应方；未提供时按模型名推断。 */
		provider?: string | null;
		baseModel?: string;
		family?: string | null;
		/** 图标尺寸，默认 16。 */
		size?: number;
		/** 图标与文字间距，默认 4。 */
		gap?: number;
		/** 文本样式：普通、加粗或行内代码。 */
		variant?: "plain" | "strong" | "code";
		/** 是否显示图标；空模型与 all-* 哨兵值始终不显示。 */
		showIcon?: boolean;
		/** 单行省略，避免长模型名撑破表格或标签。 */
		truncate?: boolean;
		/** 空模型名时的占位文本。 */
		placeholder?: string;
	}>(),
	{
		model: undefined,
		name: undefined,
		provider: undefined,
		baseModel: undefined,
		family: undefined,
		size: 16,
		gap: 4,
		variant: "plain",
		showIcon: true,
		truncate: false,
		placeholder: "-",
	},
);
const text = computed(() => (props.name ?? props.model ?? "").trim());
const iconModel = computed(() => (props.model ?? "").trim());
const iconProvider = computed(() => props.provider || modelProviderHint(iconModel.value));
const iconVisible = computed(() => props.showIcon && Boolean(iconModel.value) && !iconModel.value.startsWith("all-"));
</script>
<template>
	<span class="model-name" :class="{ 'model-name--truncate': truncate }" :style="{ gap: gap + 'px' }">
		<ModelLogo v-if="iconVisible" :model="iconModel" :provider="iconProvider" :base-model="baseModel" :family="family" :size="size" />
		<slot
			><code v-if="variant === 'code'" class="model-name__text">{{ text || placeholder }}</code>
			<strong v-else-if="variant === 'strong'" class="model-name__text">{{ text || placeholder }}</strong>
			<span v-else class="model-name__text">{{ text || placeholder }}</span></slot
		>
	</span>
</template>
<style scoped>
.model-name {
	display: inline-flex;
	align-items: center;
	min-width: 0;
	max-width: 100%;
	vertical-align: middle;
	line-height: 1.4;
}
.model-name__text {
	min-width: 0;
}
.model-name--truncate .model-name__text {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
</style>
