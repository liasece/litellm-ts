<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiSwitch from "../../platform/ui/UiSwitch.vue";
import { computeFloatingPanelPosition, type FloatingPanelPosition } from "../../platform/ui/UiFloatingPanelLogic";
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
const button = ref<HTMLButtonElement>();
const menu = ref<HTMLElement>();
const target = ref<HTMLElement | string>("body");
const position = ref<FloatingPanelPosition>({ top: 0, left: 0 });
const label = computed(() => {
	if (!props.customDate)
		return QUICK_SELECT_OPTIONS.find((item) => item.value === props.selectedInterval.value && item.unit === props.selectedInterval.unit)
			?.label;
	const format = (value: string) =>
		new Date(value).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
	return format(props.startTime) + " - " + format(props.endTime);
});
/**
 * 菜单要渲染到页面容器之外：`.logs-page` 的 overflow-x: hidden 会裁掉向上/向右溢出的浮层。
 * 因此它只能使用视口坐标，并用与表头筛选相同的方式夹在视口内。
 */
function measure() {
	const trigger = button.value;
	if (!trigger) return;
	position.value = computeFloatingPanelPosition(
		trigger.getBoundingClientRect(),
		{ width: menu.value?.offsetWidth ?? 256, height: menu.value?.offsetHeight ?? 0 },
		{ width: window.innerWidth, height: window.innerHeight },
	);
}
function outside(event: MouseEvent) {
	const node = event.target;
	if (!(node instanceof Node)) return;
	if (menuRoot.value?.contains(node) || menu.value?.contains(node)) return;
	open.value = false;
}
function escape(event: KeyboardEvent) {
	if (event.key !== "Escape" || !open.value) return;
	event.stopPropagation();
	open.value = false;
	button.value?.focus();
}
/** 面板使用视口坐标，页面滚动后触发器位置失效，直接收起。 */
function scrolled(event: Event) {
	if (event.target instanceof Node && menu.value?.contains(event.target)) return;
	open.value = false;
}
async function toggle() {
	if (open.value) {
		open.value = false;
		return;
	}
	target.value = button.value?.closest("dialog") ?? document.body;
	open.value = true;
	await nextTick();
	if (!open.value) return;
	measure();
	window.requestAnimationFrame(measure);
	document.addEventListener("pointerdown", outside, true);
	document.addEventListener("keydown", escape, true);
	window.addEventListener("resize", measure);
	document.addEventListener("scroll", scrolled, true);
}
function select(value: number, unit: string) {
	emit("interval", value, unit);
	open.value = false;
}
function inputValue(event: Event) {
	return (event.target as HTMLInputElement).value;
}
watch(open, (value) => {
	if (value) return;
	document.removeEventListener("pointerdown", outside, true);
	document.removeEventListener("keydown", escape, true);
	window.removeEventListener("resize", measure);
	document.removeEventListener("scroll", scrolled, true);
});
onBeforeUnmount(() => {
	open.value = false;
});
</script>
<template>
	<div class="logs-toolbar">
		<div class="logs-toolbar-row">
			<div class="logs-toolbar-options">
				<div ref="menuRoot" class="logs-time-select">
					<button ref="button" type="button" class="logs-native-button logs-time-button" :aria-expanded="open" @click="toggle">
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
					<Teleport :to="target">
						<div
							v-if="open"
							ref="menu"
							class="logs-time-menu"
							:style="{ top: position.top + 'px', left: position.left + 'px' }"
						>
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
							<button
								type="button"
								:class="{ selected: customDate }"
								@click="emit('custom', startTime, endTime, !customDate)"
							>
								Custom Range
							</button>
						</div>
					</Teleport>
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
