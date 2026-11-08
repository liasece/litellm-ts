import { getUiConfig, getWebUiSession, loginCall, logoutWebUiSession, exchangeLoginCode } from "../data/IdentityRepository";
import { getApiBaseUrl, switchToWorkerUrl } from "../../platform/support/ApiEnvironmentSupport";
import type { LoginOptions, LoginResult, UiConfig, WebUiSessionInfo } from "../support/IdentityModels";

export interface IdentityService {
	loadConfig(): Promise<UiConfig>;
	loadSession(): Promise<WebUiSessionInfo>;
	login(username: string, password: string, options?: LoginOptions): Promise<LoginResult>;
	logout(): Promise<void>;
	exchangeCode(code: string, workerBaseUrl?: string | null): Promise<void>;
	getApiBaseUrl(): string;
	switchWorker(url: string | null): boolean;
}

export const identityService: IdentityService = {
	loadConfig: getUiConfig,
	loadSession: getWebUiSession,
	login: (username, password, options) => loginCall(username, password, options?.useV3),
	logout: logoutWebUiSession,
	exchangeCode: exchangeLoginCode,
	getApiBaseUrl,
	switchWorker: switchToWorkerUrl,
};
