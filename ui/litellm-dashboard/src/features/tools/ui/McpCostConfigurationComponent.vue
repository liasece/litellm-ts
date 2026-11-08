<script setup lang="ts">
import UiCard from "../../platform/ui/UiCard.vue";
import UiInputNumber from "../../platform/ui/UiInputNumber.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import { useMoneyFormatter } from "../../platform/stores/PriceDisplayStore";
import type { MCPServerCostInfo } from "../support/McpModels";
const value = defineModel<MCPServerCostInfo>({ required: true });
withDefaults(defineProps<{ tools?: { name: string; description?: string }[]; disabled?: boolean }>(), { tools: () => [] });
const money = useMoneyFormatter();
function toolCost(name: string, cost: number | null) {
	value.value = { ...value.value, tool_name_to_cost_per_query: { ...value.value.tool_name_to_cost_per_query, [name]: cost } };
}
</script>
<template>
	<UiCard class="tools-mcp-cost-config"
		><h3>
			<UiIcon name="DollarOutlined" :size="14" />Cost Configuration
			<UiTooltip title="Configure costs for this MCP server's tool calls. Set a default rate and per-tool overrides."
				><UiIcon name="InfoCircleOutlined" :size="14"
			/></UiTooltip>
		</h3>
		<label
			>Default Cost per Query ($)
			<UiTooltip title="Default cost charged for each tool call to this server."
				><UiIcon name="InfoCircleOutlined" :size="14" /></UiTooltip
		></label>
		<div class="tools-mcp-cost-input">
			<span>$</span
			><UiInputNumber
				v-model="value.default_cost_per_query"
				:min="0"
				:step="0.0001"
				:precision="4"
				placeholder="0.0000"
				:disabled="disabled"
			/>
		</div>
		<p>Set a default cost for all tool calls to this server</p>
		<template v-if="tools.length"
			><label class="tools-mcp-cost-tools-label"
				>Tool-Specific Costs ($)<UiTooltip
					title="Override the default cost for specific tools. Leave blank to use the default rate."
					><UiIcon name="InfoCircleOutlined" :size="14" /></UiTooltip
			></label>
			<details>
				<summary>
					<span class="tools-mcp-cost-chevron"><UiIcon name="RightOutlined" :size="12" /></span
					><UiIcon class="tools-mcp-cost-tool" name="ToolOutlined" :size="14" /><span class="tools-mcp-cost-summary-label"
						>Available Tools</span
					><b class="tools-mcp-count">{{ tools.length }}</b>
				</summary>
				<div>
					<section v-for="tool in tools" :key="tool.name">
						<div>
							<strong>{{ tool.name }}</strong>
							<p v-if="tool.description">{{ tool.description }}</p>
						</div>
						<div class="tools-mcp-cost-input">
							<span>$</span
							><UiInputNumber
								:model-value="value.tool_name_to_cost_per_query?.[tool.name]"
								:min="0"
								:step="0.0001"
								:precision="4"
								placeholder="Use default"
								:disabled="disabled"
								@update:model-value="toolCost(tool.name, $event)"
							/>
						</div>
					</section>
				</div></details
		></template>
		<aside
			v-if="
				value.default_cost_per_query || (value.tool_name_to_cost_per_query && Object.keys(value.tool_name_to_cost_per_query).length)
			"
		>
			<strong>Cost Summary:</strong>
			<p v-if="value.default_cost_per_query">• Default cost: {{ money(value.default_cost_per_query, 4) }} per query</p>
			<template v-for="(cost, tool) in value.tool_name_to_cost_per_query" :key="tool"
				><p v-if="cost != null">• {{ tool }}: {{ money(cost, 4) }} per query</p></template
			>
		</aside></UiCard
	>
</template>
