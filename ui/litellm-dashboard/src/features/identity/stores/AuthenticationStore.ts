import { computed, inject, reactive, type InjectionKey } from "vue";
import { HttpApiError } from "../../platform/support/HttpApiErrorSupport";
import { identityService, type IdentityService } from "../logic/IdentityService";
import { formatUserRole } from "../logic/UserRoleLogic";
import type { LoginOptions, UiConfig, WebUiSessionInfo } from "../support/IdentityModels";

export const WEBUI_SESSION_KEEPALIVE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const SELECTED_WORKER_KEY = "litellm_selected_worker_id";

export interface AuthenticationState {
	session: WebUiSessionInfo | null;
	config: UiConfig | null;
	loading: boolean;
	pending: boolean;
	error: string | null;
	initialized: boolean;
	selectedWorkerId: string | null;
}

function readSelectedWorker(): string | null {
	try {
		return typeof window === "undefined" ? null : window.localStorage.getItem(SELECTED_WORKER_KEY);
	} catch {
		return null;
	}
}

export function createAuthenticationStore(service: IdentityService = identityService) {
	const state = reactive<AuthenticationState>({
		session: null,
		config: null,
		loading: true,
		pending: false,
		error: null,
		initialized: false,
		selectedWorkerId: readSelectedWorker(),
	});
	let generation = 0;
	let initialization: Promise<void> | null = null;
	let keepalive: ReturnType<typeof setInterval> | null = null;
	let keepaliveRequest: Promise<void> | null = null;
	let lastKeepaliveAt = 0;
	let disposed = false;

	function stopKeepalive(): void {
		if (keepalive !== null) clearInterval(keepalive);
		keepalive = null;
		if (typeof window !== "undefined") window.removeEventListener("focus", wake);
		if (typeof document !== "undefined") document.removeEventListener("visibilitychange", wake);
	}
	function runKeepalive(): Promise<void> {
		if (keepaliveRequest) return keepaliveRequest;
		const current = generation;
		lastKeepaliveAt = Date.now();
		keepaliveRequest = service
			.loadSession()
			.then((session) => {
				if (!disposed && generation === current) state.session = session;
			})
			.catch((error: unknown) => {
				if (!disposed && generation === current && error instanceof HttpApiError && [401, 403].includes(error.status)) {
					state.session = null;
					stopKeepalive();
				}
			})
			.finally(() => {
				keepaliveRequest = null;
			});
		return keepaliveRequest;
	}
	function wake(): void {
		if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
		if (Date.now() - lastKeepaliveAt >= WEBUI_SESSION_KEEPALIVE_INTERVAL_MS) void runKeepalive();
	}
	function startKeepalive(): void {
		if (keepalive !== null || typeof window === "undefined" || !state.session) return;
		lastKeepaliveAt = Date.now();
		keepalive = setInterval(() => void runKeepalive(), WEBUI_SESSION_KEEPALIVE_INTERVAL_MS);
		window.addEventListener("focus", wake);
		document.addEventListener("visibilitychange", wake);
	}
	function selectWorker(id: string): void {
		const worker = state.config?.workers?.find((item) => item.worker_id === id);
		if (!worker || !service.switchWorker(worker.url)) return;
		state.selectedWorkerId = id;
		generation++;
		state.session = null;
		stopKeepalive();
		try {
			window.localStorage.setItem(SELECTED_WORKER_KEY, id);
		} catch {
			/* Storage can be unavailable. */
		}
	}
	function disconnectWorker(): void {
		state.selectedWorkerId = null;
		generation++;
		state.session = null;
		service.switchWorker(null);
		stopKeepalive();
		try {
			window.localStorage.removeItem(SELECTED_WORKER_KEY);
		} catch {
			/* Storage can be unavailable. */
		}
	}

	async function initialize(): Promise<void> {
		if (initialization) return initialization;
		if (state.initialized) return;
		const current = ++generation;
		state.loading = true;
		initialization = (async () => {
			try {
				const config = await service.loadConfig();
				if (disposed || generation !== current) return;
				state.config = config;
				const worker = config.workers?.find((item) => item.worker_id === state.selectedWorkerId);
				if (worker) service.switchWorker(worker.url);
				if (!config.admin_ui_disabled) {
					try {
						const session = await service.loadSession();
						if (!disposed && generation === current) {
							state.session = session;
							startKeepalive();
						}
					} catch (error: unknown) {
						if (!disposed && generation === current) {
							state.session = null;
							if (!(error instanceof HttpApiError && [401, 403].includes(error.status))) {
								state.error = error instanceof Error ? error.message : "Failed to load session";
							}
						}
					}
				}
			} catch (error: unknown) {
				if (!disposed && generation === current)
					state.error = error instanceof Error ? error.message : "Failed to load configuration";
			} finally {
				if (!disposed && generation === current) {
					state.loading = false;
					state.initialized = true;
				}
				initialization = null;
			}
		})();
		return initialization;
	}
	async function login(username: string, password: string, options: LoginOptions = {}) {
		if (options.workerId) selectWorker(options.workerId);
		const current = ++generation;
		state.pending = true;
		state.error = null;
		try {
			const result = await service.login(username, password, options);
			const session = await service.loadSession();
			if (!disposed && generation === current) {
				state.session = session;
				startKeepalive();
			}
			return result;
		} catch (error: unknown) {
			if (!disposed && generation === current) {
				state.error = error instanceof Error ? error.message : "Failed to login";
				if (options.workerId) service.switchWorker(null);
			}
			throw error;
		} finally {
			if (!disposed && generation === current) state.pending = false;
		}
	}
	async function refreshSession(): Promise<void> {
		const current = ++generation;
		const session = await service.loadSession();
		if (!disposed && generation === current) {
			state.session = session;
			startKeepalive();
		}
	}
	async function logout(): Promise<void> {
		const current = ++generation;
		stopKeepalive();
		state.loading = false;
		state.pending = false;
		state.initialized = true;
		await service.logout();
		if (!disposed && generation === current) state.session = null;
	}
	function dispose(): void {
		disposed = true;
		generation++;
		stopKeepalive();
	}

	return {
		state,
		isAuthorized: computed(() => state.session !== null && !state.config?.admin_ui_disabled),
		userRole: computed(() => (state.session ? formatUserRole(state.session.user_role) : "")),
		initialize,
		login,
		logout,
		refreshSession,
		selectWorker,
		disconnectWorker,
		dispose,
	};
}

export type AuthenticationStore = ReturnType<typeof createAuthenticationStore>;
export const authenticationStoreKey: InjectionKey<AuthenticationStore> = Symbol("AuthenticationStore");
export function useAuthenticationStore(): AuthenticationStore {
	const store = inject(authenticationStoreKey);
	if (!store) throw new Error("AuthenticationStore is not provided");
	return store;
}
