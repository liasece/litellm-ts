<script setup lang="ts">
defineProps<{ items: { key: string; label: string; value: unknown }[] }>();
</script>
<template>
	<table class="tools-descriptions">
		<tbody>
			<tr v-for="item in items" :key="item.key">
				<th>{{ item.label }}</th>
				<td>
					<slot :name="item.key" :value="item.value">{{ item.value }}</slot>
				</td>
			</tr>
		</tbody>
	</table>
</template>
