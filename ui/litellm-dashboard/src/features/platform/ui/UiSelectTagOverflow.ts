import { nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from "vue";

/** Measure the rendered tag, remainder and search nodes rather than estimating label widths. */
export function useSelectTagOverflow({
	enabled,
	revision,
	container,
	measurements,
	onResize,
}: {
	enabled: () => boolean;
	revision: () => unknown;
	container: Ref<HTMLElement | undefined>;
	measurements: Ref<HTMLElement | undefined>;
	onResize: () => void;
}) {
	const visibleCount = ref(Number.MAX_SAFE_INTEGER);
	const searchWidth = ref(4);
	const tagMaxWidth = ref<number>();
	let observer: ResizeObserver | undefined;
	let frame = 0;
	let mounted = false;
	let observed = new Set<Element>();

	function measure() {
		frame = 0;
		if (!mounted || !enabled() || !container.value || !measurements.value) return;
		const available = container.value.getBoundingClientRect().width;
		if (!available) return;
		onResize();
		const tags = Array.from(measurements.value.querySelectorAll<HTMLElement>("[data-select-tag-measure]"));
		const remainders = Array.from(measurements.value.querySelectorAll<HTMLElement>("[data-select-rest-measure]"));
		const mirror = measurements.value.querySelector<HTMLElement>("[data-select-search-measure]");
		if (!mirror) return;
		const suffix = Math.min(available, mirror.getBoundingClientRect().width);
		searchWidth.value = suffix;
		const gap = Number.parseFloat(getComputedStyle(container.value).columnGap) || 0;
		const editor = container.value.querySelector<HTMLInputElement>(".ui-select__input");
		const caret = editor ? Number.parseFloat(getComputedStyle(editor).minWidth) || 0 : 0;
		tagMaxWidth.value = Math.max(0, available - gap - caret);
		const widths = tags.map((tag) => tag.getBoundingClientRect().width);
		let total = widths.reduce((sum, width) => sum + width, 0);
		if (total + suffix + gap * widths.length <= available) {
			visibleCount.value = widths.length;
			return;
		}
		for (let count = widths.length - 1; count >= 0; count--) {
			total -= widths[count];
			const rest = remainders[widths.length - count - 1]?.getBoundingClientRect().width ?? 0;
			if (total + rest + suffix + gap * (count + 1) <= available || count === 0) {
				visibleCount.value = count;
				return;
			}
		}
		visibleCount.value = 0;
	}
	function schedule() {
		if (mounted && !frame) frame = requestAnimationFrame(measure);
	}
	function observe() {
		if (!mounted) return;
		if (!enabled()) {
			observer?.disconnect();
			observed.clear();
			visibleCount.value = Number.MAX_SAFE_INTEGER;
			searchWidth.value = 4;
			tagMaxWidth.value = undefined;
			return;
		}
		const nodes = new Set<Element>([
			...(container.value ? [container.value] : []),
			...(measurements.value ? Array.from(measurements.value.children) : []),
		]);
		for (const node of observed) if (!nodes.has(node)) observer?.unobserve(node);
		for (const node of nodes) if (!observed.has(node)) observer?.observe(node);
		observed = nodes;
		schedule();
	}
	watch([enabled, revision, container, measurements], () => void nextTick(observe), { deep: true, flush: "post" });
	onMounted(() => {
		mounted = true;
		observer = new ResizeObserver(schedule);
		observe();
		void document.fonts.ready.then(schedule);
	});
	onBeforeUnmount(() => {
		mounted = false;
		observer?.disconnect();
		if (frame) cancelAnimationFrame(frame);
	});
	return { visibleCount, searchWidth, tagMaxWidth };
}
