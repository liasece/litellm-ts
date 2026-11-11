<script setup lang="ts">
import { computed } from "vue";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import UiPopover from "../../platform/ui/UiPopover.vue";
import UiTag from "../../platform/ui/UiTag.vue";
import UiLucideIcon from "../../platform/ui/UiLucideIcon.vue";
import ProviderLogoComponent from "../../providers/ui/ProviderLogoComponent.vue";
import ModelName from "../../providers/ui/ModelNameComponent.vue";
import { getProviderLogoAndName } from "../../providers/logic/ProviderIdentityLogic";
import { useMoneyFormatter } from "../../platform/stores/PriceDisplayStore";
import {
	buildModelResolutionLines,
	localLogTime,
	logStatus,
	modelIdentity,
	outputTps,
	record,
	tokenCostBreakdown,
	tokenDataPending,
	tokenMetrics,
	ttftMs,
} from "../logic/LogsPresentationLogic";
import { isInProgressLog, sessionGroupRef } from "../logic/LogsIdentityLogic";
import type { LogEntry, SessionGroupRef } from "../support/LogsModels";
import LogsMetricComponent from "./LogsMetricComponent.vue";
import LogsLiveDurationComponent from "./LogsLiveDurationComponent.vue";
import LogsTypeBadgeComponent from "./LogsTypeBadgeComponent.vue";
const props = defineProps<{ log: LogEntry; column: string; live: boolean }>();
const emit = defineEmits<{ key: [hash: string]; session: [group: SessionGroupRef] }>();
const money = useMoneyFormatter();
const priceIdentity = computed(() => ({ model_id: props.log.model_id ?? undefined, model: props.log.model ?? undefined }));
const status = computed(() => logStatus(props.log));
const group = computed(() => sessionGroupRef(props.log));
const costs = computed(() => tokenCostBreakdown(props.log));
const model = computed(() => modelIdentity(props.log));
const tokens = computed(() => tokenMetrics(props.log));
const pendingTokens = computed(() => tokenDataPending(props.log));
const ttft = computed(() => ttftMs(props.log));
const tps = computed(() => outputTps(props.log));
const route = computed(() =>
	buildModelResolutionLines(props.log.metadata?.fallback_models, props.log.metadata?.model_resolution_chain, model.value.executed),
);
const tags = computed(() => Object.entries(record(props.log.request_tags)));
const fallbackText = computed(() =>
	props.column === "team_name" ? String(props.log.metadata?.user_api_key_team_alias || "-") : String(props.log[props.column] || "-"),
);
const hash = computed(() => String(props.log.metadata?.user_api_key || ""));
const alias = computed(() => String(props.log.metadata?.user_api_key_alias || "-"));
const tokenTooltip = computed(
	() =>
		"Cache read + input / output" +
		(tokens.value.creation > 0 ? "\nCache creation: " + tokens.value.creation.toLocaleString("en-US") + " (included in input)" : ""),
);
const costFields = computed(() => [
	{ label: "缓存输入", value: costs.value.cacheInputCost, icon: "Database" },
	{ label: "输入", value: costs.value.inputCost, icon: "ArrowDownToLine" },
	{ label: "输出", value: costs.value.outputCost, icon: "ArrowUpFromLine" },
]);
</script>
<template>
	<span v-if="column === 'startTime'" class="logs-time-cell">{{ localLogTime(log.startTime) }}</span>
	<LogsTypeBadgeComponent v-else-if="column === 'call_type'" :call-type="log.call_type" :count="log.session_total_count" />
	<span v-else-if="column === 'status'" class="logs-status" :class="'logs-status-' + status">{{
		status === "in_progress" ? "In Progress" : status === "aborted" ? "Aborted" : status === "failure" ? "Failure" : "Success"
	}}</span>
	<template v-else-if="column === 'session_id'">
		<UiTooltip v-if="group" :content="group.id"
			><a
				class="logs-link logs-mono logs-truncate"
				style="max-width: 24ch; font-size: 12px; line-height: 16px"
				:href="'#session-' + encodeURIComponent(group.type + '\0' + group.id)"
				@click.prevent.stop="emit('session', group)"
				>{{ group.id }}</a
			></UiTooltip
		><span v-else>-</span>
	</template>
	<template v-else-if="column === 'request_id'"
		><UiTooltip :content="log.request_id || '-'"
			><span class="logs-truncate logs-mono" style="max-width: 22ch; font-size: 12px; line-height: 16px">{{
				log.request_id || "-"
			}}</span></UiTooltip
		></template
	>
	<div v-else-if="column === 'spend'" style="display: flex; flex-direction: column">
		<UiPopover placement="bottomLeft" popup-class="logs-cost-popover-shell">
			<span class="logs-cost-value logs-mono">{{ money(log.spend || null, 6, priceIdentity) }}</span>
			<template #content>
				<div class="logs-cost-popover-title">
					<span><UiLucideIcon name="CircleDollarSign" :size="16" style="color: #059669" />费用明细</span
					><span class="logs-mono" style="font-size: 12px; font-weight: 600; color: #475569">{{
						money(log.spend || null, 6, priceIdentity)
					}}</span>
				</div>
				<div class="logs-cost-popover" aria-label="Cost breakdown">
					<div v-for="field in costFields" :key="field.label" class="logs-cost-field">
						<div class="logs-field-label" style="display: flex; align-items: center; gap: 4px">
							<UiLucideIcon :name="field.icon" :size="14" />{{ field.label }}
						</div>
						<div class="logs-field-value">{{ money(field.value, 8, priceIdentity) }}</div>
					</div>
				</div>
			</template>
		</UiPopover>
		<span v-if="(log.mcp_tool_call_count || 0) > 0 && (log.mcp_tool_call_spend || 0) > 0" class="logs-cost-extra"
			>incl. {{ money(log.mcp_tool_call_spend || null, 6, priceIdentity) }} from {{ log.mcp_tool_call_count }} MCP</span
		>
	</div>
	<template v-else-if="column === 'request_duration_ms'">
		<LogsLiveDurationComponent
			v-if="live && isInProgressLog(log)"
			:start-time="log.startTime"
			:server-duration="log.request_duration_ms"
		/>
		<LogsMetricComponent
			v-else-if="log.request_duration_ms != null"
			:value="log.request_duration_ms / 1000"
			:max-value="30"
			:display="(log.request_duration_ms / 1000).toFixed(2)"
			:tooltip="log.request_duration_ms + 'ms'"
			:label="'Duration ' + (log.request_duration_ms / 1000).toFixed(2) + ' seconds'"
			test-id="duration-progress"
		/><span v-else>-</span>
	</template>
	<template v-else-if="column === 'completionStartTime'"
		><LogsMetricComponent
			v-if="ttft != null"
			:value="ttft / 1000"
			:max-value="10"
			:display="(ttft / 1000).toFixed(2)"
			:tooltip="ttft + 'ms'"
			:label="'TTFT ' + (ttft / 1000).toFixed(2) + ' seconds'"
			test-id="ttft-progress"
		/><span v-else>-</span></template
	>
	<template v-else-if="column === 'key_hash'"
		><UiTooltip :content="hash || '-'"
			><span
				class="logs-key-link logs-truncate logs-mono"
				style="font-size: 12px; line-height: 16px"
				@click="hash && emit('key', hash)"
				>{{ hash || "-" }}</span
			></UiTooltip
		></template
	>
	<template v-else-if="column === 'key_name'"
		><UiTooltip :content="alias"
			><span class="logs-key-link logs-truncate" @click="hash && emit('key', hash)">{{ alias }}</span></UiTooltip
		></template
	>
	<div v-else-if="column === 'model'" class="logs-model">
		<ProviderLogoComponent v-if="model.toolLogo" :provider="model.displayName" :logo="model.toolLogo" />
		<UiTag v-if="model.builtin" color="purple" style="margin: 0; flex-shrink: 0">Built-in · {{ model.builtin }}</UiTag>
		<UiPopover placement="bottomLeft" popup-class="logs-model-popover-shell">
			<ModelName
				class="logs-model-name"
				:model="model.executed"
				:family="model.family"
				:provider="model.provider"
				:size="16"
				:show-icon="!model.toolLogo"
				><span class="logs-model-name__text">{{ model.displayName }}</span
				><span v-if="model.fallback > 0" class="logs-model-fallback">({{ model.fallback }})</span></ModelName
			>
			<template #content>
				<div class="logs-model-popover-title">
					<span><UiLucideIcon name="GitBranch" :size="16" style="color: #2563eb" />模型路由信息</span>
				</div>
				<div class="logs-model-popover" aria-label="Model information">
					<div class="logs-model-summary">
						<div>
							<div class="logs-field-label">Provider</div>
							<div class="logs-field-value logs-field-value--icon">
								<ProviderLogoComponent
									v-if="model.provider"
									:provider="model.provider"
									:logo="getProviderLogoAndName(model.provider).logo"
									image-class="logs-route-logo"
									fallback-class="logs-route-logo"
								/><span>{{ model.provider || log.custom_llm_provider || "-" }}</span>
							</div>
						</div>
						<div>
							<div class="logs-field-label">Model</div>
							<div class="logs-field-value logs-field-value--icon">
								<ModelName
									:model="model.executed"
									:name="model.displayName"
									:family="model.family"
									:provider="model.provider"
									:size="16"
								/>
							</div>
						</div>
					</div>
					<div v-if="route.length" class="logs-route-lines">
						<div v-for="(line, index) in route" :key="index" class="logs-route-line">
							<span class="logs-field-label">{{ line.label }}</span>
							<div class="logs-route-model">
								<template v-for="(name, i) in line.path" :key="i"
									><span v-if="i" style="margin: 0 8px; color: #94a3b8">→</span>
									<ModelName
										:model="name"
										:family="line.label === 'Executed' ? model.family : undefined"
										:provider="line.label === 'Executed' ? model.provider : undefined"
										:size="16"
								/></template>
							</div>
						</div>
					</div>
				</div>
			</template>
		</UiPopover>
	</div>
	<template v-else-if="column === 'total_tokens'">
		<UiTooltip v-if="pendingTokens" :content="'请求进行中，暂无 token 数据'"
			><span class="logs-tokens logs-mono" data-testid="tokens-pending">-</span></UiTooltip
		>
		<UiTooltip v-else :content="tokenTooltip"
			><span
				class="logs-tokens logs-mono"
				:aria-label="'Cache read ' + tokens.cacheRead + ', input ' + tokens.input + ', output ' + tokens.output"
				data-testid="tokens-three-column"
			>
				<LogsMetricComponent
					:value="tokens.cacheRead"
					:max-value="600000"
					color="green"
					:label="'Cache read ' + tokens.cacheRead + ' tokens'"
					test-id="cache-tokens-progress"
					><UiLucideIcon name="Database" :size="12" />{{ tokens.cacheRead.toLocaleString("en-US") }}</LogsMetricComponent
				>
				<LogsMetricComponent
					:value="tokens.input"
					:max-value="20000"
					color="green"
					:label="'Input ' + tokens.input + ' tokens'"
					test-id="input-tokens-progress"
					><UiLucideIcon name="ArrowDownToLine" :size="12" />{{ tokens.input.toLocaleString("en-US") }}</LogsMetricComponent
				>
				<LogsMetricComponent
					:value="tokens.output"
					:max-value="2000"
					color="green"
					:label="'Output ' + tokens.output + ' tokens'"
					test-id="output-tokens-progress"
					><UiLucideIcon name="ArrowUpFromLine" :size="12" />{{ tokens.output.toLocaleString("en-US") }}</LogsMetricComponent
				>
			</span></UiTooltip
		>
	</template>
	<template v-else-if="column === 'output_tps'"
		><span v-if="tps === '-'">-</span
		><LogsMetricComponent
			v-else-if="tps"
			:value="tps.value"
			:max-value="200"
			color="blue"
			:label="'Output TPS ' + tps.value.toFixed(1)"
			:display="tps.value.toFixed(1)"
			:tooltip="tps.tokens + ' tokens / ' + tps.duration.toFixed(2) + 's'"
			test-id="output-tps-progress"
	/></template>
	<template v-else-if="column === 'request_tags'"
		><UiTooltip v-if="tags.length" :content="tags.map(([key, value]) => key + ': ' + String(value)).join('\n')"
			><span class="logs-tag-summary"
				>{{ tags[0][0] }}: {{ String(tags[0][1]) }}{{ tags.length > 1 ? " +" + (tags.length - 1) : "" }}</span
			></UiTooltip
		><span v-else>-</span></template
	>
	<UiTooltip v-else :content="fallbackText"
		><span class="logs-truncate">{{ fallbackText }}</span></UiTooltip
	>
</template>
<style>
.logs-route-logo {
	display: inline-block !important;
	width: 14px !important;
	height: 14px !important;
	vertical-align: -2px;
	margin-right: 4px;
	font-size: 10px;
	line-height: 14px;
}
</style>
