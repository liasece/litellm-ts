import { nextTick, onBeforeUnmount, onMounted, watch, type Ref } from "vue";

const activeDialogs = new Set<HTMLDialogElement>();
let previousBodyOverflow = "";
let previousBodyPadding = "";

function lockBackground(dialog: HTMLDialogElement) {
	if (activeDialogs.size === 0) {
		previousBodyOverflow = document.body.style.overflow;
		previousBodyPadding = document.body.style.paddingRight;
		const gutter = window.innerWidth - document.documentElement.clientWidth;
		if (gutter > 0) document.body.style.paddingRight = parseFloat(getComputedStyle(document.body).paddingRight) + gutter + "px";
		document.body.style.overflow = "hidden";
	}
	activeDialogs.add(dialog);
}
function unlockBackground(dialog: HTMLDialogElement) {
	activeDialogs.delete(dialog);
	if (activeDialogs.size === 0) {
		document.body.style.overflow = previousBodyOverflow;
		document.body.style.paddingRight = previousBodyPadding;
	}
}

export function useOverlayDialog(
	element: Ref<HTMLDialogElement | undefined>,
	isOpen: () => boolean,
	close: () => void,
	opened?: (dialog: HTMLDialogElement) => void,
) {
	let previouslyFocused: HTMLElement | null = null;
	async function reconcile() {
		await nextTick();
		const dialog = element.value;
		if (!dialog) return;
		if (isOpen() && !dialog.open) {
			previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
			lockBackground(dialog);
			dialog.showModal();
			opened?.(dialog);
		} else if (!isOpen() && dialog.open) {
			dialog.close();
			unlockBackground(dialog);
			if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true });
		}
	}
	function cancel(event: Event) {
		event.preventDefault();
		close();
	}
	onMounted(() => {
		void reconcile();
	});
	watch(isOpen, () => {
		void reconcile();
	});
	onBeforeUnmount(() => {
		const dialog = element.value;
		if (dialog) {
			dialog.close();
			if (activeDialogs.has(dialog)) unlockBackground(dialog);
		}
		if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true });
	});
	return { cancel };
}
