<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from "vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiTabs from "../../platform/ui/UiTabs.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import UiDrawer from "../../platform/ui/UiDrawer.vue";
import UiDialog from "../../platform/ui/UiDialog.vue";
import McpServerTableComponent from "./McpServerTableComponent.vue";
import McpDiscoveryDialogComponent from "./McpDiscoveryDialogComponent.vue";
import McpEditorDialogComponent from "./McpEditorDialogComponent.vue";
import McpByokDialogComponent from "./McpByokDialogComponent.vue";
import McpServerDetailsComponent from "./McpServerDetailsComponent.vue";
import McpConnectComponent from "./McpConnectComponent.vue";
import McpSubmissionsComponent from "./McpSubmissionsComponent.vue";
import McpSemanticFilterSettingsComponent from "./McpSemanticFilterSettingsComponent.vue";
import McpNetworkSettingsComponent from "./McpNetworkSettingsComponent.vue";
import { createMcpServersStore } from "../stores/McpServersStore";
import { mcpApi } from "../api/McpServersApi";
import { MCP_CREATE_STATE } from "../stores/McpEditorStore";
import { useAuthenticationStore } from "../../identity/stores/AuthenticationStore";
import { isAdminRole } from "../../identity/logic/UserRoleLogic";
import { notificationManager } from "../../notifications/logic/NotificationManager";
import type { MCPServer, DiscoverableMCPServer } from "../support/McpModels";
import "../styles/McpServersStyles.css";
import "../styles/McpDiscoveryStyles.css";
const auth = useAuthenticationStore(),
	admin = computed(() => isAdminRole(auth.userRole.value)),
	store = createMcpServersStore(),
	tab = ref("servers"),
	discovery = ref(false),
	creating = ref(false),
	prefill = ref<DiscoverableMCPServer>(),
	deleting = ref<MCPServer | null>(null),
	pending = ref(false),
	byok = ref<MCPServer | null>(null);
const tabs = computed(() => [
		{ key: "servers", label: "All Servers" },
		{ key: "connect", label: "Connect" },
		{ key: "semantic", label: "Semantic Filter" },
		{ key: "network", label: "Network Settings" },
		...(admin.value ? [{ key: "submissions", label: "Submitted MCPs" }] : []),
	]),
	teamOptions = computed(() => [
		{ value: "all", label: auth.userRole.value === "Internal User" ? "All Available Servers" : "All Servers" },
		{ value: "personal", label: "Personal" },
		...store.teams.value.map((team) => ({ value: team.team_id, label: team.team_alias || team.team_id })),
	]);
function create(server?: DiscoverableMCPServer) {
	prefill.value = server;
	creating.value = true;
	discovery.value = false;
}
function edit(server: MCPServer) {
	store.selectedId.value = server.server_id;
	store.editing.value = true;
}
function updated() {
	void store.load();
}
async function remove() {
	if (!deleting.value) return;
	pending.value = true;
	try {
		await mcpApi.delete(deleting.value.server_id);
		notificationManager.success("Deleted MCP Server successfully");
		void store.load();
	} finally {
		pending.value = false;
		deleting.value = null;
	}
}
onMounted(() => {
	store.initialize();
	try {
		const raw = window.sessionStorage.getItem(MCP_CREATE_STATE);
		if (raw && JSON.parse(raw).modalVisible) creating.value = true;
	} catch {
		creating.value = false;
	}
});
onBeforeUnmount(store.dispose);
</script>
<template>
	<div v-if="!auth.isAuthorized.value || !auth.userRole.value || !auth.state.session?.user_id" class="tools-mcp-auth-missing">
		Missing required authentication parameters.
	</div>
	<main v-else class="tools-mcp-page">
		<header>
			<div>
				<h1>
					MCP Servers <span v-if="store.filtered.value.length">{{ store.filtered.value.length }}</span>
				</h1>
				<p>Configure and manage your MCP servers</p>
			</div>
			<UiButton appearance="tremor" :variant="admin ? 'primary' : 'default'" @click="admin ? (discovery = true) : create()">{{
				admin ? "+ Add New MCP Server" : "+ Submit MCP Server"
			}}</UiButton>
		</header>
		<UiTabs v-model="tab" :items="tabs" appearance="tremor" class="tools-mcp-main-tabs"
			><template #tab-submissions
				><span class="tools-mcp-new-tab-label">Submitted MCPs <b class="tools-mcp-new-badge">New</b></span></template
			></UiTabs
		><template v-if="tab === 'servers'"
			><div class="tools-mcp-filters">
				<div><label>Team</label><UiSelect v-model="store.team.value" :options="teamOptions" /></div>
				<i />
				<div>
					<label
						>Access Group
						<UiTooltip
							title="An MCP Access Group is a set of users or teams that have permission to access specific MCP servers. Use access groups to control and organize who can connect to which servers."
							><UiIcon name="QuestionCircleOutlined" /></UiTooltip></label
					><UiSelect
						v-model="store.group.value"
						:options="[
							{ value: 'all', label: 'All Access Groups' },
							...store.groups.value.map((value) => ({ value, label: value })),
						]"
					/>
				</div>
			</div>
			<McpServerTableComponent
				:rows="store.filtered.value"
				:loading="store.loading.value"
				:health-loading="store.healthLoading.value"
				:rechecking="store.rechecking.value"
				@select="
					store.selectedId.value = $event.server_id;
					store.editing.value = false;
				"
				@edit="edit"
				@delete="deleting = $event"
				@connect="byok = $event"
				@recheck="store.health([$event])" /></template
		><McpConnectComponent v-else-if="tab === 'connect'" /><McpSemanticFilterSettingsComponent
			v-else-if="tab === 'semantic'"
		/><McpNetworkSettingsComponent v-else-if="tab === 'network'" /><McpSubmissionsComponent
			v-else-if="tab === 'submissions' && admin"
		/><McpDiscoveryDialogComponent v-model:open="discovery" @select="create" @custom="create()" /><McpEditorDialogComponent
			v-if="creating"
			v-model:open="creating"
			:prefill="prefill"
			:groups="store.groups.value"
			:admin="admin"
			back
			@saved="updated"
			@back="
				creating = false;
				discovery = true;
			"
		/><UiDrawer
			:open="Boolean(store.selected.value)"
			:title="store.selected.value?.server_name || store.selected.value?.alias || 'MCP Server details'"
			class="tools-mcp-detail-drawer"
			@update:open="!$event && store.close()"
			><template #title
				><h2>{{ store.selected.value?.server_name || store.selected.value?.alias || "MCP Server details" }}</h2>
				<p>{{ store.selected.value?.server_id }}</p></template
			><template v-if="store.selected.value && admin" #extra
				><UiButton appearance="tremor" @click="store.editing.value = true">Edit</UiButton></template
			><McpServerDetailsComponent
				v-if="store.selected.value"
				:key="store.selected.value.server_id"
				:server="store.selected.value"
				:admin="admin"
				@edit="store.editing.value = true" /></UiDrawer
		><McpEditorDialogComponent
			v-if="store.editing.value && store.selected.value"
			v-model:open="store.editing.value"
			:server="store.selected.value"
			:groups="store.groups.value"
			:admin="admin"
			@saved="updated"
		/><McpByokDialogComponent
			v-if="byok"
			:open="Boolean(byok)"
			:server="byok"
			@update:open="!$event && (byok = null)"
			@connected="
				byok = null;
				updated();
			"
		/><UiDialog
			scroll-mode="overlay"
			:open="Boolean(deleting)"
			title="Delete MCP Server?"
			class="tools-mcp-delete"
			@update:open="!$event && (deleting = null)"
			><p>This action is permanent and cannot be undone. All associated configurations will be removed.</p>
			<dl v-if="deleting">
				<template v-if="deleting.server_name"
					><dt>Name</dt>
					<dd>
						<strong>{{ deleting.server_name }}</strong>
					</dd></template
				>
				<dt>ID</dt>
				<dd>
					<code>{{ deleting.server_id }}</code>
				</dd>
				<template v-if="deleting.url"
					><dt>URL</dt>
					<dd>
						<code>{{ deleting.url }}</code>
					</dd></template
				>
			</dl>
			<template #footer
				><UiButton :disabled="pending" @click="deleting = null">Cancel</UiButton
				><UiButton variant="danger" :loading="pending" @click="remove">{{ pending ? "Deleting..." : "Delete" }}</UiButton></template
			></UiDialog
		>
	</main>
</template>
