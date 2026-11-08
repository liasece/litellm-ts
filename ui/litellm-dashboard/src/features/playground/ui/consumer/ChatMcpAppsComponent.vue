<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from "vue";
import type { PlaygroundMcpServer } from "../../support/PlaygroundModels";
import { createChatMcpAppsStore } from "../../stores/ChatMcpAppsStore";
import { chatMcpName, chatMcpTransport } from "../../logic/ChatMcpLogic";
import ChatMcpAvatarComponent from "./ChatMcpAvatarComponent.vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
import UiInput from "../../../platform/ui/UiInput.vue";
import UiButton from "../../../platform/ui/UiButton.vue";
import UiSpinner from "../../../platform/ui/UiSpinner.vue";
const props = defineProps<{ selected: string[] }>(),
	emit = defineEmits<{ change: [string[]] }>(),
	store = createChatMcpAppsStore({ selected: () => props.selected, change: (names) => emit("change", names) }),
	state = store.state,
	connectedCount = computed(() => state.servers.filter((server) => props.selected.includes(chatMcpName(server))).length),
	totalTools = computed(() => Object.values(state.counts).reduce((sum, count) => sum + count, 0));
function oauthLoading(server: PlaygroundMcpServer) {
	return ["authorizing", "exchanging"].includes(store.oauth.state.status[server.server_id]);
}
function connect(server: PlaygroundMcpServer) {
	if (server.auth_type === "oauth2") {
		if (state.oauthConnected.has(server.server_id)) void store.disconnect(server);
		else void store.oauth.start(server.server_id, chatMcpName(server));
	} else void store.toggle(server, !props.selected.includes(chatMcpName(server)));
}
onMounted(() => void store.load());
onBeforeUnmount(store.dispose);
</script>
<template>
	<div class="chat-mcp-apps">
		<template v-if="state.detail"
			><button type="button" class="chat-mcp-apps__back" @click="store.detail(null)"><UiIcon name="ArrowLeftOutlined" />Back</button>
			<div class="chat-mcp-apps__detail-heading">
				<ChatMcpAvatarComponent :server="state.detail" :size="64" />
				<div>
					<h2>{{ chatMcpName(state.detail) }}</h2>
					<p>{{ state.detail.description || "MCP server" }}</p>
				</div>
				<UiButton
					:variant="
						state.detail.auth_type === 'oauth2'
							? state.oauthConnected.has(state.detail.server_id)
								? 'danger'
								: 'primary'
							: selected.includes(chatMcpName(state.detail))
								? 'default'
								: 'primary'
					"
					:loading="oauthLoading(state.detail) || state.toggling.has(chatMcpName(state.detail))"
					@click="connect(state.detail)"
					>{{
						(
							state.detail.auth_type === "oauth2"
								? state.oauthConnected.has(state.detail.server_id)
								: selected.includes(chatMcpName(state.detail))
						)
							? "Disconnect"
							: oauthLoading(state.detail)
								? "Connecting…"
								: "Connect"
					}}</UiButton
				>
			</div>
			<h3>Information</h3>
			<div class="chat-mcp-apps__info">
				<div>
					<span>Server ID</span><strong>{{ state.detail.server_id }}</strong>
				</div>
				<div>
					<span>Transport</span><strong>{{ chatMcpTransport(state.detail) }}</strong>
				</div>
				<div>
					<span>Status</span><strong>{{ selected.includes(chatMcpName(state.detail)) ? "Connected" : "Not connected" }}</strong>
				</div>
			</div>
			<h3 class="chat-mcp-apps__tools-heading">
				Available Tools <span v-if="!state.loadingTools">{{ state.tools.length }}</span>
			</h3>
			<div v-if="state.loadingTools" class="chat-mcp-apps__loading"><UiSpinner :size="16" /></div>
			<div v-else-if="!state.tools.length" class="chat-mcp-apps__no-tools">No tools available</div>
			<div v-else class="chat-mcp-apps__tools">
				<div v-for="tool in state.tools" :key="tool.name">
					<strong><UiIcon name="ToolOutlined" />{{ tool.name }}</strong>
					<p v-if="tool.description">{{ tool.description }}</p>
				</div>
			</div></template
		><template v-else
			><header>
				<div>
					<div class="chat-mcp-apps__title">
						<h2>MCP Servers</h2>
						<span>Beta</span>
					</div>
					<div class="chat-mcp-apps__subtitle">
						<p>Browse tools, authenticate once, use in chat — no setup needed.</p>
						<span v-if="state.loadingCounts"><UiSpinner :size="12" />Loading tools...</span
						><span v-else-if="totalTools"
							><UiIcon name="ToolOutlined" />{{ totalTools }} tool{{ totalTools !== 1 ? "s" : "" }} available</span
						>
					</div>
				</div>
				<UiInput
					v-model="state.query"
					clearable
					placeholder="Search servers..."
					style="width: 220px; border-radius: 8px; font-size: 13px"
					><template #prefix><UiIcon name="SearchOutlined" /></template
				></UiInput>
			</header>
			<nav>
				<button type="button" :class="{ 'is-active': state.tab === 'all' }" @click="state.tab = 'all'">All</button
				><button type="button" :class="{ 'is-active': state.tab === 'connected' }" @click="state.tab = 'connected'">
					Connected{{ connectedCount ? " (" + connectedCount + ")" : "" }}
				</button>
			</nav>
			<div v-if="state.loading" class="chat-mcp-apps__loading"><UiSpinner /></div>
			<div v-else-if="!store.filtered.value.length" class="chat-mcp-apps__empty">
				{{
					!state.servers.length
						? "No MCP servers configured. Add servers in Tools → MCP Servers."
						: state.tab === "connected"
							? "No servers connected yet."
							: "No servers match your search."
				}}
			</div>
			<div v-else class="chat-mcp-apps__grid">
				<div
					v-for="server in store.filtered.value"
					:key="server.server_id"
					class="chat-mcp-apps__card"
					role="button"
					tabindex="0"
					@click="store.detail(server)"
					@keydown.enter.self="store.detail(server)"
				>
					<ChatMcpAvatarComponent :server="server" />
					<div>
						<strong>{{ chatMcpName(server) }}</strong>
						<p>
							<span>{{ server.description || "MCP server" }}</span
							><small v-if="state.counts[chatMcpName(server)]"
								>· <UiIcon name="ToolOutlined" />{{ state.counts[chatMcpName(server)] }}</small
							><i v-else-if="state.loadingCounts" class="chat-skeleton"></i>
						</p>
					</div>
					<template v-if="server.auth_type === 'oauth2'"
						><UiIcon
							v-if="state.oauthConnected.has(server.server_id)"
							name="CheckCircleOutlined"
							class="chat-mcp-apps__oauth-check"
						/><button
							v-else
							type="button"
							class="chat-mcp-apps__connect"
							:disabled="oauthLoading(server)"
							@click.stop="connect(server)"
						>
							{{ oauthLoading(server) ? "Connecting…" : "Connect" }}
						</button></template
					><i v-else-if="selected.includes(chatMcpName(server))" class="chat-mcp-apps__connected-dot"></i
					><UiIcon name="RightOutlined" />
				</div></div
		></template>
	</div>
</template>
