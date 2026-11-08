<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, watch } from "vue";
import { z } from "zod";
import { requestJson } from "../../platform/api/HttpApiClient";
import UiSpinner from "../../platform/ui/UiSpinner.vue";
import { classifyToolOp, type MCPToolEntry } from "../logic/McpToolCrudLogic";
import type { KeyCatalog, KeyDraft } from "../support/VirtualKeyModels";
import "./styles/KeyPermissionForms.css";
import KeyCrudPermissions from "./KeyCrudPermissionsComponent.vue";
const draft = defineModel<Pick<KeyDraft, "mcp_servers" | "mcp_tool_permissions">>({ required: true });
const props = defineProps<{ catalog: Pick<KeyCatalog, "mcpServers">; disabled?: boolean }>();
const tools = reactive<Record<string, MCPToolEntry[]>>({});
const loading = reactive<Record<string, boolean>>({});
const errors = reactive<Record<string, string>>({});
const viewModes = reactive<Record<string, "crud" | "flat">>({});
const controllers = new Map<string, AbortController>();
const servers = computed(() =>
	draft.value.mcp_servers.map((id) => props.catalog.mcpServers.find((server) => String(server.value) === id) ?? { value: id, label: id }),
);
const toolSchema = z.object({ name: z.string(), description: z.string().optional() }).passthrough();
let disposed = false;
async function load(id: string) {
	const controller = new AbortController();
	controllers.set(id, controller);
	loading[id] = true;
	errors[id] = "";
	try {
		const response = await requestJson(
			"/mcp-rest/tools/list?server_id=" + encodeURIComponent(id),
			{ signal: controller.signal },
			(value) =>
				z
					.object({ tools: z.array(toolSchema).default([]), error: z.unknown().optional(), message: z.string().optional() })
					.passthrough()
					.parse(value),
		);
		if (disposed || controller.signal.aborted || !draft.value.mcp_servers.includes(id)) return;
		if (response.error) {
			errors[id] = response.message || "Failed to fetch tools";
			tools[id] = [];
			return;
		}
		tools[id] = response.tools;
		if (!Object.prototype.hasOwnProperty.call(draft.value.mcp_tool_permissions, id) && response.tools.length) {
			draft.value.mcp_tool_permissions = {
				...draft.value.mcp_tool_permissions,
				[id]: response.tools
					.filter((tool) => classifyToolOp(tool.name, tool.description || "") !== "delete")
					.map((tool) => tool.name),
			};
		}
	} catch (error: unknown) {
		if (!disposed && !controller.signal.aborted) {
			tools[id] = [];
			errors[id] = error instanceof Error ? error.message : "Failed to fetch tools";
		}
	} finally {
		if (controllers.get(id) === controller) {
			if (!disposed) loading[id] = false;
			controllers.delete(id);
		}
	}
}
watch(
	servers,
	(value) => {
		for (const server of value) if (!tools[String(server.value)] && !loading[String(server.value)]) void load(String(server.value));
		for (const [id, controller] of controllers)
			if (!value.some((server) => String(server.value) === id)) {
				controller.abort();
				controllers.delete(id);
				loading[id] = false;
			}
	},
	{ immediate: true },
);
function update(id: string, names: string[]) {
	if (!props.disabled) draft.value.mcp_tool_permissions = { ...draft.value.mcp_tool_permissions, [id]: names };
}
function toggle(id: string, name: string) {
	const current = draft.value.mcp_tool_permissions[id] ?? [];
	update(id, current.includes(name) ? current.filter((value) => value !== name) : [...current, name]);
}
onBeforeUnmount(() => {
	disposed = true;
	for (const controller of controllers.values()) controller.abort();
});
</script>
<template>
	<div class="vk-mcp-permissions">
		<section v-for="server in servers" :key="server.value" class="vk-mcp-server">
			<header>
				<strong>{{ server.label }}</strong>
				<div>
					<div v-if="!disabled && tools[String(server.value)]?.length" class="vk-segmented">
						<button
							type="button"
							:class="{ active: (viewModes[String(server.value)] || 'crud') === 'crud' }"
							@click="viewModes[String(server.value)] = 'crud'"
						>
							Risk Groups</button
						><button
							type="button"
							:class="{ active: viewModes[String(server.value)] === 'flat' }"
							@click="viewModes[String(server.value)] = 'flat'"
						>
							Flat List
						</button>
					</div>
					<button
						v-if="!disabled"
						type="button"
						:disabled="loading[String(server.value)]"
						@click="
							update(
								String(server.value),
								(tools[String(server.value)] || []).map((tool) => tool.name),
							)
						"
					>
						Select All</button
					><button
						v-if="!disabled"
						type="button"
						:disabled="loading[String(server.value)]"
						@click="update(String(server.value), [])"
					>
						Deselect All
					</button>
				</div>
			</header>
			<div class="vk-mcp-server-body">
				<div v-if="loading[String(server.value)]" class="vk-mcp-loading"><UiSpinner :size="32" />Loading tools...</div>
				<div v-else-if="errors[String(server.value)]" class="vk-mcp-error">
					<strong>Unable to load tools</strong>
					<p>{{ errors[String(server.value)] }}</p>
				</div>
				<KeyCrudPermissions
					v-else-if="tools[String(server.value)]?.length && (viewModes[String(server.value)] || 'crud') === 'crud'"
					:tools="tools[String(server.value)]"
					:model-value="draft.mcp_tool_permissions[String(server.value)]"
					:disabled="disabled"
					@update:model-value="update(String(server.value), $event)"
				/>
				<div v-else-if="tools[String(server.value)]?.length" class="vk-mcp-flat">
					<label v-for="tool in tools[String(server.value)]" :key="tool.name"
						><input
							type="checkbox"
							:checked="(draft.mcp_tool_permissions[String(server.value)] || []).includes(tool.name)"
							:disabled="disabled"
							@change="toggle(String(server.value), tool.name)"
						/><span
							><strong>{{ tool.name }}</strong
							><span> - {{ tool.description || "No description" }}</span></span
						></label
					>
				</div>
				<p v-else class="vk-mcp-empty">No tools available</p>
			</div>
		</section>
	</div>
</template>
