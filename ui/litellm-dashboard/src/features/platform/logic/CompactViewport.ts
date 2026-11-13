import { onBeforeUnmount, onMounted, ref, type Ref } from "vue";

/** 手机断点，与样式表里的 `max-width: 767px` 保持一致。 */
export const COMPACT_VIEWPORT_QUERY = "(max-width: 767px)";

/**
 * 跟踪视口是否处在手机布局。
 *
 * 只用于 CSS 表达不了的差异，例如把宽表换成卡片、隐藏触屏无意义的键盘提示；
 * 屏幕旋转或窗口缩放时会同步，`matchMedia` 不可用时保持 `false`。
 */
export function useCompactViewport(query: string = COMPACT_VIEWPORT_QUERY): Ref<boolean> {
	const compact = ref(false);
	let media: MediaQueryList | undefined;

	function sync(): void {
		compact.value = Boolean(media?.matches);
	}

	onMounted(() => {
		if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
		media = window.matchMedia(query);
		sync();
		media.addEventListener("change", sync);
	});

	onBeforeUnmount(() => media?.removeEventListener("change", sync));

	return compact;
}
