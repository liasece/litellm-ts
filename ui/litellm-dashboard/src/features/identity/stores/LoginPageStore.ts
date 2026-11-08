import { reactive } from "vue";
import { identityService } from "../logic/IdentityService";
import { consumeReturnUrl, getReturnUrl, isValidReturnUrl } from "../logic/ReturnUrlLogic";
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
		showSsoNotice: true,
	});
	let disposed = false;
	async function initialize(): Promise<void> {
		await auth.initialize();
		if (disposed) return;
		try {
			if (auth.state.config?.admin_ui_disabled) return;
			const params = new URLSearchParams(window.location.search);
			const code = params.get("code");
			if (code) {
				await identityService.exchangeCode(code, localStorage.getItem("litellm_worker_url"));
				params.delete("code");
				history.replaceState(null, "", location.pathname + (params.toString() ? "?" + params.toString() : ""));
				await auth.refreshSession();
				if (!disposed) navigate("/ui/?login=success", true);
				return;
			}
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
			if (auth.state.config?.auto_redirect_to_sso) {
				const returnUrl = getReturnUrl();
				navigate(
					identityService.getApiBaseUrl() +
						"/sso/key/generate" +
						(returnUrl && isValidReturnUrl(returnUrl) ? "?redirect_to=" + encodeURIComponent(returnUrl) : ""),
				);
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
			const result = await auth.login(state.username, state.password, { workerId: worker?.worker_id, useV3: Boolean(worker) });
			if (!disposed) navigate(worker ? "/ui/?login=success" : consumeReturnUrl() || result.redirect_url);
		} catch {
			// AuthenticationStore retains the user-visible failure.
		}
	}
	function startSso(): void {
		const worker = auth.state.config?.workers?.find((item) => item.worker_id === state.selectedWorkerId);
		if (worker) auth.selectWorker(worker.worker_id);
		const base = worker?.url ?? identityService.getApiBaseUrl();
		navigate(base + "/sso/key/generate?return_to=" + encodeURIComponent(window.location.origin + "/ui/login"));
	}
	function dispose(): void {
		disposed = true;
	}
	return { state, initialize, submit, startSso, dispose };
}
