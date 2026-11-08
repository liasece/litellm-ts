<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import UiDrawer from "../../platform/ui/UiDrawer.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiTag from "../../platform/ui/UiTag.vue";
import UiSwitch from "../../platform/ui/UiSwitch.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiAlert from "../../platform/ui/UiAlert.vue";
import AccessHeroIconComponent from "../../access-control/ui/AccessHeroIconComponent.vue";
import PluginFormDialogComponent from "./PluginFormDialogComponent.vue";
import { claudePluginsApi } from "../api/ClaudePluginsApi";
import { pluginInstallCommand, pluginSourceText, pluginSourceUrl, pluginCategoryColor, pluginDate } from "../logic/PluginDraftLogic";
import type { ClaudePlugin } from "../support/PluginModels";
const props = defineProps<{ id: string; admin: boolean }>();
const emit = defineEmits<{ close: []; changed: []; delete: [plugin: ClaudePlugin]; notice: [message: string]; error: [message: string] }>();
const plugin = ref<ClaudePlugin | null>(null),
	loading = ref(true),
	error = ref(""),
	toggling = ref(false),
	editing = ref(false);
let controller: AbortController | null = null;
async function load() {
	controller?.abort();
	controller = new AbortController();
	loading.value = true;
	error.value = "";
	try {
		plugin.value = await claudePluginsApi.detail(props.id, controller.signal);
	} catch (reason) {
		if (!(reason instanceof DOMException && reason.name === "AbortError")) error.value = "Failed to load plugin information";
	} finally {
		loading.value = false;
	}
}
async function toggle() {
	if (!plugin.value || toggling.value) return;
	toggling.value = true;
	try {
		await claudePluginsApi.toggle(plugin.value);
		emit("notice", `Plugin "${plugin.value.name}" ${plugin.value.enabled ? "disabled" : "enabled"}`);
		emit("changed");
		await load();
	} catch {
		emit("error", "Failed to toggle plugin status");
	} finally {
		toggling.value = false;
	}
}
function changed() {
	emit("changed");
	void load();
}
async function copy(value: string) {
	await navigator.clipboard.writeText(value);
	emit("notice", "Copied to clipboard!");
}
onMounted(() => void load());
onBeforeUnmount(() => controller?.abort());
</script>
<template>
	<UiDrawer :open="true" class="tools-plugin-drawer" :title="plugin?.name || 'Plugin details'" @update:open="!$event && emit('close')"
		><template #title
			><div class="tools-plugin-drawer-title">
				<div class="tools-plugin-drawer-identity">
					<div>{{ plugin?.name || "Plugin details" }}</div>
					<div class="tools-drawer-subtitle">{{ plugin?.id || id }}</div>
				</div>
				<div v-if="plugin && admin" class="tools-plugin-actions">
					<UiButton appearance="tremor" variant="primary" @click="editing = true"
						><template #icon><UiIcon name="EditOutlined" /></template>Edit</UiButton
					>
					<UiButton appearance="tremor" variant="primary" class="tools-plugin-delete" @click="emit('delete', plugin)"
						>Delete</UiButton
					>
				</div>
			</div></template
		>
		<p v-if="loading">Loading...</p>
		<UiAlert v-else-if="error" type="error" :title="error"><UiButton @click="load">Retry</UiButton></UiAlert>
		<div v-else-if="plugin" class="tools-plugin-details">
			<div class="tools-tags">
				<h3>{{ plugin.name }}</h3>
				<UiTag v-if="plugin.version" appearance="tremor" size="xs" color="blue">v{{ plugin.version }}</UiTag
				><UiTag v-if="plugin.category" appearance="tremor" size="xs" :color="pluginCategoryColor(plugin.category)">{{
					plugin.category
				}}</UiTag
				><UiTag appearance="tremor" size="xs" :color="plugin.enabled ? 'green' : 'gray'">{{
					plugin.enabled ? "Enabled" : "Disabled"
				}}</UiTag>
			</div>
			<UiCard
				><div class="tools-plugin-install">
					<div>
						<small>Install Command</small>
						<div class="tools-plugin-install-command">{{ pluginInstallCommand(plugin) }}</div>
					</div>
					<UiButton appearance="tremor" size="small" title="Copy install command" @click="copy(pluginInstallCommand(plugin))"
						><UiIcon name="CopyOutlined" />Copy</UiButton
					>
				</div></UiCard
			><UiCard
				><h3>Plugin Details</h3>
				<dl class="tools-plugin-details-grid">
					<div>
						<dt>Plugin ID</dt>
						<dd>
							<code>{{ plugin.id }}</code
							><button class="tools-copy" title="Copy Plugin ID" @click="copy(plugin.id)">
								<UiIcon name="CopyOutlined" :size="12" />
							</button>
						</dd>
					</div>
					<div>
						<dt>Name</dt>
						<dd>{{ plugin.name }}</dd>
					</div>
					<div>
						<dt>Version</dt>
						<dd>{{ plugin.version || "N/A" }}</dd>
					</div>
					<div class="tools-span-two">
						<dt>Source</dt>
						<dd>
							{{ pluginSourceText(plugin.source)
							}}<a
								v-if="pluginSourceUrl(plugin.source)"
								:href="pluginSourceUrl(plugin.source)"
								target="_blank"
								rel="noopener noreferrer"
								><AccessHeroIconComponent name="ExternalLink"
							/></a>
						</dd>
					</div>
					<div>
						<dt>Category</dt>
						<dd class="tools-plugin-category">
							<UiTag v-if="plugin.category" appearance="tremor" size="xs" :color="pluginCategoryColor(plugin.category)">{{
								plugin.category
							}}</UiTag
							><span v-else class="tools-muted">Uncategorized</span>
						</dd>
					</div>
					<div v-if="admin" class="tools-span-three">
						<dt>Status</dt>
						<dd>
							<UiSwitch :model-value="plugin.enabled" :loading="toggling" @update:model-value="toggle" /><span>{{
								plugin.enabled
									? "Plugin is enabled and visible in marketplace"
									: "Plugin is disabled and hidden from marketplace"
							}}</span>
						</dd>
					</div>
				</dl></UiCard
			><UiCard v-if="plugin.description"
				><h3>Description</h3>
				<p>{{ plugin.description }}</p></UiCard
			><UiCard v-if="plugin.keywords?.length"
				><h3>Keywords</h3>
				<div class="tools-tags">
					<UiTag v-for="word in plugin.keywords" :key="word" appearance="tremor" size="xs" color="gray">{{ word }}</UiTag>
				</div></UiCard
			><UiCard v-if="plugin.author"
				><h3>Author Information</h3>
				<dl class="tools-plugin-details-grid tools-two-columns">
					<div v-if="plugin.author.name">
						<dt>Name</dt>
						<dd>{{ plugin.author.name }}</dd>
					</div>
					<div v-if="plugin.author.email">
						<dt>Email</dt>
						<dd>
							<a :href="'mailto:' + plugin.author.email">{{ plugin.author.email }}</a>
						</dd>
					</div>
				</dl></UiCard
			><UiCard v-if="plugin.homepage"
				><h3>Homepage</h3>
				<a :href="plugin.homepage" target="_blank" rel="noopener noreferrer"
					>{{ plugin.homepage }}<AccessHeroIconComponent name="ExternalLink" /></a></UiCard
			><UiCard
				><h3>Metadata</h3>
				<dl class="tools-plugin-details-grid tools-two-columns">
					<div>
						<dt>Created At</dt>
						<dd>{{ pluginDate(plugin.created_at) }}</dd>
					</div>
					<div>
						<dt>Updated At</dt>
						<dd>{{ pluginDate(plugin.updated_at) }}</dd>
					</div>
					<div v-if="plugin.created_by" class="tools-span-two">
						<dt>Created By</dt>
						<dd>{{ plugin.created_by }}</dd>
					</div>
				</dl></UiCard
			><PluginFormDialogComponent v-model:open="editing" :plugin="plugin" @saved="changed" @error="emit('error', $event)" /></div
	></UiDrawer>
</template>
