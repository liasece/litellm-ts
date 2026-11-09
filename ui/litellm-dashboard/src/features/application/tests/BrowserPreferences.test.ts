import { describe, expect, it } from "vitest";
import { createBrowserPreferencesStore } from "../stores/BrowserPreferencesStore";
describe("browser preferences", () => {
	it("publishes toggle changes across consumers and reloads persisted state", () => {
		const values = new Map<string, string>(),
			events = new EventTarget();
		const storage = {
			getItem: (key: string) => values.get(key) ?? null,
			setItem: (key: string, value: string) => {
				values.set(key, value);
			},
			removeItem: (key: string) => {
				values.delete(key);
			},
		};
		const a = createBrowserPreferencesStore(storage, events),
			b = createBrowserPreferencesStore(storage, events);
		a.start();
		b.start();
		a.setPreference("disableShowNewBadge", true);
		expect(b.preferences.disableShowNewBadge).toBe(true);
		expect(createBrowserPreferencesStore(storage).preferences.disableShowNewBadge).toBe(true);
		b.setPreference("disableShowNewBadge", false);
		expect(a.preferences.disableShowNewBadge).toBe(false);
		expect(values.has("disableShowNewBadge")).toBe(false);
		a.stop();
		b.stop();
	});
	it("still updates in memory when browser storage is blocked", () => {
		const denied = () => {
			throw new Error("denied");
		};
		const store = createBrowserPreferencesStore({ getItem: denied, setItem: denied, removeItem: denied }, null);
		store.setPreference("disableUsageIndicator", true);
		expect(store.preferences.disableUsageIndicator).toBe(true);
	});
	it("refreshes externally changed values while subscribed and removes listeners on final stop", () => {
		const values = new Map<string, string>(),
			events = new EventTarget();
		const store = createBrowserPreferencesStore(
			{ getItem: (key) => values.get(key) ?? null, setItem: () => {}, removeItem: () => {} },
			events,
		);
		store.start();
		store.start();
		values.set("disableShowNewBadge", "true");
		events.dispatchEvent(new CustomEvent("local-storage-change", { detail: { key: "disableShowNewBadge" } }));
		expect(store.preferences.disableShowNewBadge).toBe(true);
		store.stop();
		values.delete("disableShowNewBadge");
		events.dispatchEvent(new Event("storage"));
		expect(store.preferences.disableShowNewBadge).toBe(false);
		store.stop();
		values.set("disableShowNewBadge", "true");
		events.dispatchEvent(new Event("storage"));
		expect(store.preferences.disableShowNewBadge).toBe(false);
	});
});
