import { z } from "zod";
import { configureApiEnvironment } from "../../platform/support/ApiEnvironmentSupport";
import { dashboardFetch, deriveErrorMessage, getApiBaseUrl, HttpApiError, requestJson } from "../../platform/api/HttpApiClient";
import type { LoginResult, UiConfig, WebUiSessionInfo } from "../support/IdentityModels";

const workerSchema = z.object({ worker_id: z.string(), name: z.string(), url: z.string() });
const uiConfigSchema = z.object({
	server_root_path: z.string().default("/"),
	proxy_base_url: z.string().nullable().default(null),
	auto_redirect_to_sso: z.boolean().default(false),
	admin_ui_disabled: z.boolean().default(false),
	sso_configured: z.boolean().default(false),
	is_control_plane: z.boolean().optional(),
	workers: z.array(workerSchema).optional(),
});
const sessionSchema = z.object({
	authenticated: z.literal(true),
	user_id: z.string(),
	user_email: z.string().nullable(),
	user_role: z.string(),
	login_method: z.string(),
	premium_user: z.boolean(),
	disabled_non_admin_personal_key_creation: z.boolean(),
	server_root_path: z.string(),
});
const loginResultSchema = z.object({ redirect_url: z.string().optional(), code: z.string().optional(), expires_in: z.number().optional() });

export async function getUiConfig(): Promise<UiConfig> {
	const response = await dashboardFetch("/litellm/.well-known/litellm-ui-config");
	const payload: unknown = await response.json();
	if (!response.ok) throw new HttpApiError(deriveErrorMessage(payload), response.status);
	const config = uiConfigSchema.parse(payload);
	configureApiEnvironment(config.server_root_path, config.proxy_base_url);
	return config;
}

export function getWebUiSession(): Promise<WebUiSessionInfo> {
	return requestJson("/auth/session", {}, (payload) => sessionSchema.parse(payload));
}

export async function loginCall(username: string, password: string, useV3 = false): Promise<LoginResult> {
	const result = await requestJson(
		useV3 ? "/v3/login" : "/v2/login",
		{
			method: "POST",
			body: JSON.stringify({ username, password }),
		},
		(payload) => loginResultSchema.parse(payload),
	);
	if (useV3 && result.code) {
		const exchanged = await requestJson(
			"/v3/login/exchange",
			{ method: "POST", body: JSON.stringify({ code: result.code }) },
			(payload) => loginResultSchema.parse(payload),
		);
		return { ...exchanged, redirect_url: exchanged.redirect_url || "/ui/?login=success" };
	}
	if (!result.redirect_url && !useV3) throw new HttpApiError("Login response is missing its redirect URL", 502);
	return { ...result, redirect_url: result.redirect_url || "/ui/?login=success" };
}

export async function exchangeLoginCode(code: string, workerBaseUrl?: string | null): Promise<void> {
	await requestJson(
		(workerBaseUrl || getApiBaseUrl()) + "/v3/login/exchange",
		{
			method: "POST",
			body: JSON.stringify({ code }),
		},
		(payload) => z.unknown().parse(payload),
	);
}

export async function logoutWebUiSession(): Promise<void> {
	const response = await dashboardFetch(getApiBaseUrl() + "/auth/logout", { method: "POST" });
	if (!response.ok) throw new HttpApiError("Failed to logout WebUI session", response.status);
}

export async function getOnboardingCredentials(inviteId: string): Promise<{ token: string; login_url: string }> {
	return requestJson("/onboarding/get_token?invite_link=" + encodeURIComponent(inviteId), {}, (payload) =>
		z.object({ token: z.string(), login_url: z.string() }).parse(payload),
	);
}

export async function claimOnboardingToken(inviteId: string, userId: string, password: string): Promise<void> {
	await requestJson(
		"/onboarding/claim_token",
		{
			method: "POST",
			body: JSON.stringify({ invitation_link: inviteId, user_id: userId, password }),
		},
		(payload) => z.unknown().parse(payload),
	);
}
