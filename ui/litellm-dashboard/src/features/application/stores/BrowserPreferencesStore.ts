import { onMounted, onUnmounted, reactive } from "vue";
import { preferenceOptions } from "../data/BrowserPreferencesData";
type PreferenceStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
function browserStorage(): PreferenceStorage | null {
	try {
		return typeof window === "undefined" ? null : window.localStorage;
	} catch {
		return null;
	}
}
export function createBrowserPreferencesStore(
	storage: PreferenceStorage | null = browserStorage(),
	events: EventTarget | null = typeof window === "undefined" ? null : window,
) {
	const preferences = reactive<Record<string, boolean>>({});
	let consumers = 0;
	function refresh(key?: string) {
		for (const option of preferenceOptions) {
			if (key && option.key !== key) continue;
			try {
				preferences[option.key] = storage?.getItem(option.key) === "true";
			} catch {
				preferences[option.key] = false;
			}
		}
	}
	function changed(event: Event) {
		const key = "key" in event ? event.key : (event as CustomEvent<{ key?: string }>).detail?.key;
		refresh(typeof key === "string" ? key : undefined);
	}
	function setPreference(key: string, enabled: boolean) {
		if (!preferenceOptions.some((option) => option.key === key)) return;
		preferences[key] = enabled;
		try {
			if (enabled) storage?.setItem(key, "true");
			else storage?.removeItem(key);
		} catch {
			/* Keep preferences usable when browser storage is unavailable. */
		}
		events?.dispatchEvent(new CustomEvent("local-storage-change", { detail: { key } }));
	}
	function start() {
		if (consumers++ === 0) {
			refresh();
			events?.addEventListener("storage", changed);
			events?.addEventListener("local-storage-change", changed);
		}
	}
	function stop() {
		if (consumers === 0) return;
		if (--consumers === 0) {
			events?.removeEventListener("storage", changed);
			events?.removeEventListener("local-storage-change", changed);
		}
	}
	refresh();
	return { preferences, setPreference, refresh, start, stop };
}
let shared: ReturnType<typeof createBrowserPreferencesStore> | undefined;
export function useBrowserPreferences() {
	const store = (shared ??= createBrowserPreferencesStore());
	onMounted(store.start);
	onUnmounted(store.stop);
	return store;
}
