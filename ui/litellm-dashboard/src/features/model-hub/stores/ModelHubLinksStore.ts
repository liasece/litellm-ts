import { reactive } from "vue";
import { modelHubApi } from "../api/ModelHubApi";
import { moveHubLink, parseHubLinks, serializeHubLinks, validateHubLink } from "../logic/ModelHubLinksLogic";
import type { HubLink } from "../support/ModelHubModels";
import { notificationManager } from "../../notifications/logic/NotificationManager";
export function createModelHubLinksStore() {
	const state = reactive({
		links: [] as HubLink[],
		draft: { displayName: "", url: "" },
		editing: null as HubLink | null,
		loading: false,
		expanded: true,
		rearranging: false,
		original: [] as HubLink[],
	});
	const controller = new AbortController();
	let disposed = false;
	async function load() {
		state.loading = true;
		try {
			const info = await modelHubApi.info(controller.signal);
			if (!disposed) state.links = parseHubLinks(info.useful_links);
		} catch {
			if (!disposed) state.links = [];
		} finally {
			if (!disposed) state.loading = false;
		}
	}
	async function save(links: HubLink[]) {
		try {
			await modelHubApi.saveLinks(serializeHubLinks(links), controller.signal);
			return !disposed;
		} catch (error) {
			if (!disposed) notificationManager.fromBackend("Failed to save links - " + String(error));
			return false;
		}
	}
	function valid(link: Pick<HubLink, "displayName" | "url">, exclude?: string) {
		const error = validateHubLink(link, state.links, exclude);
		if (error) notificationManager.fromBackend(error);
		return !error;
	}
	async function add() {
		if (!state.draft.displayName || !state.draft.url || !valid(state.draft)) return;
		const next = [...state.links, { ...state.draft, id: Date.now() + "-" + state.draft.displayName }];
		if (await save(next)) {
			state.links = next;
			state.draft = { displayName: "", url: "" };
			notificationManager.success("Link added successfully");
		}
	}
	function edit(link: HubLink) {
		state.editing = { ...link };
	}
	async function update() {
		const editing = state.editing;
		if (!editing || !valid(editing, editing.id)) return;
		const next = state.links.map((link) => (link.id === editing.id ? editing : link));
		if (await save(next)) {
			state.links = next;
			state.editing = null;
			notificationManager.success("Link updated successfully");
		}
	}
	async function remove(id: string) {
		const next = state.links.filter((link) => link.id !== id);
		if (await save(next)) {
			state.links = next;
			notificationManager.success("Link deleted successfully");
		}
	}
	function rearrange() {
		state.editing = null;
		state.original = [...state.links];
		state.rearranging = true;
	}
	function cancelOrder() {
		state.links = [...state.original];
		state.original = [];
		state.rearranging = false;
	}
	async function saveOrder() {
		if (await save(state.links)) {
			state.original = [];
			state.rearranging = false;
			notificationManager.success("Link order saved successfully");
		}
	}
	function move(index: number, offset: number) {
		state.links = moveHubLink(state.links, index, offset);
	}
	function dispose() {
		disposed = true;
		controller.abort();
	}
	return { state, load, add, edit, update, remove, rearrange, cancelOrder, saveOrder, move, dispose };
}
export type ModelHubLinksStore = ReturnType<typeof createModelHubLinksStore>;
