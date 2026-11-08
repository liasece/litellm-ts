import { describe, it, expect, vi } from "vitest";
import { createYamlConfigDiffStore } from "./YamlConfigDiffStore";
import type { YamlConfigDiffApi } from "../api/YamlConfigDiffApi";
const first = { section: "general_settings", key: "max_request_size_mb", yaml_value: 32, db_value: 16, diff_kind: "value_differs" };
const second = { section: "router_settings", key: "timeout", yaml_value: 60, db_value: 30, diff_kind: "value_differs" };
function backend() {
	return {
		load: vi.fn<YamlConfigDiffApi["load"]>(async () => ({ has_pending: true, items: [first, second] })),
		accept: vi.fn<YamlConfigDiffApi["accept"]>(async () => undefined),
		resolve: vi.fn<YamlConfigDiffApi["resolve"]>(async () => undefined),
	};
}
describe("YAML config conflict workflow", () => {
	it("queries only proxy admins, automatically opens pending conflicts and silently ignores a failed query", async () => {
		const api = backend(),
			store = createYamlConfigDiffStore(api);
		for (const role of ["Admin Viewer", "Org Admin", "Internal User"]) await store.load(role);
		expect(api.load).not.toHaveBeenCalled();
		expect(store.state.open).toBe(false);
		await store.load("Admin");
		expect(store.state.open).toBe(true);
		expect(store.state.items).toHaveLength(2);
		store.close();
		api.load.mockRejectedValue(new Error("synthetic unavailable"));
		await expect(store.load("proxy_admin")).resolves.toBeUndefined();
		expect(store.state.open).toBe(false);
	});
	it("removes exactly the accepted pair without reloading config, and requires resolve even after every row is accepted", async () => {
		const api = backend(),
			store = createYamlConfigDiffStore(api);
		await store.load("Admin");
		await store.accept(first.section, first.key);
		expect(api.accept).toHaveBeenCalledWith(first.section, first.key);
		expect(store.state.items).toEqual([second]);
		await store.accept(second.section, second.key);
		expect(store.state.items).toEqual([]);
		expect(store.state.open).toBe(true);
		expect(api.load).toHaveBeenCalledOnce();
		expect(api.resolve).not.toHaveBeenCalled();
		await store.resolve();
		expect(api.resolve).toHaveBeenCalledOnce();
		expect(store.state.open).toBe(false);
	});
	it("keeps the conflict available after a rejected write and does not persist a dismiss action", async () => {
		const api = backend(),
			store = createYamlConfigDiffStore(api);
		await store.load("Admin");
		api.accept.mockRejectedValue(new Error("synthetic rejection"));
		await expect(store.accept(first.section, first.key)).rejects.toThrow("synthetic rejection");
		expect(store.state.items).toHaveLength(2);
		expect(store.state.acceptingKey).toBeNull();
		api.resolve.mockRejectedValue(new Error("synthetic resolve rejection"));
		await expect(store.resolve()).rejects.toThrow("synthetic resolve rejection");
		expect(store.state.open).toBe(true);
		expect(store.state.resolving).toBe(false);
		store.close();
		expect(store.state.open).toBe(false);
		expect(api.resolve).toHaveBeenCalledTimes(1);
	});
	it("does not publish a pending response after its shell is removed", async () => {
		const api = backend();
		let done!: (value: Awaited<ReturnType<YamlConfigDiffApi["load"]>>) => void;
		api.load.mockImplementation(
			() =>
				new Promise((resolve) => {
					done = resolve;
				}),
		);
		const store = createYamlConfigDiffStore(api),
			request = store.load("Admin");
		store.dispose();
		done({ has_pending: true, items: [first] });
		await request;
		expect(store.state.open).toBe(false);
	});
});
