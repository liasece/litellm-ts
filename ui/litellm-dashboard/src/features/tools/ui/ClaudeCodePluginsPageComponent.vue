<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiDialog from "../../platform/ui/UiDialog.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiSwitch from "../../platform/ui/UiSwitch.vue";
import UiTag from "../../platform/ui/UiTag.vue";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import AccessActionComponent from "../../access-control/ui/AccessActionComponent.vue";
import AccessNoticeComponent from "../../access-control/ui/AccessNoticeComponent.vue";
import PluginFormDialogComponent from "./PluginFormDialogComponent.vue";
import PluginDetailsComponent from "./PluginDetailsComponent.vue";
import ToolsTableComponent from "./ToolsTableComponent.vue";
import { createResourceStore } from "../../platform/stores/ResourceStore";
import { useAuthenticationStore } from "../../identity/stores/AuthenticationStore";
import { isAdminRole } from "../../identity/logic/UserRoleLogic";
import { claudePluginsApi } from "../api/ClaudePluginsApi";
import { pluginCategoryColor } from "../logic/PluginDraftLogic";
import type { ClaudePlugin } from "../support/PluginModels";
import "../../access-control/styles/AccessStyles.css";
import "../styles/ToolsStyles.css";
import "../styles/PluginStyles.css";
const auth = useAuthenticationStore(),
	admin = computed(() => isAdminRole(auth.userRole.value)),
	store = createResourceStore(claudePluginsApi.list),
	{ state, ordered } = store,
	adding = ref(false),
	selected = ref(""),
	deleting = ref<ClaudePlugin | null>(null),
	toggling = ref("");
state.sortBy = "created_at";
state.sortOrder = "desc";
const columns = computed(() => [
	{ key: "name", label: "Plugin Name", sortable: true },
	{ key: "version", label: "Version", sortable: true },
	{ key: "description", label: "Description", sortable: true },
	{ key: "category", label: "Category", sortable: true },
	{ key: "enabled", label: "Enabled", sortable: true },
	{ key: "created_at", label: "Created At", sortable: true },
	...(admin.value ? [{ key: "actions", label: "Actions" }] : []),
]);
function plugin(row: Record<string, unknown>) {
	return row as ClaudePlugin;
}
function sort(key: string) {
	store.sort(key, state.sortBy === key && state.sortOrder === "desc" ? "asc" : "desc");
}
async function toggle(item: ClaudePlugin) {
	if (toggling.value) return;
	toggling.value = item.id;
	try {
		await claudePluginsApi.toggle(item);
		state.message = `Plugin "${item.name}" ${item.enabled ? "disabled" : "enabled"}`;
		await store.refresh();
	} catch {
		state.error = "Failed to toggle plugin status";
	} finally {
		toggling.value = "";
	}
}
async function remove() {
	if (!deleting.value) return;
	const item = deleting.value;
	try {
		await store.run(() => claudePluginsApi.delete(item.name), `Plugin "${item.name}" deleted successfully`);
		if (selected.value === item.name) selected.value = "";
	} finally {
		deleting.value = null;
	}
}
async function copy(id: string) {
	await navigator.clipboard.writeText(id);
	state.message = "Copied to clipboard!";
}
function added() {
	state.message = "Plugin registered successfully";
	void store.refresh();
}
onMounted(() => void store.refresh());
onBeforeUnmount(store.dispose);
</script>
<template>
	<main class="tools-plugins-page">
		<AccessNoticeComponent :error="state.error" :message="state.message" />
		<header>
			<h1>Claude Code Plugins</h1>
			<p>
				Manage Claude Code marketplace plugins. Add, enable, disable, or delete plugins that will be available in your marketplace
				catalog. Enabled plugins will appear in the public marketplace at <code>/claude-code/marketplace.json</code>.
			</p>
			<UiButton
				appearance="tremor"
				variant="primary"
				:disabled="!auth.isAuthorized.value || !admin"
				@click="
					selected = '';
					adding = true;
				"
				>+ Add New Plugin</UiButton
			>
		</header>
		<ToolsTableComponent
			:rows="ordered"
			:columns="columns"
			:loading="state.loading"
			:sort-by="state.sortBy"
			:sort-order="state.sortOrder"
			empty-text="No plugins found. Add one to get started."
			@sort="sort"
			@row-click="selected = plugin($event).id"
			><template #cell-name="{ row }"
				><div class="tools-tags">
					<UiTooltip :title="plugin(row).name"
						><button type="button" class="tools-resource-id tools-plugin-name" @click="selected = plugin(row).id">
							{{ plugin(row).name }}
						</button></UiTooltip
					><button type="button" class="tools-copy" title="Copy Plugin ID" @click="copy(plugin(row).id)">
						<UiIcon name="CopyOutlined" />
					</button></div></template
			><template #cell-version="{ value }">{{ value || "N/A" }}</template
			><template #cell-description="{ value }"
				><UiTooltip :title="String(value || 'No description')"
					><span class="tools-plugin-description">{{ value || "No description" }}</span></UiTooltip
				></template
			><template #cell-category="{ value }"
				><UiTag appearance="tremor" size="xs" :color="pluginCategoryColor(String(value || ''))">{{
					value || "Uncategorized"
				}}</UiTag></template
			><template #cell-enabled="{ row }"
				><div class="tools-tags">
					<UiTag appearance="tremor" size="xs" :color="plugin(row).enabled ? 'green' : 'gray'">{{
						plugin(row).enabled ? "Yes" : "No"
					}}</UiTag
					><UiTooltip v-if="admin" :title="plugin(row).enabled ? 'Disable plugin' : 'Enable plugin'"
						><UiSwitch
							size="small"
							:model-value="plugin(row).enabled"
							:loading="toggling === plugin(row).id"
							@update:model-value="toggle(plugin(row))"
					/></UiTooltip></div></template
			><template #cell-created_at="{ value }"
				><UiTooltip :title="String(value || '')"
					><span>{{ value ? new Date(String(value)).toLocaleString() : "-" }}</span></UiTooltip
				></template
			><template #cell-actions="{ row }"
				><AccessActionComponent
					name="Trash2"
					label="Delete plugin"
					@click="deleting = plugin(row)" /></template></ToolsTableComponent
		><PluginDetailsComponent
			v-if="selected"
			:key="selected"
			:id="selected"
			:admin="admin"
			@close="selected = ''"
			@changed="store.refresh"
			@delete="deleting = $event"
			@notice="state.message = $event"
			@error="state.error = $event"
		/><PluginFormDialogComponent v-model:open="adding" @saved="added" @error="state.error = $event" /><UiDialog
			scroll-mode="overlay"
			:open="Boolean(deleting)"
			title="Delete Plugin"
			ok-text="Delete"
			:confirm-loading="state.pending"
			@update:open="!$event && (deleting = null)"
			@ok="remove"
			><p>
				Are you sure you want to delete plugin: <strong>{{ deleting?.name }}</strong
				>?
			</p>
			<p>This action cannot be undone.</p>
			<template #footer
				><UiButton @click="deleting = null">Cancel</UiButton
				><UiButton variant="danger" :loading="state.pending" @click="remove">Delete</UiButton></template
			></UiDialog
		>
	</main>
</template>
