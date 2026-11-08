import { reactive } from "vue";
import { claudeCodeNudgeApi } from "../api/ClaudeCodeNudgeApi";
export function createClaudeCodeNudgeStore(disable: () => void, load = claudeCodeNudgeApi.enabled) {
	const state = reactive({ visible: false, modalOpen: false, confirmation: false, progress: 100 });
	let dismissTimer: ReturnType<typeof setTimeout> | undefined,
		confirmationTimer: ReturnType<typeof setTimeout> | undefined,
		progressTimer: ReturnType<typeof setInterval> | undefined,
		controller: AbortController | undefined,
		generation = 0;
	function stopTimers() {
		clearTimeout(dismissTimer);
		clearTimeout(confirmationTimer);
		clearInterval(progressTimer);
	}
	function dismiss() {
		stopTimers();
		state.visible = false;
		state.confirmation = false;
		state.progress = 100;
	}
	function show() {
		stopTimers();
		state.visible = true;
		state.confirmation = false;
		state.progress = 100;
		const started = Date.now();
		progressTimer = setInterval(() => {
			state.progress = Math.max(0, 100 - ((Date.now() - started) / 15000) * 100);
			if (state.progress <= 0) clearInterval(progressTimer);
		}, 50);
		dismissTimer = setTimeout(dismiss, 15000);
	}
	async function initialize(authorized: boolean) {
		const current = ++generation;
		controller?.abort();
		controller = new AbortController();
		if (!authorized) {
			dismiss();
			state.modalOpen = false;
			return;
		}
		try {
			const enabled = await load(controller.signal);
			if (current === generation && enabled) show();
		} catch {
			/* The original shell silently omits unavailable in-product nudges. */
		}
	}
	function open() {
		dismiss();
		state.modalOpen = true;
	}
	function close() {
		state.modalOpen = false;
		show();
	}
	function complete() {
		state.modalOpen = false;
	}
	function dontAskAgain() {
		disable();
		state.confirmation = true;
		clearTimeout(confirmationTimer);
		confirmationTimer = setTimeout(dismiss, 5000);
	}
	function dispose() {
		generation++;
		controller?.abort();
		stopTimers();
	}
	return { state, initialize, dismiss, open, close, complete, dontAskAgain, dispose };
}
