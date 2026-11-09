<script setup lang="ts">
import { computed, ref } from "vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import UiTag from "../../platform/ui/UiTag.vue";
import UiDialog from "../../platform/ui/UiDialog.vue";
import UiAlert from "../../platform/ui/UiAlert.vue";
import UiEmptyState from "../../platform/ui/UiEmptyState.vue";
import type { CliProxyLogEntry } from "../support/CliProxyModels";
import { formatRawLogs, levelColor, presentLog, statusColor, streamColor, type LogLevel } from "../render/LogPresentation";
const props = withDefaults(
	defineProps<{
		entries: CliProxyLogEntry[];
		compact?: boolean;
		refreshing?: boolean;
		canRefresh?: boolean;
		canClear?: boolean;
		canViewAll?: boolean;
	}>(),
	{ compact: false, refreshing: false },
);
const emit = defineEmits<{ refresh: []; clear: []; viewAll: [] }>();
const search = ref("");
const streams = ref<Array<string | number>>([]);
const levels = ref<Array<string | number>>([]);
const rawOpen = ref(false);
const levelOptions = ["info", "debug", "warn", "error"].map((value) => ({ value, label: value.toUpperCase() }));
const sourceOptions = ["stdout", "stderr", "system", "oauth"].map((value) => ({ value, label: value }));
const presented = computed(() => props.entries.map(presentLog));
const counts = computed(() =>
	presented.value.reduce(
		(result, log) => {
			result[log.level]++;
			return result;
		},
		{ info: 0, debug: 0, warn: 0, error: 0 } satisfies Record<LogLevel, number>,
	),
);
const filtered = computed(() => {
	const query = search.value.trim().toLowerCase();
	return presented.value.filter((log) => {
		if (streams.value.length && !streams.value.includes(log.entry.stream)) return false;
		if (levels.value.length && !levels.value.includes(log.level)) return false;
		return (
			!query ||
			log.message.toLowerCase().includes(query) ||
			log.entry.stream.includes(query) ||
			log.method?.toLowerCase().includes(query) ||
			log.path?.toLowerCase().includes(query)
		);
	});
});
const visible = computed(() => filtered.value.slice(props.compact ? -8 : -500));
const date = (value: string) => new Date(value).toLocaleString();
</script>
<template>
	<UiCard appearance="antd" class="cp-card cp-log-viewer" :data-cliproxy-log-viewer="compact ? 'overview' : 'full'">
		<template #title
			><div>
				<div class="cp-inline cp-gap-8">
					<strong>{{ compact ? "Recent activity" : "Runtime logs" }}</strong
					><UiTag color="green">Live</UiTag>
				</div>
				<span class="cp-secondary cp-xs">{{
					compact
						? "Latest subscription process and management events."
						: "Structured view of runtime stdout, stderr, OAuth and LiteLLM management events."
				}}</span>
			</div></template
		>
		<template #extra
			><div class="cp-inline cp-wrap cp-gap-8">
				<UiButton size="small" @click="rawOpen = true"
					><template #icon><UiIcon name="CodeOutlined" /></template>Raw log</UiButton
				><UiButton v-if="canRefresh" size="small" :loading="refreshing" @click="emit('refresh')"
					><template #icon><UiIcon name="ReloadOutlined" /></template>Refresh</UiButton
				><UiButton v-if="compact && canViewAll" size="small" variant="link" @click="emit('viewAll')">View all</UiButton>
			</div></template
		>
		<div v-if="!compact" class="cp-stack cp-gap-16 cp-mb-16">
			<div class="cp-level-grid">
				<div v-for="level in ['info', 'debug', 'warn', 'error'] as const" :key="level" class="cp-level-box cp-between">
					<UiTag :color="levelColor(level)">{{ level.toUpperCase() }}</UiTag
					><strong class="cp-lg">{{ counts[level] }}</strong>
				</div>
			</div>
			<div class="cp-inline cp-wrap cp-gap-8">
				<UiInput v-model="search" clearable placeholder="Search message, method or path" class="cp-log-search"
					><template #prefix><UiIcon name="SearchOutlined" class="cp-search-icon" /></template></UiInput
				><UiSelect
					v-model="streams"
					max-tag-count="responsive"
					multiple
					clearable
					placeholder="Filter source"
					:options="sourceOptions"
					class="cp-log-filter"
				/><UiSelect
					v-model="levels"
					max-tag-count="responsive"
					multiple
					clearable
					placeholder="Filter level"
					:options="levelOptions"
					class="cp-log-filter"
				/><UiButton v-if="canClear" danger @click="emit('clear')"
					><template #icon><UiIcon name="DeleteOutlined" /></template>Clear view</UiButton
				>
			</div>
			<UiAlert v-if="entries.length > 500" :title="'Showing the newest 500 of ' + entries.length + ' buffered entries.'" />
		</div>
		<UiEmptyState
			v-if="visible.length === 0"
			:description="entries.length === 0 ? 'No runtime logs yet.' : 'No logs match the current filters.'"
		/>
		<div v-else class="cp-log-entries" :class="{ 'cp-log-entries--compact': compact }">
			<div
				v-for="log in visible"
				:key="log.entry.id"
				class="cp-log-row"
				:class="['cp-log-row--' + log.level, { 'cp-log-row--compact': compact }]"
				:data-cliproxy-log-row="log.level"
			>
				<span class="cp-secondary cp-xs cp-mono">{{ date(log.entry.timestamp) }}</span>
				<div class="cp-min-width">
					<div class="cp-inline cp-wrap cp-gap-4 cp-mb-4">
						<UiTag :color="levelColor(log.level)">{{ log.level.toUpperCase() }}</UiTag
						><UiTag :color="streamColor(log.entry.stream)">{{ log.entry.stream }}</UiTag
						><UiTag v-if="log.method" color="geekblue">{{ log.method }}</UiTag
						><UiTag v-if="log.status" :color="statusColor(log.status)">{{ log.status }}</UiTag
						><span v-if="log.latency" class="cp-latency cp-xs cp-mono">{{ log.latency }}</span
						><span v-if="log.path" class="cp-log-path-wrapper cp-ellipsis" :title="log.path"
							><code class="cp-log-path">{{ log.path }}</code></span
						>
					</div>
					<span class="cp-log-message cp-xs cp-mono">{{ log.message }}</span>
				</div>
			</div>
		</div>
		<div class="cp-between cp-mt-12 cp-secondary cp-xs">
			<span>{{ filtered.length }} matching / {{ entries.length }} buffered</span
			><span v-if="compact && entries.length > visible.length">Showing newest {{ visible.length }}</span>
		</div>
	</UiCard>
	<UiDialog v-model:open="rawOpen" title="Raw runtime log" scroll-mode="overlay" :width="960" :show-footer="false">
		<pre class="cp-terminal cp-raw-log">{{ formatRawLogs(entries) || "No runtime logs yet." }}</pre>
	</UiDialog>
</template>
