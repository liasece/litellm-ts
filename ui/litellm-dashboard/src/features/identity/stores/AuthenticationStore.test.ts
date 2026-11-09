import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpApiError } from "../../platform/support/HttpApiErrorSupport";
import type { IdentityService } from "../logic/IdentityService";
import type { UiConfig, WebUiSessionInfo } from "../support/IdentityModels";
import { createAuthenticationStore, WEBUI_SESSION_KEEPALIVE_INTERVAL_MS } from "./AuthenticationStore";

const config: UiConfig = {
	server_root_path: "/",
	proxy_base_url: null,
	admin_ui_disabled: false,
};
const session: WebUiSessionInfo = {
	authenticated: true,
	user_id: "fixture-user",
	user_email: "fixture@example.test",
	user_role: "proxy_admin",
	login_method: "username_password",
	premium_user: false,
	disabled_non_admin_personal_key_creation: false,
	server_root_path: "/",
};
function service(): IdentityService {
	return {
		loadConfig: vi.fn().mockResolvedValue(config),
		loadSession: vi.fn().mockResolvedValue(session),
		login: vi.fn().mockResolvedValue({ redirect_url: "/ui/?login=success" }),
		logout: vi.fn().mockResolvedValue(undefined),
		getApiBaseUrl: () => "",
		switchWorker: vi.fn().mockReturnValue(true),
	};
}
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.stubGlobal(
		"window",
		Object.assign(new EventTarget(), { localStorage: { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() } }),
	);
	vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible" }));
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("Dashboard session lifecycle", () => {
	it("shares initialization and preserves the backend identity without decoding a cookie", async () => {
		const api = service();
		const store = createAuthenticationStore(api);
		await Promise.all([store.initialize(), store.initialize()]);
		expect(api.loadConfig).toHaveBeenCalledTimes(1);
		expect(api.loadSession).toHaveBeenCalledTimes(1);
		expect(store.state.session).toEqual(session);
		expect(store.userRole.value).toBe("Admin");
		expect(store.isAuthorized.value).toBe(true);
		store.dispose();
	});

	it("keeps a valid session on transient keepalive failure and expires it only on 401/403", async () => {
		const api = service();
		vi.mocked(api.loadSession)
			.mockResolvedValueOnce(session)
			.mockRejectedValueOnce(new Error("offline"))
			.mockRejectedValueOnce(new HttpApiError("expired", 401));
		const store = createAuthenticationStore(api);
		await store.initialize();
		await vi.advanceTimersByTimeAsync(WEBUI_SESSION_KEEPALIVE_INTERVAL_MS);
		expect(store.isAuthorized.value).toBe(true);
		await vi.advanceTimersByTimeAsync(WEBUI_SESSION_KEEPALIVE_INTERVAL_MS);
		expect(store.isAuthorized.value).toBe(false);
		expect(vi.getTimerCount()).toBe(0);
		store.dispose();
	});

	it("does not resurrect a session whose initial response arrives after logout", async () => {
		const api = service();
		const delayed = deferred<WebUiSessionInfo>();
		vi.mocked(api.loadSession).mockReturnValue(delayed.promise);
		const store = createAuthenticationStore(api);
		const initialization = store.initialize();
		await Promise.resolve();
		await Promise.resolve();
		await store.logout();
		delayed.resolve(session);
		await initialization;
		expect(store.state.session).toBeNull();
		expect(store.state.loading).toBe(false);
		expect(store.isAuthorized.value).toBe(false);
		store.dispose();
	});

	it("treats unauthenticated startup as a login state without displaying an error", async () => {
		const api = service();
		vi.mocked(api.loadSession).mockRejectedValue(new HttpApiError("not authenticated", 401));
		const store = createAuthenticationStore(api);
		await store.initialize();
		expect(store.state.error).toBeNull();
		expect(store.state.initialized).toBe(true);
		expect(store.isAuthorized.value).toBe(false);
		store.dispose();
	});

	it("switches to the selected worker before login and resets its API target on failure", async () => {
		const api = service();
		vi.mocked(api.loadConfig).mockResolvedValue({
			...config,
			workers: [{ worker_id: "worker-1", name: "Worker", url: "https://worker.example" }],
		});
		vi.mocked(api.login).mockRejectedValue(new Error("Invalid credentials"));
		const store = createAuthenticationStore(api);
		await store.initialize();
		await expect(store.login("fixture", "fixture", { workerId: "worker-1" })).rejects.toThrow("Invalid credentials");
		expect(api.switchWorker).toHaveBeenCalledWith("https://worker.example");
		expect(api.login).toHaveBeenCalledWith("fixture", "fixture", { workerId: "worker-1" });
		expect(api.switchWorker).toHaveBeenLastCalledWith(null);
		expect(store.state.pending).toBe(false);
		store.dispose();
	});
});
