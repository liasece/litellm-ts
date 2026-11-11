/**
 * Antigravity 的 Google OAuth 与 Cloud Code 请求。
 *
 * 只负责把请求发出去并解析结果，不读写磁盘、不记录日志；token 的持久化与
 * 错误包装由 `antigravity.ts` 处理。所有请求都接受注入的 fetch，测试无需联网。
 */

import { getJson, postForm, postJson, type TokenEndpointResponse } from "./http";
import {
	ANTIGRAVITY_API_VERSION,
	ANTIGRAVITY_AUTH_ENDPOINT,
	ANTIGRAVITY_CLIENT_ID,
	ANTIGRAVITY_CLIENT_SECRET,
	ANTIGRAVITY_CLIENT_VERSION,
	ANTIGRAVITY_CLOUDCODE_ENDPOINT,
	ANTIGRAVITY_GOOG_API_CLIENT,
	ANTIGRAVITY_LOAD_CODE_ASSIST_METADATA,
	ANTIGRAVITY_ONBOARD_ATTEMPTS,
	ANTIGRAVITY_ONBOARD_POLL_MS,
	ANTIGRAVITY_ONBOARD_USER_AGENT,
	ANTIGRAVITY_REDIRECT_URI,
	ANTIGRAVITY_SCOPES,
	ANTIGRAVITY_TOKEN_ENDPOINT,
	ANTIGRAVITY_USER_AGENT,
	ANTIGRAVITY_USERINFO_ENDPOINT,
	antigravityControlPlaneMetadata,
} from "./antigravityConstants";

/** HTTP 请求依赖。 */
export interface AntigravityEndpointOptions {
	/** 注入的 fetch；缺省使用全局 fetch。 */
	readonly fetch?: typeof fetch;
	/** 单次请求超时毫秒。 */
	readonly timeoutMs?: number;
}

/** onboarding 轮询依赖。 */
export interface AntigravityOnboardingOptions extends AntigravityEndpointOptions {
	/** 注入的休眠；缺省使用真实时钟。 */
	readonly sleep?: (ms: number) => Promise<void>;
	/** 轮询次数上限。 */
	readonly attempts?: number;
	/** 两次轮询之间的等待毫秒。 */
	readonly pollIntervalMs?: number;
}

/** 一次 OAuth 交换得到的 token 集合。 */
export interface AntigravityTokenSet {
	/** access token。 */
	readonly accessToken: string;
	/** 新签发的 refresh token；刷新时可能缺省。 */
	readonly refreshToken?: string;
	/** access token 有效期秒数。 */
	readonly expiresIn?: number;
}

/**
 * 生成 Google 授权 URL。
 *
 * 参数与 Go 的 `BuildAuthURL` 对齐（顺序按字典序），额外带上 PKCE challenge；
 * callback 由用户手动粘贴回来，所以不启动本地回调服务器。
 * @param state - OAuth state
 * @param codeChallenge - PKCE S256 challenge
 * @param redirectUri - 回调地址；缺省为 Go 使用的 localhost 回调
 */
export function buildAntigravityAuthUrl(state: string, codeChallenge: string, redirectUri: string = ANTIGRAVITY_REDIRECT_URI): string {
	const params = new URLSearchParams();
	params.set("access_type", "offline");
	params.set("client_id", ANTIGRAVITY_CLIENT_ID);
	params.set("code_challenge", codeChallenge);
	params.set("code_challenge_method", "S256");
	params.set("prompt", "consent");
	params.set("redirect_uri", redirectUri);
	params.set("response_type", "code");
	params.set("scope", ANTIGRAVITY_SCOPES.join(" "));
	params.set("state", state);
	return `${ANTIGRAVITY_AUTH_ENDPOINT}?${params.toString()}`;
}

/**
 * 用授权码换取 token。
 * @param code - Google 返回的授权码
 * @param codeVerifier - PKCE verifier
 * @param redirectUri - 与授权请求一致的回调地址
 * @param options - fetch/超时
 */
export async function exchangeAntigravityCode(
	code: string,
	codeVerifier: string,
	redirectUri: string,
	options: AntigravityEndpointOptions = {},
): Promise<AntigravityTokenSet> {
	const response = await postForm(
		ANTIGRAVITY_TOKEN_ENDPOINT,
		{
			client_id: ANTIGRAVITY_CLIENT_ID,
			client_secret: ANTIGRAVITY_CLIENT_SECRET,
			code: code,
			code_verifier: codeVerifier,
			grant_type: "authorization_code",
			redirect_uri: redirectUri,
		},
		{ fetch: options.fetch, timeoutMs: options.timeoutMs },
	);
	return readTokenSet(response, "Antigravity 授权码换取 token 失败");
}

/**
 * 用 refresh token 刷新 access token。
 * @param refreshToken - 已有 refresh token
 * @param options - fetch/超时
 */
export async function refreshAntigravityToken(
	refreshToken: string,
	options: AntigravityEndpointOptions = {},
): Promise<AntigravityTokenSet> {
	const response = await postForm(
		ANTIGRAVITY_TOKEN_ENDPOINT,
		{
			client_id: ANTIGRAVITY_CLIENT_ID,
			client_secret: ANTIGRAVITY_CLIENT_SECRET,
			grant_type: "refresh_token",
			refresh_token: refreshToken,
		},
		{ fetch: options.fetch, timeoutMs: options.timeoutMs },
	);
	return readTokenSet(response, "Antigravity token 刷新失败");
}

/**
 * 读取 Google 账号邮箱。
 * @param accessToken - access token
 * @param options - fetch/超时
 */
export async function fetchAntigravityEmail(accessToken: string, options: AntigravityEndpointOptions = {}): Promise<string> {
	const body = await getJson(
		ANTIGRAVITY_USERINFO_ENDPOINT,
		{ Authorization: `Bearer ${accessToken}`, "User-Agent": ANTIGRAVITY_USER_AGENT },
		{ fetch: options.fetch, timeoutMs: options.timeoutMs },
	);
	const email = trimmedString(body["email"]);
	if (!email) {
		throw new Error("Antigravity userinfo 响应缺少 email");
	}
	return email;
}

/**
 * 调用 loadCodeAssist，返回原始响应。
 * @param accessToken - access token
 * @param options - fetch/超时
 */
export async function loadAntigravityCodeAssist(
	accessToken: string,
	options: AntigravityEndpointOptions = {},
): Promise<Record<string, unknown>> {
	const url = `${ANTIGRAVITY_CLOUDCODE_ENDPOINT}/${ANTIGRAVITY_API_VERSION}:loadCodeAssist`;
	const response = await postJson(
		url,
		{ metadata: ANTIGRAVITY_LOAD_CODE_ASSIST_METADATA },
		{ Authorization: `Bearer ${accessToken}`, "User-Agent": ANTIGRAVITY_USER_AGENT },
		{ fetch: options.fetch, timeoutMs: options.timeoutMs },
	);
	return response;
}

/**
 * 调用 onboardUser 并轮询到完成为止。
 * @param accessToken - access token
 * @param tierId - loadCodeAssist 给出的默认 tier
 * @param options - fetch/休眠/轮询参数
 */
export async function onboardAntigravityUser(
	accessToken: string,
	tierId: string,
	options: AntigravityOnboardingOptions = {},
): Promise<string> {
	const sleep = options.sleep ?? defaultSleep;
	const attempts = options.attempts ?? ANTIGRAVITY_ONBOARD_ATTEMPTS;
	const pollIntervalMs = options.pollIntervalMs ?? ANTIGRAVITY_ONBOARD_POLL_MS;
	const url = `${ANTIGRAVITY_CLOUDCODE_ENDPOINT}/${ANTIGRAVITY_API_VERSION}:onboardUser`;
	const requestBody = {
		tier_id: tierId,
		metadata: antigravityControlPlaneMetadata(ANTIGRAVITY_CLIENT_VERSION),
	};
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		const response = await postJson(
			url,
			requestBody,
			{
				Accept: "*/*",
				Authorization: `Bearer ${accessToken}`,
				"User-Agent": ANTIGRAVITY_ONBOARD_USER_AGENT,
				"X-Goog-Api-Client": ANTIGRAVITY_GOOG_API_CLIENT,
			},
			{ fetch: options.fetch, timeoutMs: options.timeoutMs ?? 30_000 },
		);
		if (response["done"] === true) {
			const projectId = extractAntigravityProjectId(asRecord(response["response"]) ?? {});
			if (!projectId) {
				throw new Error("Antigravity onboardUser 响应缺少 project_id");
			}
			return projectId;
		}
		if (attempt < attempts) {
			await sleep(pollIntervalMs);
		}
	}
	throw new Error(`Antigravity onboardUser 在 ${attempts} 次尝试后仍未完成`);
}

/**
 * 获取账号的 GCP project：先 loadCodeAssist，缺 project 时回退 onboardUser。
 * @param accessToken - access token
 * @param options - fetch/休眠/轮询参数
 */
export async function requestAntigravityProjectId(accessToken: string, options: AntigravityOnboardingOptions = {}): Promise<string> {
	const loadResponse = await loadAntigravityCodeAssist(accessToken, options);
	const projectId = extractAntigravityProjectId(loadResponse);
	if (projectId) {
		return projectId;
	}
	const onboarded = await onboardAntigravityUser(accessToken, defaultAntigravityTierId(loadResponse), options);
	if (!onboarded) {
		throw new Error("Antigravity loadCodeAssist 与 onboardUser 都没有返回 project_id");
	}
	return onboarded;
}

/**
 * 从 loadCodeAssist / onboardUser 响应中提取 project ID。
 * @param data - 响应对象
 */
export function extractAntigravityProjectId(data: Record<string, unknown>): string {
	for (const key of ["cloudaicompanionProject", "projectId", "project"]) {
		const value = data[key];
		const direct = trimmedString(value);
		if (direct) {
			return direct;
		}
		const nested = asRecord(value);
		if (nested) {
			const id = trimmedString(nested["id"]);
			if (id) {
				return id;
			}
		}
	}
	return "";
}

/**
 * 选择 onboardUser 使用的 tier：优先 allowedTiers 的 isDefault，其次 currentTier。
 * @param loadResponse - loadCodeAssist 响应
 */
export function defaultAntigravityTierId(loadResponse: Record<string, unknown>): string {
	const tiers = loadResponse["allowedTiers"];
	if (Array.isArray(tiers)) {
		for (const rawTier of tiers) {
			const tier = asRecord(rawTier);
			if (!tier || tier["isDefault"] !== true) {
				continue;
			}
			const id = trimmedString(tier["id"]);
			if (id) {
				return id;
			}
		}
	}
	const currentTier = asRecord(loadResponse["currentTier"]);
	if (currentTier) {
		const id = trimmedString(currentTier["id"]);
		if (id) {
			return id;
		}
	}
	return "free-tier";
}

/**
 * 从 token 响应中读出需要的字段。
 * @param response - token 端点响应
 * @param failureMessage - access token 缺省时的错误前缀
 * @throws {Error} 响应缺少 access token 时抛出
 */
function readTokenSet(response: TokenEndpointResponse, failureMessage: string): AntigravityTokenSet {
	const accessToken = trimmedString(response.access_token);
	if (!accessToken) {
		throw new Error(`${failureMessage}：响应缺少 access_token`);
	}
	const refreshToken = trimmedString(response.refresh_token);
	const expiresIn = positiveNumber(response.expires_in);
	return { accessToken: accessToken, refreshToken: refreshToken, expiresIn: expiresIn };
}

/**
 * 默认休眠实现。
 * @param ms - 毫秒
 */
function defaultSleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 解析对象形状的 JSON。
 * @param value - 任意值
 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/**
 * 读取非空字符串。
 * @param value - 任意值
 */
function trimmedString(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed ? trimmed : undefined;
}

/**
 * 读取正数，兼容数字字符串。
 * @param value - 任意值
 */
function positiveNumber(value: unknown): number | undefined {
	const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
	return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
