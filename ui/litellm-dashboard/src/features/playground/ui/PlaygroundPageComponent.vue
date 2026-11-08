<script setup lang="ts">
import { ref } from "vue";
import UiTabs from "../../platform/ui/UiTabs.vue";
import PlaygroundChatComponent from "./chat/PlaygroundChatComponent.vue";
import PlaygroundCompareComponent from "./compare/PlaygroundCompareComponent.vue";
import PlaygroundComplianceComponent from "./compliance/PlaygroundComplianceComponent.vue";
import PlaygroundAgentBuilderComponent from "./agents/PlaygroundAgentBuilderComponent.vue";
const tab = ref("chat");
const tabs = [
	{ key: "chat", label: "Chat" },
	{ key: "compare", label: "Compare" },
	{ key: "compliance", label: "Compliance" },
	{ key: "agents", label: "Agent Builder (Experimental)" },
];
</script>
<template>
	<section class="pg-page">
		<UiTabs v-model="tab" :items="tabs" appearance="tremor" /><PlaygroundChatComponent
			v-show="tab === 'chat'"
		/><PlaygroundCompareComponent v-show="tab === 'compare'" /><PlaygroundComplianceComponent
			v-show="tab === 'compliance'"
		/><PlaygroundAgentBuilderComponent v-show="tab === 'agents'" />
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
.pg-page > .pg-agent {
	flex: 1;
}
</style>

<style>
.pg-page > .pg-chat,
.pg-page > .pg-compare,
.pg-page > .pg-compliance,
.pg-page > .pg-agent {
	margin-top: 8px;
}
</style>
