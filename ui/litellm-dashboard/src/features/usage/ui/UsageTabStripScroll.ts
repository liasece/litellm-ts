import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from "vue";

/** 渐隐宽度，与 UsageRootStyles 里 `.usage-tab-strip` 的 mask 计算保持一致。 */
const FADE = 26;
/* 预留比渐隐更宽的余量，激活的 tab 不会停在渐隐区里。 */
const EDGE = FADE + 4;

/**
 * 手机端标签条：标签超出一屏时用两侧渐隐提示“后面还有内容”，切换标签后把当前标签滚进可视区。
 * 只测量 DOM，不改变标签语义；桌面端标签通常不溢出，两侧渐隐宽度为 0。
 * 滚动容器就是传入的根元素（同一元素上做横向滚动与渐隐）。
 */
export function useTabStripScroll(root: Ref<HTMLElement | undefined>, activeKey: () => string) {
	const fadeStart = ref(0),
		fadeEnd = ref(0);
	let observer: ResizeObserver | undefined,
		frame = 0,
		disposed = false;

	function measure() {
		frame = 0;
		const element = root.value;
		if (disposed || !element) return;
		const max = element.scrollWidth - element.clientWidth;
		if (max <= 2) {
			fadeStart.value = 0;
			fadeEnd.value = 0;
			return;
		}
		fadeStart.value = element.scrollLeft > 2 ? FADE : 0;
		fadeEnd.value = element.scrollLeft < max - 2 ? FADE : 0;
	}
	function schedule() {
		if (!frame && !disposed) frame = requestAnimationFrame(measure);
	}
	function reveal() {
		const element = root.value;
		if (!element) return;
		const tab = element.querySelector<HTMLElement>('[aria-selected="true"]');
		if (!tab) return;
		if (element.scrollWidth - element.clientWidth <= 2) return;
		const bounds = element.getBoundingClientRect(),
			target = tab.getBoundingClientRect();
		const offset = target.left - bounds.left,
			/* 两侧渐隐区域也算“看不见”，激活的 tab 要整块落在中间的安全区里。 */
			leftGuard = element.scrollLeft > 2 ? FADE + 4 : 0,
			rightGuard = element.clientWidth - FADE - 4;
		if (offset < leftGuard) element.scrollLeft = Math.max(0, element.scrollLeft + offset - leftGuard - EDGE);
		else if (offset + target.width > rightGuard) element.scrollLeft = element.scrollLeft + offset + target.width - rightGuard + EDGE;
		schedule();
	}
	function observe() {
		observer?.disconnect();
		if (!observer || !root.value) return;
		observer.observe(root.value);
		const tabs = root.value.querySelector(".ui-tabs");
		if (tabs) observer.observe(tabs);
	}
	function sync() {
		observe();
		reveal();
		schedule();
	}
	watch([root, () => activeKey()], () => void nextTick(sync));
	onMounted(() => {
		observer = new ResizeObserver(schedule);
		root.value?.addEventListener("scroll", schedule, { passive: true });
		sync();
		void document.fonts?.ready.then(schedule);
	});
	onBeforeUnmount(() => {
		disposed = true;
		if (frame) cancelAnimationFrame(frame);
		root.value?.removeEventListener("scroll", schedule);
		observer?.disconnect();
	});
	const fadeStyle = computed(() => ({
		"--usage-tab-fade-start": fadeStart.value + "px",
		"--usage-tab-fade-end": fadeEnd.value + "px",
	}));
	return { fadeStart, fadeEnd, fadeStyle };
}
