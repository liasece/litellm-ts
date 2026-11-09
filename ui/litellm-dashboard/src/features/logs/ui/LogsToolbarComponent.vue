<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiSwitch from "../../platform/ui/UiSwitch.vue";
import { LIVE_TAIL_INTERVAL_OPTIONS, QUICK_SELECT_OPTIONS } from "../support/LogsConstants";
const props = defineProps<{
	startTime: string;
	endTime: string;
	customDate: boolean;
	selectedInterval: { value: number; unit: string };
	liveTailIntervalMs: number;
	liveTailEnabled: boolean;
	fetching: boolean;
}>();
const emit = defineEmits<{
	interval: [value: number, unit: string];
	custom: [start: string, end: string, custom: boolean];
	"live-enabled": [value: boolean];
	"live-interval": [value: number];
	refresh: [];
}>();
const open = ref(false);
const menuRoot = ref<HTMLElement>();
const label = computed(() => {
	if (!props.customDate)
		return QUICK_SELECT_OPTIONS.find((item) => item.value === props.selectedInterval.value && item.unit === props.selectedInterval.unit)
			?.label;
	const format = (value: string) =>
		new Date(value).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
	return format(props.startTime) + " - " + format(props.endTime);
});
function outside(event: MouseEvent) {
	if (event.target instanceof Node && !menuRoot.value?.contains(event.target)) open.value = false;
}
function select(value: number, unit: string) {
	emit("interval", value, unit);
	open.value = false;
}
function inputValue(event: Event) {
	return (event.target as HTMLInputElement).value;
}
onMounted(() => document.addEventListener("mousedown", outside));
onBeforeUnmount(() => document.removeEventListener("mousedown", outside));
</script>
<template>
	<div class="logs-toolbar">
		<div class="logs-toolbar-row">
			<div class="logs-toolbar-options">
				<div ref="menuRoot" class="logs-time-select" @keydown.esc="open = false">
					<button type="button" class="logs-native-button logs-time-button" :aria-expanded="open" @click="open = !open">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
							/>
						</svg>
						{{ label }}
					</button>
					<div v-if="open" class="logs-time-menu">
						<button
							v-for="option in QUICK_SELECT_OPTIONS"
							:key="option.label"
							type="button"
							:class="{ selected: label === option.label }"
							@click="select(option.value, option.unit)"
						>
							{{ option.label }}
						</button>
						<hr />
						<button type="button" :class="{ selected: customDate }" @click="emit('custom', startTime, endTime, !customDate)">
							Custom Range
						</button>
					</div>
				</div>
				<div class="logs-live-switch">
					<span>Live Tail</span
					><UiSwitch label="Live Tail" :model-value="liveTailEnabled" @update:model-value="emit('live-enabled', $event)" />
					<select
						v-if="liveTailEnabled"
						aria-label="Live Tail refresh interval"
						class="logs-native-select logs-live-interval"
						:value="liveTailIntervalMs"
						@change="emit('live-interval', Number(inputValue($event)))"
					>
						<template v-for="option in LIVE_TAIL_INTERVAL_OPTIONS" :key="option.value"
							><option v-if="option.value > 0" :value="option.value">{{ option.label }}</option></template
						>
					</select>
				</div>
				<UiButton title="Fetch data" :disabled="fetching" @click="emit('refresh')"
					><template #icon><UiIcon name="SyncOutlined" :class="{ 'logs-spinning': fetching }" /></template
					>{{ fetching ? "Fetching" : "Fetch" }}</UiButton
				>
			</div>
			<div v-if="customDate" class="logs-custom-date">
				<input
					type="datetime-local"
					aria-label="Start time"
					:value="startTime"
					@change="emit('custom', inputValue($event), endTime, true)"
				/><span>to</span>
				<input
					type="datetime-local"
					aria-label="End time"
					:value="endTime"
					@change="emit('custom', startTime, inputValue($event), true)"
				/>
			</div>
		</div>
	</div>
</template>
