import { z } from "zod";
import { configureApiEnvironment } from "../../platform/support/ApiEnvironmentSupport";
import { dashboardFetch, deriveErrorMessage, getApiBaseUrl, HttpApiError, requestJson } from "../../platform/api/HttpApiClient";
import type { LoginResult, UiConfig, WebUiSessionInfo } from "../support/IdentityModels";

const workerSchema = z.object({ worker_id: z.string(), name: z.string(), url: z.string() });
const uiConfigSchema = z.object({
	server_root_path: z.string().default("/"),
	proxy_base_url: z.string().nullable().default(null),
	admin_ui_disabled: z.boolean().default(false),
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

export async function loginCall(username: string, password: string): Promise<LoginResult> {
	const result = await requestJson(
		"/v2/login",
		{
			method: "POST",
			body: JSON.stringify({ username, password }),
		},
		(payload) => loginResultSchema.parse(payload),
	);
	if (!result.redirect_url) throw new HttpApiError("Login response is missing its redirect URL", 502);
	return { ...result, redirect_url: result.redirect_url };
}

export async function logoutWebUiSession(): Promise<void> {
	const response = await dashboardFetch(getApiBaseUrl() + "/auth/logout", { method: "POST" });
	if (!response.ok) throw new HttpApiError("Failed to logout WebUI session", response.status);
}
