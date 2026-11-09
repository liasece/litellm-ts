import { getUiConfig, getWebUiSession, loginCall, logoutWebUiSession } from "../data/IdentityRepository";
import { getApiBaseUrl, switchToWorkerUrl } from "../../platform/support/ApiEnvironmentSupport";
import type { LoginOptions, LoginResult, UiConfig, WebUiSessionInfo } from "../support/IdentityModels";

export interface IdentityService {
	loadConfig(): Promise<UiConfig>;
	loadSession(): Promise<WebUiSessionInfo>;
	login(username: string, password: string, options?: LoginOptions): Promise<LoginResult>;
	logout(): Promise<void>;
	getApiBaseUrl(): string;
	switchWorker(url: string | null): boolean;
}

export const identityService: IdentityService = {
	loadConfig: getUiConfig,
	loadSession: getWebUiSession,
	login: (username, password) => loginCall(username, password),
	logout: logoutWebUiSession,
	getApiBaseUrl,
	switchWorker: switchToWorkerUrl,
};
