<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { PlaygroundMcpServer } from "../../support/PlaygroundModels";
import { chatMcpLogo, chatMcpName, chatMcpColor } from "../../logic/ChatMcpLogic";
const props = withDefaults(defineProps<{ server: PlaygroundMcpServer; size?: number }>(), { size: 38 }),
	broken = ref(false),
	name = computed(() => chatMcpName(props.server)),
	logo = computed(() => chatMcpLogo(props.server));
watch(logo, () => (broken.value = false));
</script>
<template>
	<img
		v-if="logo && !broken"
		:src="logo"
		:alt="name + ' logo'"
		class="chat-mcp-avatar"
		:style="{ width: size + 'px', height: size + 'px', borderRadius: (size === 64 ? 16 : 10) + 'px' }"
		@error="broken = true"
	/><span
		v-else
		class="chat-mcp-avatar chat-mcp-avatar--letter"
		:style="{
			width: size + 'px',
			height: size + 'px',
			background: chatMcpColor(name),
			borderRadius: (size === 64 ? 16 : 10) + 'px',
			fontSize: (size === 64 ? 28 : 16) + 'px',
		}"
		>{{ name.charAt(0).toUpperCase() }}</span
	>
</template>
