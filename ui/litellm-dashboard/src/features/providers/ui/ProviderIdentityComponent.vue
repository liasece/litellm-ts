<script setup lang="ts">
import { computed } from "vue";
import UiTag from "../../platform/ui/UiTag.vue";
import ProviderLogoComponent from "./ProviderLogoComponent.vue";
import { getProviderBrand } from "../logic/ProviderBrands";
const props = withDefaults(defineProps<{ provider: string; tag?: boolean }>(), { tag: true });
const brand = computed(() => getProviderBrand(props.provider));
</script>
<template>
	<span class="provider-identity" :title="provider">
		<ProviderLogoComponent
			:provider="brand.label"
			:logo="brand.logo"
			alt=""
			image-class="provider-identity-logo"
			fallback-class="provider-identity-logo"
		/>
		<UiTag v-if="tag" :color="brand.color" class="provider-identity__tag">{{ brand.label }}</UiTag>
		<span v-else class="provider-identity__label">{{ brand.label }}</span>
	</span>
</template>
<style scoped>
.provider-identity {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	min-width: 0;
	vertical-align: middle;
}
.provider-identity .ui-tag {
	flex: none;
}
.provider-identity__label {
	font-weight: 600;
	color: rgba(0, 0, 0, 0.88);
	white-space: nowrap;
}
.provider-identity-logo.provider-logo-image,
.provider-identity-logo.provider-logo-fallback {
	flex: none;
	border-radius: 3px;
}
</style>
