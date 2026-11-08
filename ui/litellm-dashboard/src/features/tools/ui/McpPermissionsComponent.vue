<script setup lang="ts">
import { computed } from "vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiSwitch from "../../platform/ui/UiSwitch.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import AccessFieldComponent from "../../access-control/ui/AccessFieldComponent.vue";
import { objectValue } from "../logic/McpDraftLogic";
const draft = defineModel<Record<string, unknown>>({ required: true });
defineProps<{ groups: string[]; errors?: Record<string, string> }>();
const headers = computed(() => (Array.isArray(draft.value.static_headers) ? draft.value.static_headers.map(objectValue) : []));
function add() {
	draft.value.static_headers = [...headers.value, {}];
}
function remove(index: number) {
	draft.value.static_headers = headers.value.filter((_, i) => i !== index);
}
</script>
<template>
	<details class="tools-mcp-permissions">
		<summary>
			<h3>Permission Management / Access Control</h3>
			<p>Configure access permissions and security settings (Optional)</p>
			<UiIcon class="tools-mcp-permission-arrow" name="RightOutlined" :size="12" />
		</summary>
		<div>
			<section class="tools-mcp-permission-switch">
				<div>
					<strong
						>Allow All LiteLLM Keys<UiTooltip title="When enabled, every API key can access this MCP server."
							><UiIcon name="InfoCircleOutlined" :size="14" /></UiTooltip
					></strong>
					<p>Enable if this server should be &quot;public&quot; to all keys.</p>
				</div>
				<div class="tools-mcp-permission-control">
					<UiSwitch :model-value="Boolean(draft.allow_all_keys)" @update:model-value="draft.allow_all_keys = $event" />
				</div>
			</section>
			<section class="tools-mcp-permission-switch">
				<div>
					<strong
						>Internal network only<UiTooltip
							title="When on, only requests from within your internal network are accepted. Turn off to allow external clients (other clusters, ChatGPT, etc). API key authentication is always required regardless of this setting."
							><UiIcon name="InfoCircleOutlined" :size="14" /></UiTooltip
					></strong>
					<p>Turn on to restrict access to callers within your internal network only.</p>
				</div>
				<div class="tools-mcp-permission-control">
					<UiSwitch
						:model-value="!draft.available_on_public_internet"
						@update:model-value="draft.available_on_public_internet = !$event"
					/>
				</div>
			</section>
			<AccessFieldComponent
				v-model="draft.mcp_access_groups"
				max-tag-count="responsive"
				label="MCP Access Groups"
				tooltip-icon="InfoCircleOutlined"
				tooltip="Specify access groups for this MCP server. Users must be in at least one of these groups to access the server."
				type="select"
				multiple
				creatable
				:options="groups.map((value) => ({ value, label: value }))"
				placeholder="Select existing groups or type to create new ones"
			/><AccessFieldComponent
				v-model="draft.extra_headers"
				label="Extra Headers"
				tooltip-icon="InfoCircleOutlined"
				tooltip="Forward custom headers from incoming requests to this MCP server (e.g., Authorization, X-Custom-Header, User-Agent)"
				type="select"
				multiple
				creatable
				placeholder="Enter header names (e.g., Authorization, X-Custom-Header)"
			/><label class="tools-mcp-field-label">Static Headers</label>
			<div v-for="(header, index) in headers" :key="index" class="tools-mcp-static-header">
				<AccessFieldComponent
					v-model="header.header"
					:name="'mcp-static-' + index"
					placeholder="Header name (e.g., X-API-Key)"
					:error="errors?.['static_headers.' + index + '.header']"
				/><AccessFieldComponent
					v-model="header.value"
					:name="'mcp-static-value-' + index"
					placeholder="Header value"
					:error="errors?.['static_headers.' + index + '.value']"
				/><button type="button" aria-label="Remove static header" @click="remove(index)">
					<UiIcon name="MinusCircleOutlined" />
				</button>
			</div>
			<UiButton class="tools-mcp-add-static" @click="add"><UiIcon name="PlusOutlined" />Add Static Header</UiButton>
		</div>
	</details>
</template>
