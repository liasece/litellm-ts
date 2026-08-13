/** WebUI session JWT 与 cookie 生命周期工具。 */
import crypto from "node:crypto";
import type { Response } from "express";
import {
	WEBUI_COOKIE_TOKEN_NAME,
	WEBUI_CSRF_COOKIE_NAME,
	type WebUiSessionClaims,
} from "../types/webUiSession";

const SECURE_COOKIE_ENV_VAR = "LITELLM_COOKIE_SECURE";

/** 默认 3 天会话在剩余 1 天时续签；较短的自定义会话使用其时长的三分之一。 */
export const MAX_WEBUI_SESSION_REFRESH_THRESHOLD_SECONDS = 24 * 60 * 60;

/**
 * 计算滑动过期的续签阈值。
 * @param durationSeconds - 完整 session 时长
 */
export function getWebUiSessionRefreshThresholdSeconds(durationSeconds: number): number {
	return Math.max(1, Math.min(MAX_WEBUI_SESSION_REFRESH_THRESHOLD_SECONDS, Math.floor(durationSeconds / 3)));
}

/**
 * 当前 JWT 或服务端 session 任一临期时均应续签。
 * @param jwtExpiresAtSeconds
 * @param databaseExpiresAt
 * @param nowSeconds
 * @param refreshThresholdSeconds
 */
export function shouldRefreshWebUiSession(
	jwtExpiresAtSeconds: number,
	databaseExpiresAt: Date,
	nowSeconds: number,
	refreshThresholdSeconds: number,
): boolean {
	const effectiveExpiresAtSeconds = Math.min(jwtExpiresAtSeconds, Math.floor(databaseExpiresAt.getTime() / 1000));
	return effectiveExpiresAtSeconds - nowSeconds <= refreshThresholdSeconds;
}

/**
 * 用原 session 身份创建新的滑动过期 claims；jti 保持不变，以避免并发请求相互撤销。
 * @param claims
 * @param issuedAtSeconds
 * @param expiresAtSeconds
 */
export function refreshWebUiSessionClaims(
	claims: Record<string, unknown>,
	issuedAtSeconds: number,
	expiresAtSeconds: number,
): WebUiSessionClaims {
	return {
		...(claims as WebUiSessionClaims),
		iat: issuedAtSeconds,
		exp: expiresAtSeconds,
	};
}

/**
 * 使用 master key 签发 HS256 WebUI session JWT。
 * @param payload
 * @param secret
 */
export function signWebUiSessionToken(payload: WebUiSessionClaims, secret: string): string {
	const encodedHeader = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
	const encodedPayload = base64UrlEncode(JSON.stringify(payload));
	const signedData = `${encodedHeader}.${encodedPayload}`;
	const signature = crypto.createHmac("sha256", secret).update(signedData).digest("base64url");
	return `${signedData}.${signature}`;
}

/**
 * 同步写入 JWT 与 CSRF cookie，使二者拥有相同的滑动过期时间。
 * @param res
 * @param token
 * @param csrfToken
 * @param expiresAt
 */
export function setWebUiSessionCookies(
	res: Response,
	token: string,
	csrfToken: string,
	expiresAt: Date,
): void {
	const cookieOptions = {
		httpOnly: true,
		path: "/",
		sameSite: "lax" as const,
		secure: isProductionCookieSecure(),
		expires: expiresAt,
	};
	res.cookie(WEBUI_COOKIE_TOKEN_NAME, token, cookieOptions);
	res.cookie(WEBUI_CSRF_COOKIE_NAME, csrfToken, { ...cookieOptions, httpOnly: false });
}

/**
 * 清除 WebUI session 的两个 cookie。
 * @param res
 */
export function clearWebUiSessionCookies(res: Response): void {
	const options = { httpOnly: true, path: "/", sameSite: "lax" as const, secure: isProductionCookieSecure() };
	res.clearCookie(WEBUI_COOKIE_TOKEN_NAME, options);
	res.clearCookie(WEBUI_CSRF_COOKIE_NAME, { ...options, httpOnly: false });
}

function isProductionCookieSecure(): boolean {
	const raw = process.env[SECURE_COOKIE_ENV_VAR];
	return raw?.toLowerCase() === "true" || raw === "1";
}

function base64UrlEncode(value: string): string {
	return Buffer.from(value, "utf8").toString("base64url");
}
