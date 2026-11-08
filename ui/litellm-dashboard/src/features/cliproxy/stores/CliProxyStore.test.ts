import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cliProxyApi } from "../api/CliProxyApi";
import { createCliProxyStore } from "./CliProxyStore";
import type { Account, AccountQuota, CliProxyLogEntry } from "../support/CliProxyModels";
vi.mock("../api/CliProxyApi", () => ({ cliProxyApi: vi.fn(), advancedManagementApi: vi.fn() }));
const api = vi.mocked(cliProxyApi<unknown>);
const account: Account = {
	auth_index: "account-1",
	filename: "fixture.json",
	provider: "codex",
	email: "fixture@example.test",
	disabled: false,
	weight: null,
	modified_at: "2026-11-07T00:00:00Z",
};
const firstLog: CliProxyLogEntry = { id: 1, timestamp: "2026-11-07T00:00:00Z", stream: "system", message: "ready" };
const quota: AccountQuota = {
	provider: "codex",
	plan: "Pro",
	subscription_expires_at: null,
	windows: [{ id: "week", label: "Weekly", used_percent: 10, remaining_percent: 90, resets_at: null }],
	balances: [],
	fetched_at: "2026-11-07T00:00:00Z",
};
const emptyStatus = { state: "running", version: "8.0.47", installed_versions: ["8.0.47"], health: "healthy" };
function defaults(path: string): Promise<unknown> {
	if (path === "/cliproxy/config")
		return Promise.resolve({ settings: { enabled: true, config_yaml: "" }, user_config: {}, status: emptyStatus });
	if (path.startsWith("/cliproxy/accounts") && !path.endsWith("/quota")) return Promise.resolve({ data: [account] });
	if (path.endsWith("/quota")) return Promise.resolve(quota);
	if (path === "/cliproxy/commandcode/accounts") return Promise.resolve({ data: [] });
	if (path.startsWith("/cliproxy/logs")) return Promise.resolve({ entries: [firstLog], cursor: 1 });
	if (path.startsWith("/cliproxy/update/check"))
		return Promise.resolve({ current: "8.0.47", latest: "8.0.47", update_available: false, releases: [] });
	return Promise.resolve(emptyStatus);
}
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
beforeEach(() => {
	vi.stubGlobal("window", { dispatchEvent: vi.fn() });
	api.mockImplementation((path) => defaults(path));
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.useRealTimers();
	api.mockReset();
});

describe("CLIProxy account and activity lifecycle", () => {
	it("deduplicates overlapping log polls and appends the next cursor exactly once", async () => {
		const store = createCliProxyStore();
		await store.load();
		const pending = deferred<{ entries: CliProxyLogEntry[]; cursor: number }>();
		api.mockImplementation((path) => (path.includes("?after=") ? pending.promise : defaults(path)));
		const first = store.refreshLogs();
		await store.refreshLogs();
		expect(api.mock.calls.filter(([path]) => path.includes("?after="))).toHaveLength(1);
		pending.resolve({ entries: [{ ...firstLog, id: 2, message: "next" }], cursor: 2 });
		await first;
		expect(store.state.logs.map((entry) => entry.id)).toEqual([1, 2]);
		expect(store.state.logCursor).toBe(2);
		store.dispose();
	});

	it("keeps the refreshed buffer when an older slow incremental poll arrives later", async () => {
		const store = createCliProxyStore();
		await store.load();
		const pending = deferred<{ entries: CliProxyLogEntry[]; cursor: number }>();
		api.mockImplementation((path) =>
			path.includes("?after=")
				? pending.promise
				: path === "/cliproxy/logs"
					? Promise.resolve({ entries: [{ ...firstLog, id: 10, message: "fresh" }], cursor: 10 })
					: defaults(path),
		);
		const incremental = store.refreshLogs();
		await store.reloadLogs();
		pending.resolve({ entries: [{ ...firstLog, id: 2, message: "stale" }], cursor: 2 });
		await incremental;
		expect(store.state.logs.map((entry) => entry.id)).toEqual([10]);
		expect(store.state.logCursor).toBe(10);
		store.dispose();
	});

	it("retains a successfully fetched quota while reporting a failed refresh", async () => {
		const store = createCliProxyStore();
		await store.loadQuota(account);
		api.mockRejectedValueOnce(new Error("provider unavailable"));
		await store.loadQuota(account);
		expect(store.state.quotaStates[account.auth_index]).toEqual({ status: "error", data: quota, error: "provider unavailable" });
		store.dispose();
	});

	it("does not send an empty replacement secret when only the managed account label changes", async () => {
		const store = createCliProxyStore();
		store.editCommandCodeAccount({ index: 2, label: "old", filename: "managed.json" });
		store.state.editingCommandCodeLabel = "renamed";
		await store.saveCommandCodeAccount();
		const call = api.mock.calls.find(([path]) => path === "/cliproxy/commandcode/accounts/2");
		expect(call?.[1]?.method).toBe("PATCH");
		expect(JSON.parse(String(call?.[1]?.body))).toEqual({ label: "renamed" });
		expect(store.state.editingCommandCode).toBeNull();
		store.dispose();
	});

	it("ignores a pending log response after the page is disposed", async () => {
		const store = createCliProxyStore();
		const pending = deferred<{ entries: CliProxyLogEntry[]; cursor: number }>();
		api.mockImplementation(() => pending.promise);
		const request = store.refreshLogs();
		store.dispose();
		pending.resolve({ entries: [firstLog], cursor: 1 });
		await request;
		expect(store.state.logs).toEqual([]);
		expect(store.state.logCursor).toBe(0);
	});
});
