<script setup lang="ts">
import { computed } from "vue";
import { useMoneyFormatter } from "../../platform/stores/PriceDisplayStore";
import type { MCPServerCostInfo } from "../support/McpModels";
const props = defineProps<{ cost?: MCPServerCostInfo | null }>();
const money = useMoneyFormatter(),
	hasDefault = computed(() => props.cost?.default_cost_per_query != null),
	hasTools = computed(() =>
		Boolean(props.cost?.tool_name_to_cost_per_query && Object.keys(props.cost.tool_name_to_cost_per_query).length),
	);
</script>
<template>
	<div class="tools-mcp-cost-display">
		<div v-if="!hasDefault && !hasTools" class="tools-mcp-cost-unset">
			No cost configuration set for this server. Tool calls will be charged at {{ money(0, 2) }} per tool call.
		</div>
		<template v-else
			><section v-if="hasDefault">
				<strong>Default Cost per Query</strong>
				<p class="tools-mcp-cost-money">{{ money(cost?.default_cost_per_query, 4) }}</p>
			</section>
			<section v-if="hasTools">
				<strong>Tool-Specific Costs</strong
				><template v-for="(price, name) in cost?.tool_name_to_cost_per_query" :key="name"
					><div v-if="price != null" class="tools-mcp-tool-cost">
						<strong>{{ name }}</strong
						><span>{{ money(price, 4) }} per query</span>
					</div></template
				>
			</section>
			<aside>
				<strong>Cost Summary:</strong>
				<p v-if="hasDefault">• Default cost: {{ money(cost?.default_cost_per_query, 4) }} per query</p>
				<p v-if="hasTools">• {{ Object.keys(cost?.tool_name_to_cost_per_query || {}).length }} tool(s) with custom pricing</p>
			</aside></template
		>
	</div>
</template>
