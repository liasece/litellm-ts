<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { chatMcpCredentialsApi, type ChatMcpCredential } from "../../api/ChatMcpCredentialsApi";
import { credentialExpiry, credentialRelativeTime } from "../../logic/ChatMcpLogic";
import { messageManager } from "../../../notifications/logic/MessageManager";
import UiIcon from "../../../platform/ui/UiIcon.vue";
import UiTag from "../../../platform/ui/UiTag.vue";
import UiSpinner from "../../../platform/ui/UiSpinner.vue";
const credentials = ref<ChatMcpCredential[]>([]),
	loading = ref(true),
	revoking = ref(new Set<string>()),
	controller = new AbortController();
let disposed = false;
onMounted(async () => {
	try {
		const result = await chatMcpCredentialsApi.list(controller.signal);
		if (!disposed) credentials.value = result;
	} catch {
		if (!disposed) credentials.value = [];
	} finally {
		if (!disposed) loading.value = false;
	}
});
onBeforeUnmount(() => {
	disposed = true;
	controller.abort();
});
async function revoke(id: string) {
	revoking.value = new Set([...revoking.value, id]);
	try {
		await chatMcpCredentialsApi.remove(id);
		if (!disposed) credentials.value = credentials.value.filter((credential) => credential.server_id !== id);
	} catch {
		if (!disposed) messageManager.error("Failed to revoke connection. Please try again.");
	} finally {
		if (!disposed) {
			const next = new Set(revoking.value);
			next.delete(id);
			revoking.value = next;
		}
	}
}
</script>
<template>
	<div class="chat-mcp-credentials">
		<header>
			<h2>App Credentials</h2>
			<p>Your stored OAuth connections — used automatically in chat.</p>
		</header>
		<div v-if="loading" class="chat-mcp-apps__loading"><UiSpinner /></div>
		<div v-else-if="!credentials.length" class="chat-mcp-credentials__empty">
			<UiIcon name="LinkOutlined" />No connections yet.<br />Go to <strong>Apps</strong> and click <strong>Connect</strong> to
			authorize an MCP server.
		</div>
		<div v-else class="chat-mcp-credentials__table">
			<table>
				<thead>
					<tr>
						<th>App</th>
						<th>Connected</th>
						<th>Status</th>
						<th>Actions</th>
					</tr>
				</thead>
				<tbody>
					<tr v-for="credential in credentials" :key="credential.server_id">
						<td>
							<strong>{{ credential.alias || credential.server_name || credential.server_id }}</strong>
						</td>
						<td>{{ credentialRelativeTime(credential.connected_at) || "—" }}</td>
						<td>
							<UiTag
								:color="credentialExpiry(credential.expires_at) === 'Expired' ? 'red' : 'green'"
								appearance="tremor"
								size="xs"
								>{{ credentialExpiry(credential.expires_at) }}</UiTag
							>
						</td>
						<td>
							<button
								type="button"
								title="Revoke connection"
								:disabled="revoking.has(credential.server_id)"
								@click="revoke(credential.server_id)"
							>
								<UiSpinner v-if="revoking.has(credential.server_id)" :size="14" /><UiIcon v-else name="DeleteOutlined" />
							</button>
						</td>
					</tr>
				</tbody>
			</table>
		</div>
	</div>
</template>
