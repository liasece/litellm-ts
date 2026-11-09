<script setup lang="ts">
import { ref } from "vue";
import UiTabs from "../../platform/ui/UiTabs.vue";
import PlaygroundChatComponent from "./chat/PlaygroundChatComponent.vue";
import PlaygroundCompareComponent from "./compare/PlaygroundCompareComponent.vue";
const tab = ref("chat");
const tabs = [
	{ key: "chat", label: "Chat" },
	{ key: "compare", label: "Compare" },
];
</script>
<template>
	<section class="pg-page">
		<UiTabs v-model="tab" :items="tabs" appearance="tremor" /><PlaygroundChatComponent
			v-show="tab === 'chat'"
		/><PlaygroundCompareComponent v-show="tab === 'compare'" />
	</section>
</template>
<style>
.pg-page {
	display: flex;
	flex-direction: column;
	flex: 1;
	width: 100%;
	min-height: 0;
	background: #fff;
}
.pg-page > .ui-tabs {
	flex-shrink: 0;
}
</style>

<style>
.pg-page > .pg-chat,
.pg-page > .pg-compare {
	margin-top: 8px;
}
</style>
