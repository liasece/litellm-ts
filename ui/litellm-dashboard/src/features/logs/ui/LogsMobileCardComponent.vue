<script setup lang="ts">
import { computed } from "vue";
import ModelName from "../../providers/ui/ModelNameComponent.vue";
import ProviderLogoComponent from "../../providers/ui/ProviderLogoComponent.vue";
import UiTag from "../../platform/ui/UiTag.vue";
import { useMoneyFormatter } from "../../platform/stores/PriceDisplayStore";
import { isInProgressLog, sessionGroupRef } from "../logic/LogsIdentityLogic";
import {
	durationMs,
	localLogTime,
	logStatus,
	modelIdentity,
	outputTps,
	tokenDataPending,
	tokenMetrics,
	ttftMs,
} from "../logic/LogsPresentationLogic";
import { useLiveDurationClock } from "../stores/LiveDurationClock";
import type { LogEntry, SessionGroupRef } from "../support/LogsModels";
import type { LogsColumn } from "../support/LogsColumnModels";
import LogsTypeBadgeComponent from "./LogsTypeBadgeComponent.vue";
const props = defineProps<{ log: LogEntry; columns: readonly LogsColumn[] }>();
const emit = defineEmits<{ select: [log: LogEntry]; key: [hash: string]; session: [group: SessionGroupRef] }>();
const money = useMoneyFormatter();
const now = useLiveDurationClock();
const priceIdentity = computed(() => ({ model_id: props.log.model_id ?? undefined, model: props.log.model ?? undefined }));
const status = computed(() => logStatus(props.log));
const statusLabel = computed(() =>
	status.value === "in_progress"
		? "In Progress"
		: status.value === "aborted"
			? "Aborted"
			: status.value === "failure"
				? "Failure"
				: "Success",
);
const group = computed(() => sessionGroupRef(props.log));
const model = computed(() => modelIdentity(props.log));
const tokens = computed(() => tokenMetrics(props.log));
const pendingTokens = computed(() => tokenDataPending(props.log));
const ttft = computed(() => ttftMs(props.log));
const tps = computed(() => outputTps(props.log));
const isLive = computed(() => isInProgressLog(props.log) && props.log.request_duration_ms == null);
const duration = computed(() => {
	if (props.log.request_duration_ms != null) return (props.log.request_duration_ms / 1000).toFixed(2) + "s";
	if (!isLive.value) return "-";
	return (durationMs(props.log.startTime, null, now.value) / 1000).toFixed(2) + "s";
});
const cost = computed(() => money(props.log.spend || null, 4, priceIdentity.value));
const costTitle = computed(() => money(props.log.spend || null, 8, priceIdentity.value));
const stamp = computed(() => {
	const date = new Date(props.log.startTime);
	if (Number.isNaN(date.getTime())) return localLogTime(props.log.startTime);
	return date
		.toLocaleString("en-US", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
		.replace(",", "");
});
const showType = computed(() => props.columns.some((column) => column.id === "call_type"));
const keyHash = computed(() => String(props.log.metadata?.user_api_key || ""));
const alias = computed(() => String(props.log.metadata?.user_api_key_alias || ""));
const extraFields = computed(() => {
	const fields: { key: string; label: string; value: string; link?: "key" }[] = [];
	for (const column of props.columns) {
		if (column.id === "team_name")
			fields.push({ key: column.id, label: "Team", value: String(props.log.metadata?.user_api_key_team_alias || "-") });
		if (column.id === "key_name") fields.push({ key: column.id, label: "Key", value: alias.value || "-", link: "key" });
		if (column.id === "key_hash") fields.push({ key: column.id, label: "Key hash", value: keyHash.value || "-", link: "key" });
		if (column.id === "user") fields.push({ key: column.id, label: "User", value: String(props.log.user || "-") });
		if (column.id === "end_user") fields.push({ key: column.id, label: "End user", value: String(props.log.end_user || "-") });
		if (column.id === "request_tags") {
			const tags = Object.entries(props.log.request_tags ?? {});
			fields.push({
				key: column.id,
				label: "Tags",
				value: tags.length ? tags.map(([key, value]) => key + ": " + String(value)).join(", ") : "-",
			});
		}
	}
	return fields;
});
function openKey(): void {
	if (keyHash.value) emit("key", keyHash.value);
}
</script>
<template>
	<article
		class="logs-mcard"
		tabindex="0"
		role="button"
		:aria-label="'Log ' + (log.request_id || '') + ' ' + statusLabel"
		@click="emit('select', log)"
		@keydown.enter.self.prevent="emit('select', log)"
		@keydown.space.self.prevent="emit('select', log)"
	>
		<div class="logs-mcard__head">
			<time class="logs-mcard__time logs-mono" :datetime="log.startTime" :title="localLogTime(log.startTime)">{{ stamp }}</time>
			<span class="logs-status" :class="'logs-status-' + status">{{ statusLabel }}</span>
			<span class="logs-mcard__cost logs-mono" :title="costTitle">{{ cost }}</span>
		</div>
		<div class="logs-mcard__model" :title="model.executed || model.displayName">
			<ProviderLogoComponent v-if="model.toolLogo" :provider="model.displayName" :logo="model.toolLogo" />
			<UiTag v-if="model.builtin" color="purple" class="logs-mcard__builtin">Built-in · {{ model.builtin }}</UiTag>
			<ModelName
				:model="model.executed"
				:family="model.family"
				:provider="model.provider"
				:size="16"
				:show-icon="!model.toolLogo"
				class="logs-mcard__model-name"
			>
				<span class="logs-mcard__model-text">{{ model.displayName }}</span>
			</ModelName>
			<span v-if="model.fallback > 0" class="logs-model-fallback">({{ model.fallback }})</span>
			<LogsTypeBadgeComponent v-if="showType" class="logs-mcard__type" :call-type="log.call_type" :count="log.session_total_count" />
		</div>
		<div class="logs-mcard__metrics">
			<div class="logs-mcard__stat">
				<span class="logs-mcard__stat-label">Duration</span>
				<span class="logs-mcard__stat-value logs-mono">{{ duration }}</span>
			</div>
			<div class="logs-mcard__stat">
				<span class="logs-mcard__stat-label">TTFT</span>
				<span class="logs-mcard__stat-value logs-mono">{{ ttft == null ? "-" : (ttft / 1000).toFixed(2) + "s" }}</span>
			</div>
			<div class="logs-mcard__stat">
				<span class="logs-mcard__stat-label">Out TPS</span>
				<span class="logs-mcard__stat-value logs-mono">{{ tps && tps !== "-" ? tps.value.toFixed(1) : "-" }}</span>
			</div>
			<div class="logs-mcard__stat">
				<span class="logs-mcard__stat-label">Tokens in / out</span>
				<span class="logs-mcard__stat-value logs-mono">{{
					pendingTokens
						? "-"
						: (tokens.cacheRead + tokens.input).toLocaleString("en-US") + " / " + tokens.output.toLocaleString("en-US")
				}}</span>
			</div>
		</div>
		<div v-if="group || log.request_id" class="logs-mcard__ids">
			<button v-if="group" type="button" class="logs-mcard__id" :title="group.id" @click.stop="emit('session', group)">
				<span class="logs-mcard__id-label">Session</span><span class="logs-mono logs-mcard__id-value">{{ group.id }}</span>
			</button>
			<button v-if="log.request_id" type="button" class="logs-mcard__id" :title="log.request_id" @click.stop="emit('select', log)">
				<span class="logs-mcard__id-label">Request</span><span class="logs-mono logs-mcard__id-value">{{ log.request_id }}</span>
			</button>
		</div>
		<div v-if="extraFields.length" class="logs-mcard__fields">
			<div v-for="field in extraFields" :key="field.key" class="logs-mcard__field">
				<span class="logs-mcard__field-label">{{ field.label }}</span>
				<button
					v-if="field.link"
					type="button"
					class="logs-mcard__field-value logs-mcard__field-value--link"
					:title="field.value"
					@click.stop="openKey"
				>
					{{ field.value }}
				</button>
				<span v-else class="logs-mcard__field-value" :title="field.value">{{ field.value }}</span>
			</div>
		</div>
	</article>
</template>
