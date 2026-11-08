<script setup lang="ts">
import type { UiAppearance } from "./UiTypes";
withDefaults(defineProps<{ title?: string; appearance?: UiAppearance; padding?: string | number; size?: "small" | "default" }>(), {
	appearance: "tremor",
	title: undefined,
	padding: undefined,
	size: "default",
});
</script>

<template>
	<section
		class="ui-card"
		:class="['ui-card--' + appearance, { 'ui-card--small': size === 'small' }]"
		:style="
			appearance === 'tremor' && padding != null ? { padding: typeof padding === 'number' ? padding + 'px' : padding } : undefined
		"
	>
		<header v-if="title || $slots.title || $slots.extra" class="ui-card__header">
			<h2 class="ui-card__title">
				<slot name="title">{{ title }}</slot>
			</h2>
			<slot name="extra" />
		</header>
		<div
			class="ui-card__body"
			:style="
				appearance === 'antd' && padding != null ? { padding: typeof padding === 'number' ? padding + 'px' : padding } : undefined
			"
		>
			<slot />
		</div>
	</section>
</template>
