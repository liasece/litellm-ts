/** WebUI username/password 登录与服务端 session 生命周期。 */
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import type { RequestHandler, Response, Router } from "express";
import type { AuthRepository } from "../auth/AuthRepository";
import { ApiError } from "../core/api/ApiError";
import { registerRoute } from "../core/api/registerRoute";
import type { ServiceConfig } from "../core/config";
import type { DrizzleDb } from "../core/db/Database";
import { hashApiKey } from "../core/utils/crypto";
import { LiteLLM_VerificationToken } from "../db/schema/verification-tokens";
import {
	DEFAULT_WEBUI_SESSION_DURATION,
	LOGIN_METHOD_USERNAME_PASSWORD,
	PROXY_ADMIN_ROLE,
	PROXY_ADMIN_USER_ID,
	WEBUI_COOKIE_TOKEN_NAME,
	WEBUI_CSRF_COOKIE_NAME,
	WEBUI_LOGIN_TEAM_ID,
	WEBUI_SESSION_DURATION_ENV_VAR,
	type WebUiSessionClaims,
	type WebUiSessionInfo,
} from "../types/webUiSession";

const DEFAULT_UI_USERNAME = "admin";
const SECURE_COOKIE_ENV_VAR = "LITELLM_COOKIE_SECURE";
const MAX_SESSION_GEN_RETRIES = 3;
const DURATION_PATTERN = /^(\d+)(s|m|h|d)$/;

interface LoginRequestBody {
	readonly username?: unknown;
	readonly password?: unknown;
}

interface LoginResponse {
	readonly redirect_url: string;
}

/**
 * 注册公开登录路由，以及在依赖可用时注册 session 查询和注销路由。
 * @param router
 * @param config
 * @param db
 * @param authMiddleware
 * @param csrfMiddleware
 * @param authRepository
 */
export function registerLoginRoutes(
	router: Router,
	config: ServiceConfig,
	db: DrizzleDb,
	authMiddleware?: RequestHandler,
	csrfMiddleware?: RequestHandler,
	authRepository?: AuthRepository,
): void {
	registerRoute(router, { method: "post", path: "/login" }, (req, res) => loginV2(req.body as LoginRequestBody, res, config, db));
	registerRoute(router, { method: "post", path: "/v2/login" }, (req, res) => loginV2(req.body as LoginRequestBody, res, config, db));
	registerRoute(router, { method: "post", path: "/v3/login" }, () => {
		throw ApiError.unavailable("Login v3 not implemented");
	});

	if (authMiddleware && csrfMiddleware && authRepository) {
		router.get("/auth/session", authMiddleware, (req, res) => {
			res.json(createSessionInfo(req.auth?.metadata));
		});
		router.post("/auth/logout", authMiddleware, csrfMiddleware, async (req, res, next) => {
			try {
				if (!req.auth?.token || req.auth.metadata?.webui_session !== true) {
					throw ApiError.unauthorized("WebUI session required");
				}
				await authRepository.revokeVerificationTokenByHash(req.auth.token);
				clearSessionCookies(res);
				res.json({ status: "success" });
			} catch (error) {
				next(error);
			}
		});
	}
}

async function loginV2(body: LoginRequestBody, res: Response, config: ServiceConfig, db: DrizzleDb): Promise<LoginResponse> {
	const username = typeof body.username === "string" ? body.username : "";
	const password = typeof body.password === "string" ? body.password : "";
	const masterKey = config.generalSettings.master_key;
	const uiUsername = process.env.UI_USERNAME ?? DEFAULT_UI_USERNAME;
	const uiPassword = process.env.UI_PASSWORD ?? masterKey;

	if (!masterKey) {
		throw ApiError.unavailable("Master Key not set for Proxy. Please set Master Key to use Admin UI.");
	}
	if (!uiPassword) {
		throw ApiError.unavailable("set Proxy master key to use UI.");
	}
	if (!timingSafeEqual(username, uiUsername) || !timingSafeEqual(password, uiPassword)) {
		throw ApiError.unauthorized("Invalid username or password");
	}

	const durationSeconds = parseSessionDuration(process.env[WEBUI_SESSION_DURATION_ENV_VAR] ?? DEFAULT_WEBUI_SESSION_DURATION);
	const issuedAtSeconds = Math.floor(Date.now() / 1000);
	const expiresAtSeconds = issuedAtSeconds + durationSeconds;
	const expiresAt = new Date(expiresAtSeconds * 1000);
	const jti = await issueWebUiSession(db, expiresAt);
	const sessionClaims = createWebUiSessionClaims(config, jti, issuedAtSeconds, expiresAtSeconds);
	const jwtToken = signHs256(sessionClaims, masterKey);
	const secure = isProductionCookieSecure();
	const cookieOptions = {
		httpOnly: true,
		path: "/",
		sameSite: "lax" as const,
		secure: secure,
		expires: expiresAt,
	};
	res.cookie(WEBUI_COOKIE_TOKEN_NAME, jwtToken, cookieOptions);
	res.cookie(WEBUI_CSRF_COOKIE_NAME, crypto.randomBytes(32).toString("base64url"), {
		...cookieOptions,
		httpOnly: false,
	});

	return { redirect_url: "/ui/?login=success" };
}

async function issueWebUiSession(db: DrizzleDb, expiresAt: Date): Promise<string> {
	for (let attempt = 0; attempt < MAX_SESSION_GEN_RETRIES; attempt++) {
		const jti = crypto.randomBytes(32).toString("base64url");
		const tokenHash = hashApiKey(jti);
		const existing = await db
			.select({ token: LiteLLM_VerificationToken.token })
			.from(LiteLLM_VerificationToken)
			.where(eq(LiteLLM_VerificationToken.token, tokenHash))
			.limit(1);
		if (existing.length > 0) {
			continue;
		}
		await db.insert(LiteLLM_VerificationToken).values({
			token: tokenHash,
			keyAlias: "webui-session",
			keyName: "WebUI Session",
			userId: PROXY_ADMIN_USER_ID,
			teamId: WEBUI_LOGIN_TEAM_ID,
			expires: expiresAt,
			metadata: { login_method: LOGIN_METHOD_USERNAME_PASSWORD, webui_session: true },
			models: [],
			blocked: false,
		});
		return jti;
	}
	throw ApiError.unavailable("Failed to issue WebUI session after retries");
}

/**
 * 解析 LiteLLM duration：30s、30m、24h、7d。
 * @param raw - duration 配置值
 * @returns duration 秒数
 * @throws {ApiError} 配置格式非法或数值非正数
 */
export function parseSessionDuration(raw: string): number {
	const match = DURATION_PATTERN.exec(raw.trim());
	if (!match) {
		throw ApiError.unavailable(`${WEBUI_SESSION_DURATION_ENV_VAR} must use 30s, 30m, 24h, or 7d format`);
	}
	const value = Number(match[1]);
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw ApiError.unavailable(`${WEBUI_SESSION_DURATION_ENV_VAR} must be positive`);
	}
	const multipliers = { s: 1, m: 60, h: 3600, d: 86400 } as const;
	return value * multipliers[match[2] as keyof typeof multipliers];
}

function isProductionCookieSecure(): boolean {
	const raw = process.env[SECURE_COOKIE_ENV_VAR];
	return raw?.toLowerCase() === "true" || raw === "1";
}

function createWebUiSessionClaims(
	config: ServiceConfig,
	jti: string,
	issuedAtSeconds: number,
	expiresAtSeconds: number,
): WebUiSessionClaims {
	return {
		user_id: PROXY_ADMIN_USER_ID,
		user_email: null,
		user_role: PROXY_ADMIN_ROLE,
		login_method: LOGIN_METHOD_USERNAME_PASSWORD,
		premium_user: true,
		disabled_non_admin_personal_key_creation: false,
		server_root_path: getStringSetting(config.generalSettingsRaw, "server_root_path") ?? "/",
		webui_session: true,
		iat: issuedAtSeconds,
		exp: expiresAtSeconds,
		jti: jti,
	};
}

function createSessionInfo(metadata: Record<string, unknown> | undefined): WebUiSessionInfo {
	if (metadata?.webui_session !== true) {
		throw ApiError.unauthorized("WebUI session required");
	}
	return {
		authenticated: true,
		user_id: asString(metadata.user_id) ?? PROXY_ADMIN_USER_ID,
		user_email: asString(metadata.user_email) ?? null,
		user_role: asString(metadata.user_role) ?? PROXY_ADMIN_ROLE,
		login_method: asString(metadata.login_method) ?? LOGIN_METHOD_USERNAME_PASSWORD,
		premium_user: metadata.premium_user === true,
		disabled_non_admin_personal_key_creation: metadata.disabled_non_admin_personal_key_creation === true,
		server_root_path: asString(metadata.server_root_path) ?? "/",
	};
}

function clearSessionCookies(res: Response): void {
	const options = { httpOnly: true, path: "/", sameSite: "lax" as const, secure: isProductionCookieSecure() };
	res.clearCookie(WEBUI_COOKIE_TOKEN_NAME, options);
	res.clearCookie(WEBUI_CSRF_COOKIE_NAME, { ...options, httpOnly: false });
}

function getStringSetting(settings: Record<string, unknown> | undefined, key: string): string | undefined {
	return asString(settings?.[key]);
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function timingSafeEqual(left: string, right: string): boolean {
	const leftBuffer = Buffer.from(left, "utf8");
	const rightBuffer = Buffer.from(right, "utf8");
	return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function signHs256(payload: WebUiSessionClaims, secret: string): string {
	const encodedHeader = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
	const encodedPayload = base64UrlEncode(JSON.stringify(payload));
	const signedData = `${encodedHeader}.${encodedPayload}`;
	const signature = crypto.createHmac("sha256", secret).update(signedData).digest("base64url");
	return `${signedData}.${signature}`;
}

function base64UrlEncode(value: string): string {
	return Buffer.from(value, "utf8").toString("base64url");
}
