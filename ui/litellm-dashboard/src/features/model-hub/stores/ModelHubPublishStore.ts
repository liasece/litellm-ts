import { computed, shallowReactive } from "vue";
import { modelHubApi } from "../api/ModelHubApi";
import type { HubPublishItem, HubPublishKind } from "../support/ModelHubModels";
import { publishingText } from "../logic/ModelHubPublishLogic";
import { notificationManager } from "../../notifications/logic/NotificationManager";
export function createModelHubPublishStore(kind: HubPublishKind, items: () => HubPublishItem[], close: () => void, success: () => void) {
	const state = shallowReactive({ step: 0, selected: new Set<string>(), loading: false }),
		text = publishingText[kind];
	let controller: AbortController | undefined,
		disposed = false;
	const selected = computed(() =>
		[...state.selected].map(
			(id) => items().find((item) => item.id === id) ?? { id, name: id, public: false, description: "", badges: [] },
		),
	);
	function reset() {
		state.step = 0;
		state.selected = new Set();
		close();
	}
	function initialize() {
		state.selected = new Set(
			items()
				.filter((item) => item.public)
				.map((item) => item.id),
		);
	}
	function toggle(id: string, checked: boolean) {
		const next = new Set(state.selected);
		if (checked) next.add(id);
		else next.delete(id);
		state.selected = next;
	}
	function selectAll(rows: HubPublishItem[], checked: boolean) {
		state.selected = new Set(checked ? rows.map((item) => item.id) : []);
	}
	function next() {
		if (!state.selected.size) {
			notificationManager.fromBackend("Please select at least one " + text.singular + " to make public");
			return;
		}
		state.step = 1;
	}
	async function submit() {
		if (!state.selected.size) {
			next();
			return;
		}
		if (state.loading) return;
		const ids = [...state.selected];
		controller = new AbortController();
		state.loading = true;
		try {
			await modelHubApi.publish(kind, ids, controller.signal);
			if (disposed) return;
			notificationManager.success("Successfully made " + ids.length + " " + text.success + " public!");
			reset();
			success();
		} catch {
			if (!disposed) notificationManager.fromBackend("Failed to make " + text.noun + " public. Please try again.");
		} finally {
			if (!disposed) state.loading = false;
		}
	}
	function dispose() {
		disposed = true;
		controller?.abort();
	}
	return { state, text, selected, initialize, toggle, selectAll, next, submit, reset, dispose };
}
