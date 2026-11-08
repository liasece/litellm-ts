<script setup lang="ts">
import { computed, ref, watch } from "vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiCheckbox from "../../platform/ui/UiCheckbox.vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import KeyCrudPermissionsComponent from "../../virtual-keys/ui/KeyCrudPermissionsComponent.vue";
import { suggestedMcpTools, type McpToolEntry } from "../logic/McpToolSelectionLogic";
import type { McpFormConfig } from "../support/McpModels";
import type { createMcpConnectionStore } from "../stores/McpConnectionStore";
const config = defineModel<McpFormConfig>({ required: true });
const props = withDefaults(
	defineProps<{
		connection: ReturnType<typeof createMcpConnectionStore>;
		values: Record<string, unknown>;
		existing?: string[] | null;
		suggestions?: McpToolEntry[];
	}>(),
	{ existing: undefined, suggestions: () => [] },
);
const query = ref(""),
	mode = ref("crud"),
	expanded = ref(new Set<string>());
let initialized = false,
	lastSuggested = "";
const tools = computed(() => props.connection.tools.value),
	suggested = computed(() => suggestedMcpTools(tools.value, props.suggestions)),
	suggestedNames = computed(() => new Set(suggested.value.map((tool) => tool.name))),
	filtered = computed(() =>
		tools.value.filter((tool) =>
			[tool.name, tool.description || ""].some((value) => value.toLowerCase().includes(query.value.toLowerCase())),
		),
	),
	groups = computed(() => [
		{ name: "Suggested tools", rows: filtered.value.filter((tool) => suggestedNames.value.has(tool.name)), suggested: true },
		{
			name: suggested.value.length ? "All tools" : "Tools",
			rows: filtered.value.filter((tool) => !suggestedNames.value.has(tool.name)),
			suggested: false,
		},
	]);
watch(
	() =>
		suggested.value
			.map((tool) => tool.name)
			.sort()
			.join(","),
	(value) => {
		if (value !== lastSuggested && value) initialized = false;
		lastSuggested = value;
	},
);
watch(
	() =>
		tools.value
			.map((tool) => tool.name)
			.sort()
			.join(","),
	(value, previous) => {
		if (!tools.value.length || value === previous) return;
		const names = tools.value.map((tool) => tool.name);
		if (!initialized) {
			initialized = true;
			config.value.allowedTools = props.existing?.length
				? props.existing.filter((name) => names.includes(name))
				: suggested.value.length
					? suggested.value.map((tool) => tool.name).filter((name) => names.includes(name))
					: names;
		} else config.value.allowedTools = config.value.allowedTools.filter((name) => names.includes(name));
	},
	{ immediate: true },
);
function toggle(name: string) {
	config.value.allowedTools = config.value.allowedTools.includes(name)
		? config.value.allowedTools.filter((value) => value !== name)
		: [...config.value.allowedTools, name];
}
function bulk(suggestedGroup: boolean, enabled: boolean) {
	const names = tools.value.filter((tool) => suggestedNames.value.has(tool.name) === suggestedGroup).map((tool) => tool.name);
	config.value.allowedTools = enabled
		? [...new Set([...config.value.allowedTools, ...names])]
		: config.value.allowedTools.filter((name) => !names.includes(name));
}
function override(kind: "displayNames" | "descriptions", name: string, value: string | number | null) {
	const text = String(value ?? ""),
		next = { ...config.value[kind] };
	if (text) next[name] = text;
	else delete next[name];
	config.value[kind] = next;
}
</script>
<template>
	<UiCard v-if="connection.canFetch.value || values.url || values.spec_path" class="tools-mcp-tool-config"
		><header>
			<h3>
				<UiIcon name="ToolOutlined" :size="14" />Tool Configuration
				<span v-if="tools.length" class="tools-mcp-count">{{ tools.length }}</span>
			</h3>
			<div v-if="tools.length" class="tools-mcp-view-modes">
				<button type="button" :class="{ active: mode === 'crud' }" @click="mode = 'crud'">Risk Groups</button
				><button type="button" :class="{ active: mode === 'flat' }" @click="mode = 'flat'">Flat List</button>
			</div>
		</header>
		<aside>
			<strong>Select which tools users can call:</strong> Only checked tools will be available for users to invoke. Unchecked tools
			will be blocked from execution.
		</aside>
		<p v-if="connection.loading.value" class="tools-mcp-loading">Loading tools from spec...</p>
		<div v-else-if="connection.error.value" class="tools-mcp-dashed-empty tools-error">
			<UiIcon name="ToolOutlined" :size="24" />
			<p>Unable to load tools</p>
			<small>{{ connection.error.value }}</small>
		</div>
		<div v-else-if="!connection.canFetch.value" class="tools-mcp-dashed-empty">
			<UiIcon name="ToolOutlined" :size="24" />
			<p>Complete required fields to configure tools</p>
			<small>Fill in URL, Transport, and Authentication to load available tools</small>
		</div>
		<div v-else-if="!tools.length" class="tools-mcp-dashed-empty">
			<UiIcon name="ToolOutlined" :size="24" />
			<p>{{ suggestions.length ? "No tools loaded from spec" : "No tools available for configuration" }}</p>
			<small>{{
				suggestions.length
					? "Expected tools: " + suggestions.map((tool) => tool.name).join(", ")
					: "Connect to an MCP server with tools to configure them"
			}}</small>
		</div>
		<template v-else
			><div class="tools-mcp-tool-enabled">
				<UiIcon name="CheckCircleOutlined" :size="14" />{{ config.allowedTools.length }} of {{ tools.length }}
				{{ tools.length === 1 ? "tool" : "tools" }} enabled for user access
			</div>
			<UiInput
				v-model="query"
				placeholder="Search tools by name or description..."
				size="large"
				clearable
			/><KeyCrudPermissionsComponent
				v-if="mode === 'crud'"
				:tools="tools"
				:search-filter="query"
				:model-value="config.allowedTools.length ? config.allowedTools : undefined"
				@update:model-value="config.allowedTools = $event"
			/>
			<p v-else-if="!filtered.length" class="tools-mcp-dashed-empty">No tools found matching &quot;{{ query }}&quot;</p>
			<template v-else v-for="group in groups" :key="group.name"
				><section v-if="group.rows.length" class="tools-mcp-tool-group">
					<header>
						<h4>{{ group.name }}</h4>
						<div>
							<button type="button" @click="bulk(group.suggested, true)">Enable all</button
							><button type="button" @click="bulk(group.suggested, false)">Disable all</button>
						</div>
					</header>
					<article
						v-for="tool in group.rows"
						:key="tool.name"
						:class="{ 'tools-mcp-tool-is-enabled': config.allowedTools.includes(tool.name) }"
					>
						<div class="tools-mcp-tool-row" @click="toggle(tool.name)">
							<UiCheckbox
								:model-value="config.allowedTools.includes(tool.name)"
								@click.stop
								@update:model-value="toggle(tool.name)"
							/>
							<div>
								<header>
									<strong>{{ config.displayNames[tool.name] || tool.name }}</strong
									><span
										:class="
											config.allowedTools.includes(tool.name) ? 'tools-mcp-enabled-label' : 'tools-mcp-disabled-label'
										"
										>{{ config.allowedTools.includes(tool.name) ? "Enabled" : "Disabled" }}</span
									><span v-if="config.displayNames[tool.name]" class="tools-mcp-custom-name">Custom name</span>
								</header>
								<p>{{ config.descriptions[tool.name] || tool.description }}</p>
								<small>{{
									config.allowedTools.includes(tool.name) ? "✓ Users can call this tool" : "✗ Users cannot call this tool"
								}}</small>
							</div>
							<button
								type="button"
								title="Edit display name and description"
								@click.stop="expanded.has(tool.name) ? expanded.delete(tool.name) : expanded.add(tool.name)"
							>
								<UiIcon name="EditOutlined" />
							</button>
						</div>
						<div v-if="expanded.has(tool.name)" class="tools-mcp-tool-overrides">
							<label>Display Name</label
							><UiInput
								:model-value="config.displayNames[tool.name] || ''"
								:placeholder="tool.name"
								@update:model-value="override('displayNames', tool.name, $event)"
							/><small>Override how this tool's name appears to users. Leave blank to use original.</small
							><label>Description</label
							><UiInput
								:model-value="config.descriptions[tool.name] || ''"
								:placeholder="tool.description || 'No description'"
								multiline
								:rows="2"
								@update:model-value="override('descriptions', tool.name, $event)"
							/><small>Override the tool description shown to users. Leave blank to use original.</small>
						</div>
					</article>
				</section></template
			></template
		></UiCard
	>
</template>
