<script setup lang="ts">
import UiTooltip from "../../../platform/ui/UiTooltip.vue";
import GuardrailSortMenuComponent from "../common/GuardrailSortMenuComponent.vue";
import ToolPolicySelectComponent from "./ToolPolicySelectComponent.vue";
import { toolDiscoveryTime } from "../../logic/ToolPolicyListLogic";
import type { ToolPolicyRow, ToolPolicySortField } from "../../support/ToolPolicyModels";
defineProps<{
	rows: ToolPolicyRow[];
	loading: boolean;
	sortField: ToolPolicySortField;
	sortOrder: "asc" | "desc";
	savingInput: string | null;
	savingOutput: string | null;
}>();
const emit = defineEmits<{
		select: [name: string];
		policy: [name: string, value: string, type: "input" | "output"];
		sort: [field: ToolPolicySortField, value: "asc" | "desc" | false];
	}>(),
	columns: { key: string; label: string; sort?: ToolPolicySortField }[] = [
		{ key: "created_at", label: "Discovered", sort: "created_at" },
		{ key: "tool_name", label: "Tool Name", sort: "tool_name" },
		{ key: "input_policy", label: "Input Policy", sort: "input_policy" },
		{ key: "output_policy", label: "Output Policy", sort: "output_policy" },
		{ key: "call_count", label: "# Calls", sort: "call_count" },
		{ key: "team_id", label: "Team Name", sort: "team_id" },
		{ key: "key_hash", label: "Key Hash" },
		{ key: "key_alias", label: "Key Name", sort: "key_alias" },
		{ key: "user_agent", label: "User Agent" },
	];
</script>
<template>
	<div class="tool-policy-table-region">
		<table class="tool-policy-table">
			<thead>
				<tr>
					<th v-for="column in columns" :key="column.key" scope="col">
						<div>
							<span>{{ column.label }}</span
							><GuardrailSortMenuComponent
								v-if="column.sort"
								:value="sortField === column.sort ? sortOrder : false"
								@change="emit('sort', column.sort!, $event)"
							/>
						</div>
					</th>
				</tr>
			</thead>
			<tbody>
				<tr v-if="loading || !rows.length">
					<td :colspan="9" class="tool-policy-table-state">
						{{
							loading
								? "Loading tools…"
								: "No tools discovered yet. Make a chat completion that returns tool_calls to start auto-discovery."
						}}
					</td>
				</tr>
				<tr v-for="tool in loading ? [] : rows" :id="'tool-row-' + tool.tool_id" :key="tool.tool_id">
					<td>
						<span class="tool-discovery-time">{{ toolDiscoveryTime(tool.created_at ?? "") }}</span>
					</td>
					<td>
						<UiTooltip title="Click to view details and block for team/key"
							><button type="button" class="tool-policy-name" @click="emit('select', tool.tool_name)">
								{{ tool.tool_name }}
							</button></UiTooltip
						>
					</td>
					<td>
						<ToolPolicySelectComponent
							:value="tool.input_policy"
							:tool-name="tool.tool_name"
							:saving="savingInput === tool.tool_name"
							@change="(name, value) => emit('policy', name, value, 'input')"
						/>
					</td>
					<td>
						<ToolPolicySelectComponent
							:value="tool.output_policy"
							:tool-name="tool.tool_name"
							:saving="savingOutput === tool.tool_name"
							policy-type="output"
							@change="(name, value) => emit('policy', name, value, 'output')"
						/>
					</td>
					<td>
						<div class="tool-call-count">{{ (tool.call_count ?? 0).toLocaleString() }}</div>
					</td>
					<td>
						<UiTooltip :title="tool.team_id ?? '-'"
							><span class="tool-short-field">{{ tool.team_id ?? "-" }}</span></UiTooltip
						>
					</td>
					<td>
						<UiTooltip :title="tool.key_hash ?? '-'"
							><span class="tool-short-field tool-key-hash">{{ tool.key_hash ?? "-" }}</span></UiTooltip
						>
					</td>
					<td>
						<UiTooltip :title="tool.key_alias ?? '-'"
							><span class="tool-short-field">{{ tool.key_alias ?? "-" }}</span></UiTooltip
						>
					</td>
					<td>
						<UiTooltip :title="tool.user_agent ?? '-'"
							><span class="tool-user-agent">{{ tool.user_agent ?? "-" }}</span></UiTooltip
						>
					</td>
				</tr>
			</tbody>
		</table>
	</div>
</template>
