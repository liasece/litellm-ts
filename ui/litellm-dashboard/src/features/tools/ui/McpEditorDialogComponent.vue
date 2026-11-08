<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import UiDialog from "../../platform/ui/UiDialog.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiTabs from "../../platform/ui/UiTabs.vue";
import McpServerFieldsComponent from "./McpServerFieldsComponent.vue";
import McpPermissionsComponent from "./McpPermissionsComponent.vue";
import McpToolConfigurationComponent from "./McpToolConfigurationComponent.vue";
import McpConnectionStatusComponent from "./McpConnectionStatusComponent.vue";
import McpCostConfigurationComponent from "./McpCostConfigurationComponent.vue";
import { createMcpEditorStore } from "../stores/McpEditorStore";
import type { MCPServer, DiscoverableMCPServer } from "../support/McpModels";
import "../styles/McpFormStyles.css";
const props = withDefaults(
	defineProps<{ server?: MCPServer; prefill?: DiscoverableMCPServer; groups: string[]; admin?: boolean; back?: boolean }>(),
	{ admin: true, server: undefined, prefill: undefined },
);
const open = defineModel<boolean>("open", { required: true });
const emit = defineEmits<{ saved: [value: MCPServer]; back: [] }>();
const store = createMcpEditorStore(props.server, props.admin),
	tab = ref("server"),
	editing = Boolean(props.server);
const tools = computed(() =>
	editing
		? store.connection.tools.value
		: store.connection.tools.value.filter((tool) => store.config.value.allowedTools.includes(tool.name)),
);
onMounted(async () => {
	if (props.prefill) store.prefill(props.prefill);
	store.restore();
	await store.oauth.resume();
});
onBeforeUnmount(store.dispose);
async function save() {
	const result = await store.save();
	if (result) {
		emit("saved", result as MCPServer);
		open.value = false;
	}
}
</script>
<template>
	<UiDialog
		v-model:open="open"
		:title="editing ? 'Edit MCP Server' : admin ? 'Add New MCP Server' : 'Submit MCP Server for Review'"
		:width="editing ? 960 : 1000"
		:show-footer="false"
		scroll-mode="overlay"
		:class="['tools-mcp-editor', editing ? 'tools-mcp-editor--edit' : 'tools-mcp-editor--create']"
		><template v-if="!editing" #title
			><span class="tools-mcp-create-title"
				><button v-if="back" type="button" aria-label="Back to discovery" @click="emit('back')">←</button
				><img :src="'/ui/assets/logos/mcp_logo.png'" alt="MCP Logo" /><strong>{{
					admin ? "Add New MCP Server" : "Submit MCP Server for Review"
				}}</strong></span
			></template
		><UiTabs
			v-if="editing"
			v-model="tab"
			appearance="tremor"
			:items="[
				{ key: 'server', label: 'Server Configuration' },
				{ key: 'cost', label: 'Cost Configuration' },
			]"
			class="tools-mcp-editor-tabs"
		/>
		<form class="tools-mcp-editor-form" @submit.prevent="save">
			<div v-if="!admin && !editing" class="tools-mcp-review-note">
				Your submission will be sent for admin review before it becomes active. Note: the request must be made with a team-scoped
				API key.
			</div>
			<div v-show="tab === 'server'">
				<McpServerFieldsComponent :store="store" :editing="editing" /><McpPermissionsComponent
					v-model="store.draft.value"
					:groups="groups"
					:errors="store.errors.value"
				/>
				<div v-if="!editing" class="tools-mcp-connection-wrap">
					<McpConnectionStatusComponent :connection="store.connection" :values="store.draft.value" />
				</div>
				<McpToolConfigurationComponent
					v-model="store.config.value"
					:connection="store.connection"
					:values="store.draft.value"
					:existing="server?.allowed_tools"
					:suggestions="store.suggestions.value"
				/>
			</div>
			<McpCostConfigurationComponent
				v-if="!editing || tab === 'cost'"
				v-model="store.config.value.cost"
				:tools="tools"
				:disabled="store.connection.loading.value"
			/>
			<footer>
				<UiButton :appearance="editing ? 'antd' : 'tremor'" @click="open = false">Cancel</UiButton
				><UiButton type="submit" :appearance="editing ? 'antd' : 'tremor'" variant="primary" :loading="store.pending.value">{{
					editing ? "Save Changes" : admin ? (store.pending.value ? "Creating..." : "Add MCP Server") : "Submit for Review"
				}}</UiButton>
			</footer>
		</form></UiDialog
	>
</template>
