<script setup lang="ts">
import { onBeforeUnmount, onMounted } from "vue";
import { createChatMcpAppsStore } from "../../stores/ChatMcpAppsStore";
import { chatMcpName, chatMcpLogo } from "../../logic/ChatMcpLogic";
import UiSpinner from "../../../platform/ui/UiSpinner.vue";
import UiSwitch from "../../../platform/ui/UiSwitch.vue";
const props = defineProps<{ selected: string[] }>(),
	emit = defineEmits<{ change: [string[]] }>(),
	store = createChatMcpAppsStore({ selected: () => props.selected, change: (names) => emit("change", names) }),
	state = store.state;
function hideImage(event: Event) {
	(event.target as HTMLImageElement).style.display = "none";
}
onMounted(() => void store.load(false));
onBeforeUnmount(store.dispose);
</script>
<template>
	<div class="chat-mcp-picker">
		<div v-if="state.loading" class="chat-mcp-picker__loading"><UiSpinner /></div>
		<div v-else-if="!state.servers.length" class="chat-mcp-picker__empty">No MCP servers configured</div>
		<div v-for="server in state.servers" v-else :key="server.server_id" class="chat-mcp-picker__row">
			<img v-if="chatMcpLogo(server)" :src="chatMcpLogo(server)" :alt="chatMcpName(server) + ' logo'" @error="hideImage" />
			<div>
				<strong>{{ chatMcpName(server) }}</strong>
				<p v-if="server.description">{{ server.description }}</p>
			</div>
			<UiSpinner v-if="state.toggling.has(chatMcpName(server))" :size="14" /><UiSwitch
				v-else
				:model-value="selected.includes(chatMcpName(server))"
				size="small"
				@update:model-value="store.toggle(server, $event, true)"
			/>
		</div>
	</div>
</template>
