<script setup lang="ts">
import { ref } from "vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import UiLucideIcon from "../../platform/ui/UiLucideIcon.vue";
import PromptVariableTextareaComponent from "./PromptVariableTextareaComponent.vue";
import type { PromptMessage } from "../support/PromptModels";
defineProps<{ messages: PromptMessage[] }>();
const emit = defineEmits<{
	add: [];
	update: [index: number, field: "role" | "content", value: string];
	remove: [index: number];
	move: [from: number, to: number];
}>();
const dragged = ref<number | null>(null),
	over = ref<number | null>(null),
	variableExample = "{{variable}}";
function drop(index: number) {
	if (dragged.value !== null && dragged.value !== index) emit("move", dragged.value, index);
	dragged.value = null;
	over.value = null;
}
function role(index: number, value: unknown) {
	if (typeof value === "string") emit("update", index, "role", value);
}
</script>
<template>
	<UiCard :padding="12" class="prompt-messages-card"
		><header>
			<label>Prompt messages</label>
			<p>
				Use <code>{{ variableExample }}</code> syntax for template variables
			</p>
		</header>
		<div
			v-for="(message, index) in messages"
			:key="index"
			draggable="true"
			:class="['prompt-message-editor', { dragging: dragged === index, over: over === index && dragged !== index }]"
			@dragstart="dragged = index"
			@dragover.prevent="over = index"
			@drop.prevent="drop(index)"
			@dragend="
				dragged = null;
				over = null;
			"
		>
			<header>
				<UiSelect
					:model-value="message.role"
					size="small"
					:options="[
						{ value: 'user', label: 'User' },
						{ value: 'assistant', label: 'Assistant' },
						{ value: 'system', label: 'System' },
					]"
					@update:model-value="role(index, $event)"
				/>
				<div>
					<button v-if="messages.length > 1" type="button" aria-label="Remove message" @click="emit('remove', index)">
						<UiLucideIcon name="TrashIcon" :size="14" /></button
					><span><UiLucideIcon name="GripVerticalIcon" :size="16" /></span>
				</div>
			</header>
			<div>
				<PromptVariableTextareaComponent
					:model-value="message.content"
					:rows="3"
					placeholder="Enter prompt content..."
					@update:model-value="emit('update', index, 'content', $event)"
				/>
			</div>
		</div>
		<button type="button" class="prompt-add-inline" @click="emit('add')">
			<UiLucideIcon name="Plus" :size="14" />Add message
		</button></UiCard
	>
</template>
