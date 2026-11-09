import { reactive } from "vue";
import { consumeReturnUrl } from "../logic/ReturnUrlLogic";
import type { AuthenticationStore } from "./AuthenticationStore";

export type Navigate = (destination: string, replace?: boolean) => void;

export function createLoginPageStore(auth: AuthenticationStore, navigate: Navigate) {
	const params = new URLSearchParams(typeof location === "undefined" ? "" : location.search);
	const state = reactive({
		username: "",
		password: "",
		showPassword: false,
		loading: true,
		usernameError: "",
		passwordError: "",
		selectedWorkerId: params.get("worker") || auth.state.selectedWorkerId || "",
	});
	let disposed = false;
	async function initialize(): Promise<void> {
		await auth.initialize();
		if (disposed) return;
		try {
			if (auth.state.config?.admin_ui_disabled) return;
			const params = new URLSearchParams(window.location.search);
			if (params.has("token")) {
				params.delete("token");
				history.replaceState(null, "", location.pathname + (params.toString() ? "?" + params.toString() : ""));
			}
			if (params.has("worker") && auth.state.config?.is_control_plane) {
				await auth.logout().catch(() => undefined);
				return;
			}
			if (auth.isAuthorized.value) {
				navigate(consumeReturnUrl() || "/ui", true);
				return;
			}
		} catch {
			// A failed exchange or unavailable session leaves the normal login form usable.
		} finally {
			if (!disposed) state.loading = false;
		}
	}
	async function submit(): Promise<void> {
		state.usernameError = state.username ? "" : "Please enter your username";
		state.passwordError = state.password ? "" : "Please enter your password";
		if (state.usernameError || state.passwordError || auth.state.pending) return;
		const worker = auth.state.config?.workers?.find((item) => item.worker_id === state.selectedWorkerId);
		try {
			const result = await auth.login(state.username, state.password, { workerId: worker?.worker_id });
			if (!disposed) navigate(worker ? "/ui/?login=success" : consumeReturnUrl() || result.redirect_url);
		} catch {
			// AuthenticationStore retains the user-visible failure.
		}
	}
	function dispose(): void {
		disposed = true;
	}
	return { state, initialize, submit, dispose };
}
