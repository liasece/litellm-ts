/**
 * xAI OAuth 的发现端点、设备码、身份解析、文件名与低层 HTTP 工具。
 *
 * 端点、client_id、scope、轮询上限均对齐 Go 版 CLIProxyAPI `internal/auth/xai`：
 * 先通过 OIDC discovery 解析设备授权与 token 端点，再按 RFC 8628 轮询授权。
 */

import { createHash } from "node:crypto";
import { ApiError } from "../../../core/api/ApiError";
import { parseJwtPayload } from "./http";

/** xAI OAuth 使用的上游端点与参数。 */
export const XAI_OAUTH = {
	/** OAuth issuer。 */
	issuer: "https://auth.x.ai",
	/** OIDC discovery 地址。 */
	discoveryUrl: "https://auth.x.ai/.well-known/openid-configuration",
	/** Grok CLI 公共 client_id。 */
	clientId: "b1a00492-073a-47ea-816f-4c329264a828",
	/** 设备码与 API 访问 scope。 */
	scope: "openid profile email offline_access grok-cli:access api:access",
	/** RFC 8628 设备码 grant type。 */
	deviceGrantType: "urn:ietf:params:oauth:grant-type:device_code",
	/** 默认 API base URL。 */
	defaultApiBaseUrl: "https://api.x.ai/v1",
	/** 设备码默认轮询间隔（毫秒）。 */
	defaultPollIntervalMs: 5_000,
	/** 等待用户授权的上限（毫秒）。 */
	maxPollDurationMs: 30 * 60 * 1000,
	/** access_token 到期前的刷新提前量（毫秒）。 */
	refreshLeadMs: 5 * 60 * 1000,
} as const;

/** 通过 OIDC discovery 解析出的 xAI OAuth 端点。 */
export interface XaiDiscovery {
	/** 设备授权端点。 */
	readonly deviceAuthorizationEndpoint: string;
	/** token 端点。 */
	readonly tokenEndpoint: string;
}

/** 从 id_token 中解析出的 xAI 身份。 */
export interface XaiIdentity {
	/** 账号邮箱。 */
	readonly email?: string;
	/** 账号 subject。 */
	readonly subject?: string;
}

/** 一次原始 JSON 请求的结果；用于识别设备码轮询的 pending 状态。 */
export interface XaiJsonResponse {
	/** HTTP 状态码。 */
	readonly status: number;
	/** 是否 2xx。 */
	readonly ok: boolean;
	/** 解析后的 JSON 对象；非 JSON 响应为空对象。 */
	readonly body: Record<string, unknown>;
	/** 原始响应文本。 */
	readonly text: string;
}

/** 原始 HTTP 请求选项。 */
export interface XaiRequestOptions {
	/** 注入的 fetch；缺省使用全局 fetch。 */
	readonly fetch?: typeof fetch;
	/** 超时毫秒；缺省 30 秒。 */
	readonly timeoutMs?: number;
}

/**
 * 判断值是否为普通对象。
 * @param value - 待判定值
 */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 读取非空字符串。
 * @param value - 原始值
 */
export function nonEmptyXaiString(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed ? trimmed : undefined;
}

/**
 * 校验 discovery 返回的 OAuth 端点：必须是 https 且位于 x.ai 域。
 *
 * `allowInsecure` 只用于本地测试注入；生产调用始终走严格校验。
 * @param rawUrl - 端点
 * @param field - 字段名，用于错误信息
 * @param allowInsecure - 是否允许 http/非 x.ai 主机
 * @throws {ApiError} 端点缺失或不合法
 */
export function validateXaiEndpoint(rawUrl: string, field: string, allowInsecure = false): string {
	const trimmed = rawUrl.trim();
	if (!trimmed) {
		throw ApiError.unavailable(`xAI discovery 缺少 ${field}`);
	}
	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		throw ApiError.unavailable(`xAI discovery 的 ${field} 不是合法 URL`);
	}
	if (!allowInsecure) {
		const host = parsed.hostname.toLowerCase();
		const loopback = host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
		if (parsed.protocol === "http:" && loopback) {
			return trimmed;
		}
		if (parsed.protocol !== "https:") {
			throw ApiError.unavailable(`xAI discovery 的 ${field} 必须使用 https`);
		}
		if (host !== "x.ai" && !host.endsWith(".x.ai")) {
			throw ApiError.unavailable(`xAI discovery 的 ${field} 主机不在 x.ai 域`);
		}
	}
	return trimmed;
}

/**
 * 发起一次原始 HTTP 请求并尽力解析 JSON。
 * @param url - 端点
 * @param init - fetch init
 * @param options - 超时/fetch
 */
export async function requestXaiJson(
	url: string,
	init: RequestInit,
	options: XaiRequestOptions = {},
): Promise<XaiJsonResponse> {
	const fetchImpl = options.fetch ?? fetch;
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);
	try {
		const response = await fetchImpl(url, { ...init, signal: controller.signal });
		const text = await response.text().catch(() => "");
		let body: Record<string, unknown> = {};
		if (text.trim()) {
			try {
				const parsed: unknown = JSON.parse(text);
				if (isRecord(parsed)) {
					body = parsed;
				}
			} catch {
				body = {};
			}
		}
		return { status: response.status, ok: response.ok, body: body, text: text };
	} finally {
		clearTimeout(timeout);
	}
}

/**
 * 解析 xAI OAuth 端点。
 *
 * 显式注入的端点优先（测试/私有部署），否则请求 OIDC discovery 并校验
 * `device_authorization_endpoint` 与 `token_endpoint`。校验规则与 Go 一致。
 * @param options - discovery 地址、覆盖端点与 HTTP 选项
 * @throws {ApiError} discovery 失败或端点不合法
 */
export async function discoverXaiEndpoints(
	options: {
		/** discovery 地址。 */
		readonly discoveryUrl: string;
		/** 显式设备授权端点。 */
		readonly deviceAuthorizationEndpoint?: string;
		/** 显式 token 端点。 */
		readonly tokenEndpoint?: string;
		/** 是否允许非 https/非 x.ai 端点（仅测试）。 */
		readonly allowInsecure?: boolean;
	} & XaiRequestOptions,
): Promise<XaiDiscovery> {
	const allowInsecure = options.allowInsecure === true;
	if (options.deviceAuthorizationEndpoint && options.tokenEndpoint) {
		return {
			deviceAuthorizationEndpoint: validateXaiEndpoint(
				options.deviceAuthorizationEndpoint,
				"device_authorization_endpoint",
				allowInsecure,
			),
			tokenEndpoint: validateXaiEndpoint(options.tokenEndpoint, "token_endpoint", allowInsecure),
		};
	}
	const response = await requestXaiJson(
		options.discoveryUrl,
		{ method: "GET", headers: { Accept: "application/json" } },
		{ fetch: options.fetch, timeoutMs: options.timeoutMs },
	);
	if (!response.ok) {
		throw ApiError.unavailable(`xAI OIDC discovery 失败（HTTP ${response.status}）`);
	}
	return {
		deviceAuthorizationEndpoint: validateXaiEndpoint(
			typeof response.body["device_authorization_endpoint"] === "string"
				? response.body["device_authorization_endpoint"]
				: "",
			"device_authorization_endpoint",
			allowInsecure,
		),
		tokenEndpoint: validateXaiEndpoint(
			typeof response.body["token_endpoint"] === "string" ? response.body["token_endpoint"] : "",
			"token_endpoint",
			allowInsecure,
		),
	};
}

/**
 * 从 xAI id_token 中解析邮箱与 subject；缺少或非 JWT 时返回空身份。
 * @param idToken - OAuth id_token
 */
export function xaiIdentityFromToken(idToken?: string): XaiIdentity {
	const claims = idToken ? parseJwtPayload(idToken) : undefined;
	if (!claims) {
		return {};
	}
	return {
		email: nonEmptyXaiString(claims["email"]),
		subject: nonEmptyXaiString(claims["sub"]),
	};
}

/**
 * 按 Go `sanitizeFileSegment` 清洗文件名片段：只保留字母数字与 `@._-`，
 * 其他字符替换为 `-`，并去掉首尾 `-`。
 * @param value - 原始片段
 */
function sanitizeFileSegment(value: string): string {
	return value
		.trim()
		.replace(/[^A-Za-z0-9@._-]/g, "-")
		.replace(/^-+|-+$/g, "");
}

/**
 * 截断文件名片段，避免超过常见文件系统组件长度限制。
 * @param value - 片段
 * @param limit - 最大字符数
 */
function truncateSegment(value: string, limit: number): string {
	const characters = Array.from(value);
	return characters.length > limit ? characters.slice(0, limit).join("") : value;
}

/**
 * 生成 xAI 账号文件名。
 *
 * 格式与 Go 一致：`xai-<email>-<identity hash>.json`；没有邮箱时用 subject，
 * 两者都没有时退化为时间戳。邮箱大小写不敏感，哈希只覆盖归一化后的身份。
 * @param email - 账号邮箱
 * @param subject - 账号 subject
 */
export function xaiCredentialFileName(email: string, subject: string): string {
	const cleanEmail = email.trim();
	if (cleanEmail) {
		const normalizedEmail = cleanEmail.toLowerCase();
		const sanitized = truncateSegment(sanitizeFileSegment(normalizedEmail) || "account", 120);
		const digest = createHash("sha256").update(`email\u0000${normalizedEmail}`).digest("hex").slice(0, 16);
		return `xai-${sanitized}-${digest}.json`;
	}
	const cleanSubject = subject.trim();
	if (cleanSubject) {
		const sanitized = truncateSegment(sanitizeFileSegment(cleanSubject) || "account", 120);
		const digest = createHash("sha256").update(`subject\u0000${cleanSubject}`).digest("hex").slice(0, 16);
		return `xai-${sanitized}-${digest}.json`;
	}
	return `xai-${Date.now()}.json`;
}

/**
 * 按 Go RFC3339 输出时间；去掉毫秒。
 * @param timeMs - 毫秒时间戳
 */
export function formatXaiRfc3339(timeMs: number): string {
	return new Date(timeMs).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * 读取 xAI auth JSON 中的 access_token 到期时间。
 * @param raw - auth JSON
 */
export function xaiExpiryMs(raw: Record<string, unknown>): number | undefined {
	for (const key of ["expires_at", "expired", "expiry"]) {
		const value = raw[key];
		if (typeof value === "number" && Number.isFinite(value)) {
			return value > 10_000_000_000 ? value : value * 1000;
		}
		if (typeof value === "string" && value.trim()) {
			const parsed = Date.parse(value);
			if (Number.isFinite(parsed)) {
				return parsed;
			}
		}
	}
	const accessToken = nonEmptyXaiString(raw["access_token"]);
	const payload = accessToken ? parseJwtPayload(accessToken) : undefined;
	const exp = payload?.["exp"];
	if (typeof exp === "number" && Number.isFinite(exp)) {
		return exp * 1000;
	}
	return undefined;
}

/**
 * 计算新 access_token 的到期时间；`expires_in` 缺失时回退到 JWT exp，
 * 最后使用一小时兜底。
 * @param response - token 端点响应
 * @param accessToken - 新 access_token
 * @param nowMs - 当前时间
 */
export function xaiTokenExpiryMs(response: Record<string, unknown>, accessToken: string, nowMs: number): number {
	const expiresIn = response["expires_in"];
	if (typeof expiresIn === "number" && Number.isFinite(expiresIn) && expiresIn > 0) {
		return nowMs + expiresIn * 1000;
	}
	const payload = parseJwtPayload(accessToken);
	const exp = payload?.["exp"];
	if (typeof exp === "number" && Number.isFinite(exp)) {
		return exp * 1000;
	}
	return nowMs + 60 * 60 * 1000;
}

/**
 * 解析设备授权响应的 interval；兼容秒数字符串。
 * @param value - interval 原始值
 */
export function xaiDeviceIntervalMs(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value) && value > 0) {
		return value * 1000;
	}
	if (typeof value === "string" && value.trim()) {
		const parsed = Number(value.trim());
		if (Number.isFinite(parsed) && parsed > 0) {
			return parsed * 1000;
		}
	}
	return undefined;
}
