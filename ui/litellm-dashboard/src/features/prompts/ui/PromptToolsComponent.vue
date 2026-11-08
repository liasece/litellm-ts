<script setup lang="ts">
import UiCard from "../../platform/ui/UiCard.vue";
import UiLucideIcon from "../../platform/ui/UiLucideIcon.vue";
import type { PromptTool } from "../support/PromptModels";
defineProps<{ tools: PromptTool[] }>();
const emit = defineEmits<{ add: []; edit: [index: number]; remove: [index: number] }>();
</script>
<template>
	<UiCard :padding="12" class="prompt-tools-card"
		><header>
			<label>Tools</label
			><button type="button" class="prompt-add-inline" @click="emit('add')"><UiLucideIcon name="Plus" :size="14" />Add</button>
		</header>
		<p v-if="!tools.length">No tools added</p>
		<div v-for="(tool, index) in tools" :key="index" class="prompt-tool-row">
			<div>
				<strong>{{ tool.name }}</strong
				><small>{{ tool.description }}</small>
			</div>
			<div>
				<button type="button" @click="emit('edit', index)">Edit</button
				><button type="button" aria-label="Remove tool" @click="emit('remove', index)">
					<UiLucideIcon name="TrashIcon" :size="14" />
				</button>
			</div></div
	></UiCard>
</template>
