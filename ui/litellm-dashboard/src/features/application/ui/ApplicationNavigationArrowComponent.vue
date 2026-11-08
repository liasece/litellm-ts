<script setup lang="ts">
defineProps<{ expanded: boolean; selected: boolean }>();
</script>
<template>
	<i
		aria-hidden="true"
		class="application-navigation-arrow"
		:class="{ 'application-navigation-arrow--expanded': expanded, 'application-navigation-arrow--selected': selected }"
	/>
</template>
<style>
.application-navigation-arrow {
	--navigation-arrow-scale: calc(13 / 14);
	position: absolute;
	top: 50%;
	right: 16px;
	width: calc(10px * var(--navigation-arrow-scale));
	height: 0;
	color: rgba(0, 0, 0, 0.88);
}
.application-navigation-arrow::before,
.application-navigation-arrow::after {
	content: "";
	position: absolute;
	left: 0;
	top: 0;
	width: calc(6px * var(--navigation-arrow-scale));
	height: calc(1.5px * var(--navigation-arrow-scale));
	background: currentColor;
	border-radius: 6px;
}
.application-navigation-arrow::before {
	transform: rotate(-45deg) translateX(calc(2.5px * var(--navigation-arrow-scale)));
}
.application-navigation-arrow::after {
	transform: rotate(45deg) translateX(calc(-2.5px * var(--navigation-arrow-scale)));
}
.application-navigation-arrow--expanded {
	transform: translateY(calc(-2px * var(--navigation-arrow-scale)));
}
.application-navigation-arrow--expanded::before {
	transform: rotate(45deg) translateX(calc(2.5px * var(--navigation-arrow-scale)));
}
.application-navigation-arrow--expanded::after {
	transform: rotate(-45deg) translateX(calc(-2.5px * var(--navigation-arrow-scale)));
}
.application-navigation-arrow--selected {
	color: #1677ff;
}
</style>
