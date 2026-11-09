<script setup lang="ts">
import { computed } from "vue";
import UiLucideIcon from "../../platform/ui/UiLucideIcon.vue";
import { getModelIconIdentity } from "../logic/ProviderIdentityLogic";
import ProviderLogo from "./ProviderLogoComponent.vue";

const props = withDefaults(
	defineProps<{ model: string; provider?: string | null; baseModel?: string; family?: string | null; size?: number }>(),
	{ provider: undefined, baseModel: undefined, family: undefined, size: 20 },
);
const identity = computed(() => getModelIconIdentity(props.model, props.provider, props.baseModel, props.family));
const badge = computed(() => {
	const { family, supplier } = identity.value;
	return supplier?.logo && supplier.logo === family?.logo ? null : supplier;
});
const label = computed(() => {
	const family = identity.value.family?.displayName ?? (props.model || "Model");
	const supplier = identity.value.supplier?.displayName;
	return supplier && supplier !== family ? family + " via " + supplier : family;
});
</script>

<template>
	<span
		class="model-logo"
		:class="{ 'model-logo--with-provider': badge }"
		:style="{ '--model-logo-size': size + 'px' }"
		role="img"
		:aria-label="label"
		:title="label"
	>
		<span class="model-logo__family" aria-hidden="true">
			<ProviderLogo
				v-if="identity.family"
				:key="identity.family.logo"
				:provider="identity.family.displayName"
				:logo="identity.family.logo"
				alt=""
			/>
			<UiLucideIcon v-else name="LayersIcon" size="100%" />
		</span>
		<span v-if="badge" class="model-logo__provider" aria-hidden="true">
			<ProviderLogo :key="badge.displayName" :provider="badge.displayName" :logo="badge.logo" alt="" />
		</span>
	</span>
</template>

<style scoped>
.model-logo {
	position: relative;
	display: inline-flex;
	width: var(--model-logo-size);
	height: var(--model-logo-size);
	flex: none;
	vertical-align: middle;
	line-height: 1;
}
.model-logo__family,
.model-logo__provider {
	display: grid;
	place-items: center;
	line-height: 1;
}
.model-logo__family {
	width: 100%;
	height: 100%;
	color: #64748b;
}
.model-logo--with-provider .model-logo__family {
	width: 87.5%;
	height: 87.5%;
}
.model-logo__provider {
	position: absolute;
	right: 0;
	bottom: 0;
	width: 50%;
	height: 50%;
}
.model-logo :deep(.provider-logo-image),
.model-logo :deep(.provider-logo-fallback) {
	display: grid;
	width: 100%;
	height: 100%;
	place-items: center;
	object-fit: contain;
	line-height: 1;
}
.model-logo__family :deep(.provider-logo-fallback) {
	font-size: calc(var(--model-logo-size) * 0.55);
}
.model-logo__provider :deep(.provider-logo-fallback) {
	border-radius: 0;
	background: transparent;
	font-size: calc(var(--model-logo-size) * 0.39);
	font-weight: 600;
}
</style>
