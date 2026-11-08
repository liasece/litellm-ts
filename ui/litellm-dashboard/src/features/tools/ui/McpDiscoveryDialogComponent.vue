<script setup lang="ts">
import { computed, ref, watch } from "vue";
import UiDialog from "../../platform/ui/UiDialog.vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import { mcpApi } from "../api/McpServersApi";
import type { DiscoverableMCPServer } from "../support/McpModels";
const open = defineModel<boolean>("open", { required: true });
const emit = defineEmits<{ select: [server: DiscoverableMCPServer]; custom: [] }>();
const servers = ref<DiscoverableMCPServer[]>([]),
	categories = ref<string[]>([]),
	loading = ref(false),
	error = ref(""),
	query = ref(""),
	category = ref("All"),
	failed = ref(new Set<string>());
const filtered = computed(() =>
		servers.value.filter(
			(server) =>
				(category.value === "All" || server.category === category.value) &&
				(!query.value.trim() ||
					[server.name, server.title, server.description].some((value) =>
						value.toLowerCase().includes(query.value.toLowerCase()),
					)),
		),
	),
	groups = computed(() => {
		const result: Record<string, DiscoverableMCPServer[]> = {};
		for (const server of filtered.value) (result[server.category || "Other"] ??= []).push(server);
		return result;
	});
watch(open, async (value) => {
	if (!value) return;
	query.value = "";
	category.value = "All";
	loading.value = true;
	error.value = "";
	try {
		const response = await mcpApi.discover();
		servers.value = response.servers;
		categories.value = response.categories;
	} catch (reason) {
		error.value = reason instanceof Error ? reason.message : "Failed to load MCP servers";
	} finally {
		loading.value = false;
	}
});
function avatar(name: string) {
	const colors = ["#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899", "#06B6D4", "#84CC16"];
	return colors[Array.from(name).reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % colors.length];
}
function custom() {
	open.value = false;
	emit("custom");
}
function select(server: DiscoverableMCPServer) {
	open.value = false;
	emit("select", server);
}
</script>
<template>
	<UiDialog
		scroll-mode="overlay"
		v-model:open="open"
		:width="1000"
		:show-footer="false"
		class="tools-mcp-discovery tools-mcp-styled-dialog"
		><template #title
			><header>
				<div>
					<img :src="'/ui/assets/logos/mcp_logo.png'" alt="MCP Logo" width="20" height="20" />
					<h2>Add MCP Server</h2>
				</div>
				<button type="button" @click="custom">+ Custom Server</button>
			</header></template
		>
		<div class="tools-mcp-discovery-pills">
			<button
				v-for="item in ['All', ...categories]"
				:key="item"
				type="button"
				:class="{ 'tools-mcp-category-selected': category === item }"
				@click="category = item"
			>
				{{ item }}
			</button>
		</div>
		<div class="tools-mcp-discovery-search">
			<UiInput v-model="query" placeholder="Search servers..." clearable /><button type="button" aria-label="Search servers">
				<UiIcon name="SearchOutlined" />
			</button>
		</div>
		<div v-if="loading" class="tools-mcp-discovery-loading"><span v-for="index in 8" :key="index" /></div>
		<p v-else-if="error" class="tools-mcp-discovery-empty">Failed to load servers: {{ error }}</p>
		<p v-else-if="!filtered.length" class="tools-mcp-discovery-empty">
			No servers found. <button type="button" @click="custom">Add a custom server</button>
		</p>
		<section v-for="(rows, label) in loading || error ? {} : groups" :key="label" class="tools-mcp-discovery-category">
			<h4>{{ label }}</h4>
			<div>
				<button v-for="server in rows" :key="server.name" type="button" @click="select(server)">
					<img
						v-if="server.icon_url && !failed.has(server.name)"
						:src="server.icon_url"
						:alt="server.title"
						width="20"
						height="20"
						@error="failed.add(server.name)"
					/><span v-else class="tools-mcp-discovery-avatar" :style="{ background: avatar(server.title || server.name) }">{{
						(server.title || server.name).charAt(0).toUpperCase()
					}}</span
					><strong>{{ server.title || server.name }}</strong
					><b>›</b>
				</button>
			</div>
		</section></UiDialog
	>
</template>
