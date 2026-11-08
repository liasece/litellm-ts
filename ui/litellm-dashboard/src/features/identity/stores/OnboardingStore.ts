import { reactive } from "vue";
import { getOnboardingCredentials, claimOnboardingToken } from "../data/IdentityRepository";
import type { AuthenticationStore } from "./AuthenticationStore";
import type { Navigate } from "./LoginPageStore";
import { identityService } from "../logic/IdentityService";

function decodeIdentity(token: string): { user_email?: string; user_id?: string } {
	const encoded = token.split(".")[1];
	if (!encoded) throw new Error("Invalid invitation");
	const bytes = atob(encoded.replace(/-/g, "+").replace(/_/g, "/"));
	const json: unknown = JSON.parse(
		decodeURIComponent(
			Array.from(bytes)
				.map((letter) => "%" + letter.charCodeAt(0).toString(16).padStart(2, "0"))
				.join(""),
		),
	);
	if (!json || typeof json !== "object") throw new Error("Invalid invitation");
	const value = json as Record<string, unknown>;
	return {
		user_email: typeof value.user_email === "string" ? value.user_email : undefined,
		user_id: typeof value.user_id === "string" ? value.user_id : undefined,
	};
}

export function createOnboardingStore(auth: AuthenticationStore, navigate: Navigate) {
	const params = new URLSearchParams(typeof location === "undefined" ? "" : location.search);
	const inviteId = params.get("invitation_id");
	const state = reactive({
		variant: params.get("action") === "reset_password" ? "reset_password" : "signup",
		loading: Boolean(inviteId),
		loadError: false,
		pending: false,
		error: "",
		password: "",
		passwordError: "",
		showPassword: false,
		userEmail: "",
		userId: "",
	});
	let disposed = false;
	async function initialize(): Promise<void> {
		await auth.initialize();
		if (!inviteId || disposed) return;
		try {
			const credentials = await getOnboardingCredentials(inviteId);
			const identity = decodeIdentity(credentials.token);
			if (!disposed) {
				state.userEmail = identity.user_email ?? "";
				state.userId = identity.user_id ?? "";
			}
		} catch {
			if (!disposed) state.loadError = true;
		} finally {
			if (!disposed) state.loading = false;
		}
	}
	async function submit(): Promise<void> {
		state.passwordError = state.password ? "" : "password required to sign up";
		if (state.passwordError || !state.userId || !inviteId || state.pending) return;
		state.pending = true;
		state.error = "";
		try {
			await claimOnboardingToken(inviteId, state.userId, state.password);
			if (!disposed) navigate(identityService.getApiBaseUrl() + "/ui/?login=success");
		} catch (error: unknown) {
			if (!disposed) state.error = error instanceof Error ? error.message : "Failed to submit. Please try again.";
		} finally {
			if (!disposed) state.pending = false;
		}
	}
	return {
		state,
		initialize,
		submit,
		dispose: () => {
			disposed = true;
		},
	};
}
