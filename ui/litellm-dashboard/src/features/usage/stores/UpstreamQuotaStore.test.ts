import { describe, expect, it, vi } from "vitest";
import { createUpstreamQuotaStore } from "./UpstreamQuotaStore";
describe("optional upstream quota", () => {
	it("refreshes quotas without reloading the account list and forces only the built-in quota cache", async () => {
		const api = {
			accounts: vi.fn().mockResolvedValue([{ auth_index: "a", filename: "fixture", provider: "codex", email: null }]),
			quota: vi.fn().mockResolvedValue({
				provider: "codex",
				plan: null,
				subscription_expires_at: null,
				windows: [],
				balances: [],
				fetched_at: "2026-11-07T00:00:00Z",
			}),
			builtIn: vi.fn().mockResolvedValue([]),
		};
		const store = createUpstreamQuotaStore(api);
		await store.load();
		await store.load(true);
		expect(api.accounts).toHaveBeenCalledTimes(1);
		expect(api.quota).toHaveBeenCalledTimes(2);
		expect(api.builtIn.mock.calls.map((call) => call[0])).toEqual([false, true]);
		expect(store.state.refreshing).toBe(false);
		store.dispose();
	});
	it("isolates optional quota failures from the rest of usage", async () => {
		const store = createUpstreamQuotaStore({
			accounts: vi.fn().mockRejectedValue(new Error("Forbidden")),
			quota: vi.fn(),
			builtIn: vi.fn().mockRejectedValue(new Error("Unavailable")),
		});
		await store.load();
		expect(store.state.accounts).toEqual([]);
		expect(store.state.providers).toEqual([]);
		expect(store.state.builtInError).toBe("Unavailable");
		expect(store.state.refreshing).toBe(false);
		store.dispose();
	});
});
