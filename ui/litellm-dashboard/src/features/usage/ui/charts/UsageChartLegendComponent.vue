<script setup lang="ts">
defineProps<{ categories: string[]; colors: string[] }>();
</script>
<template>
	<div class="usage-native-legend">
		<ol>
			<li v-for="(category, index) in categories" :key="category">
				<svg viewBox="0 0 8 8" :style="{ color: colors[index % colors.length] }" aria-hidden="true">
					<circle cx="4" cy="4" r="4" />
				</svg>
				<p>{{ category }}</p>
			</li>
		</ol>
	</div>
</template>
<style>
.usage-native-legend {
	position: absolute;
	left: 0;
	right: 0;
	top: 5px;
	display: flex;
	justify-content: flex-end;
	align-items: center;
	z-index: 1;
	pointer-events: none;
}
.usage-native-legend ol {
	display: flex;
	flex-wrap: wrap;
	position: relative;
	overflow: hidden;
	margin: 0;
	padding: 0;
	list-style: none;
}
.usage-native-legend li {
	display: inline-flex;
	align-items: center;
	white-space: nowrap;
	padding: 2px 8px;
	border-radius: 6px;
	color: #6b7280;
}
.usage-native-legend li svg {
	width: 8px;
	height: 8px;
	margin-right: 6px;
	flex: none;
	fill: currentColor;
}
.usage-native-legend li p {
	font-size: 12.4px;
	line-height: 18.4px;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
</style>
