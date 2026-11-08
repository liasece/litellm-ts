<script setup lang="ts">
import { nextTick, ref } from "vue";
import type { ChatConversation } from "../../support/ChatModels";
import UiButton from "../../../platform/ui/UiButton.vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
import UiTooltip from "../../../platform/ui/UiTooltip.vue";
import UiPopover from "../../../platform/ui/UiPopover.vue";
const props = defineProps<{ conversation: ChatConversation; active: boolean }>(),
	emit = defineEmits<{ select: [string]; remove: [string]; rename: [string, string] }>(),
	editing = ref(false),
	value = ref(""),
	input = ref<HTMLInputElement>(),
	confirm = ref<InstanceType<typeof UiPopover>>();
async function start() {
	value.value = props.conversation.title;
	editing.value = true;
	await nextTick();
	input.value?.focus();
	input.value?.select();
}
function commit() {
	if (!editing.value) return;
	if (value.value.trim() && value.value.trim() !== props.conversation.title) emit("rename", props.conversation.id, value.value.trim());
	editing.value = false;
}
function key(event: KeyboardEvent) {
	if (event.key === "Enter") {
		event.preventDefault();
		commit();
	} else if (event.key === "Escape") {
		event.preventDefault();
		editing.value = false;
	}
}
</script>
<template>
	<div
		class="chat-conversation-row"
		:class="{ 'is-active': active }"
		role="button"
		tabindex="0"
		@click="!editing && emit('select', conversation.id)"
		@keydown.enter.self="emit('select', conversation.id)"
	>
		<input
			v-if="editing"
			ref="input"
			v-model="value"
			class="chat-conversation-row__edit"
			@keydown="key"
			@blur="commit"
			@click.stop
		/><template v-else
			><span :title="conversation.title">{{
				conversation.title.length > 40 ? conversation.title.slice(0, 40) + "…" : conversation.title
			}}</span>
			<div class="chat-conversation-row__actions" @click.stop>
				<UiTooltip title="Rename"
					><UiButton variant="text" size="small" aria-label="Rename" @click="start"
						><UiIcon name="EditOutlined" /></UiButton></UiTooltip
				><UiPopover ref="confirm" trigger="click" placement="top"
					><UiTooltip title="Delete"
						><UiButton variant="text" size="small" aria-label="Delete conversation"
							><UiIcon name="DeleteOutlined" /></UiButton></UiTooltip
					><template #content
						><div class="chat-conversation-row__confirm">
							<strong><UiIcon name="ExclamationCircleFilled" />Delete this conversation?</strong>
							<div>
								<UiButton size="small" @click="confirm?.hide()">Cancel</UiButton
								><UiButton
									variant="danger"
									size="small"
									@click="
										emit('remove', conversation.id);
										confirm?.hide();
									"
									>Delete</UiButton
								>
							</div>
						</div></template
					></UiPopover
				>
			</div></template
		>
	</div>
</template>
