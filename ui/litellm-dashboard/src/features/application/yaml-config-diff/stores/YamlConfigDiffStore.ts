import { reactive } from "vue";
import { isProxyAdminRole } from "../../../identity/logic/UserRoleLogic";
import { yamlConfigDiffApi, type YamlConfigDiffApi, type YamlConfigDiffItem } from "../api/YamlConfigDiffApi";
import { yamlDiffRowKey } from "../logic/YamlConfigDiffLogic";
export function createYamlConfigDiffStore(api: YamlConfigDiffApi = yamlConfigDiffApi) {
	const state = reactive({ open: false, items: [] as YamlConfigDiffItem[], acceptingKey: null as string | null, resolving: false });
	let generation = 0,
		disposed = false;
	async function load(role: string) {
		const current = ++generation;
		if (!isProxyAdminRole(role)) {
			state.open = false;
			state.items = [];
			return;
		}
		try {
			const response = await api.load();
			if (disposed || current !== generation) return;
			if (response.has_pending && response.items.length) {
				state.items = response.items;
				state.open = true;
			}
		} catch {
			/* The original shell silently ignores an unavailable diff query. */
		}
	}
	async function accept(section: string, key: string) {
		const current = generation;
		state.acceptingKey = yamlDiffRowKey({ section, key });
		try {
			await api.accept(section, key);
			if (!disposed && current === generation)
				state.items = state.items.filter((item) => !(item.section === section && item.key === key));
		} finally {
			if (!disposed && current === generation) state.acceptingKey = null;
		}
	}
	async function resolve() {
		const current = generation;
		state.resolving = true;
		try {
			await api.resolve();
			if (!disposed && current === generation) {
				state.items = [];
				state.open = false;
			}
		} finally {
			if (!disposed && current === generation) state.resolving = false;
		}
	}
	function close() {
		state.open = false;
	}
	function dispose() {
		disposed = true;
		generation++;
	}
	return { state, load, accept, resolve, close, dispose };
}
