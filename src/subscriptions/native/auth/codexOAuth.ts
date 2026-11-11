/**
 * Codex OAuth 的端点、身份解析、文件名与低层 HTTP 工具。
 *
 * 常量与字段行为对齐 Go 版 CLIProxyAPI `internal/auth/codex`：
 * 授权码登录使用 `auth.openai.com/oauth/*`，设备码登录使用
 * `auth.openai.com/api/accounts/deviceauth/*` 并在成功后走同一 token 端点。
 * 这里只处理网络与格式，不打印任何 token。
 */

import { createHash } from "node:crypto";
import { ApiError } from "../../../core/api/ApiError";
import { parseJwtPayload } from "./http";

/** Codex OAuth 使用的上游端点与参数。 */
export const CODEX_OAUTH = {
	/** 浏览器授权地址。 */
	authUrl: "https://auth.openai.com/oauth/authorize",
	/** 授权码/刷新 token 端点。 */
	tokenUrl: "https://auth.openai.com/oauth/token",
	/** Codex CLI 公共 client_id。 */
	clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
	/** 浏览器授权回调地址。 */
	redirectUri: "http://localhost:1455/auth/callback",
	/** 浏览器授权 scope。 */
	scope: "openid email profile offline_access",
	/** 刷新 token 时提交的 scope。 */
	refreshScope: "openid profile email",
	/** 设备码申请地址。 */
	deviceUserCodeUrl: "https://auth.openai.com/api/accounts/deviceauth/usercode",
	/** 设备码轮询地址。 */
	deviceTokenUrl: "https://auth.openai.com/api/accounts/deviceauth/token",
	/** 设备码输入页面。 */
	deviceVerificationUrl: "https://auth.openai.com/codex/device",
	/** 设备码换 token 时声明的回调地址。 */
	deviceRedirectUri: "https://auth.openai.com/deviceauth/callback",
	/** 设备码默认轮询间隔（毫秒）。 */
	deviceDefaultPollIntervalMs: 5_000,
	/** 设备码等待授权的上限（毫秒），对齐 Go 的 15 分钟。 */
	deviceTimeoutMs: 15 * 60 * 1000,
	/** access_token 到期前的刷新提前量（毫秒）。 */
	refreshLeadMs: 5 * 60 * 1000,
	/** SIWC token 端点。 */
	siwcTokenUrl: "https://auth.openai.com/api/accounts/oauth/token",
	/** SIWC token 请求资源。 */
	siwcResource: "https://api.openai.com/v1",
	/** SIWC direct token scope。 */
	siwcDirectScope: "chatgpt.tokens.use.direct",
	/** SIWC access_token 到期前提前量（毫秒）。 */
	siwcExpiryMarginMs: 3 * 60 * 1000,
} as const;

/** 从 Codex JWT 中解析出的账号身份。 */
export interface CodexIdentity {
	/** ChatGPT 账号 ID。 */
	readonly accountId?: string;
	/** 账号邮箱。 */
	readonly email?: string;
	/** 订阅套餐。 */
	readonly planType?: string;
}

/** 一次原始 JSON 请求的结果；用于需要读取非 2xx 状态的设备码轮询。 */
export interface AuthJsonResponse {
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
export interface AuthRequestOptions {
	/** 注入的 fetch；缺省使用全局 fetch。 */
	readonly fetch?: typeof fetch;
	/** 超时毫秒；缺省 30 秒。 */
	readonly timeoutMs?: number;
}

/** OpenAI ID token 中携带账号信息的命名空间 claim。 */
const AUTH_CLAIM = "https://api.openai.com/auth";

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
function nonEmptyString(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed ? trimmed : undefined;
}

/**
 * 从 id_token/access_token 中解析 Codex 账号身份。
 *
 * 优先使用 id_token，缺失时回退到 access_token；两者都只解析 payload，
 * 不校验签名。字段读取路径与 Go 的 `JWTClaims` 一致。
 * @param idToken - OAuth id_token
 * @param accessToken - OAuth access_token
 */
export function codexIdentityFromTokens(idToken?: string, accessToken?: string): CodexIdentity {
	const claims = (idToken ? parseJwtPayload(idToken) : undefined) ?? (accessToken ? parseJwtPayload(accessToken) : undefined);
	if (!claims) {
		return {};
	}
	const auth = isRecord(claims[AUTH_CLAIM]) ? (claims[AUTH_CLAIM] as Record<string, unknown>) : {};
	const accountId = nonEmptyString(auth["chatgpt_account_id"]);
	const email = nonEmptyString(claims["email"]);
	const planType = nonEmptyString(auth["chatgpt_plan_type"]);
	return {
		accountId: accountId,
		email: email,
		planType: planType,
	};
}

/**
 * 按 Go `normalizePlanTypeForFilename` 归一化套餐名：只保留字母/数字，
 * 其余字符作为分隔符，最后转为小写并用 `-` 连接。
 * @param planType - 原始套餐名
 */
export function normalizeCodexPlanForFilename(planType: string): string {
	return planType
		.trim()
		.split(/[^\p{L}\p{N}]+/u)
		.filter((part) => part.length > 0)
		.map((part) => part.toLowerCase())
		.join("-");
}

/**
 * 生成 Codex 账号文件名。
 *
 * 格式与 Go `CredentialFileName` 一致：`codex-<accountId hash8>-<email>-<plan>.json`；
 * 没有账号 ID 时退化为 `codex-<email>-<plan>.json`。邮箱中的路径分隔符与
 * 控制字符会被替换，避免写出 auth 目录。
 * @param email - 账号邮箱
 * @param planType - 套餐名
 * @param accountId - ChatGPT 账号 ID
 */
export function codexCredentialFileName(email: string, planType: string, accountId: string): string {
	const safeEmail = email.trim().replace(/[\\/\p{Cc}]/gu, "-");
	const plan = normalizeCodexPlanForFilename(planType);
	const digest = accountId.trim() ? createHash("sha256").update(accountId.trim()).digest("hex").slice(0, 8) : "";
	if (digest) {
		return plan ? `codex-${digest}-${safeEmail}-${plan}.json` : `codex-${digest}-${safeEmail}.json`;
	}
	return plan ? `codex-${safeEmail}-${plan}.json` : `codex-${safeEmail}.json`;
}

/**
 * 按 Go RFC3339 输出时间；去掉毫秒，保持与旧镜像写出的格式一致。
 * @param timeMs - 毫秒时间戳
 */
export function formatRfc3339(timeMs: number): string {
	return new Date(timeMs).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * 读取 auth JSON 中的 access_token 到期时间。
 *
 * 兼容 `expires_at` / `expired` / `expiry`，数字按秒或毫秒识别；
 * 最后回退到 access_token 自身的 `exp` claim。
 * @param raw - auth JSON
 */
export function codexExpiryMs(raw: Record<string, unknown>): number | undefined {
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
	const accessToken = nonEmptyString(raw["access_token"]);
	const payload = accessToken ? parseJwtPayload(accessToken) : undefined;
	const exp = payload?.["exp"];
	if (typeof exp === "number" && Number.isFinite(exp)) {
		return exp * 1000;
	}
	return undefined;
}

/**
 * 计算新 access_token 的到期时间。
 *
 * `expires_in` 为 Go 实现的主来源；缺失时回退到 token 的 `exp` claim，
 * 最后使用一小时兜底，避免写出“立即过期”的时间。
 * @param response - token 端点响应
 * @param accessToken - 新 access_token
 * @param nowMs - 当前时间
 */
export function codexTokenExpiryMs(response: Record<string, unknown>, accessToken: string, nowMs: number): number {
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
 * 发起一次原始 HTTP 请求并尽力解析 JSON。
 *
 * 与 `http.ts` 的 POST 工具不同，这里把非 2xx 作为结果返回，供设备码轮询
 * 识别 403/404 的“仍在等待授权”状态。
 * @param url - 端点
 * @param init - fetch init
 * @param options - 超时/fetch
 */
export async function requestAuthJson(url: string, init: RequestInit, options: AuthRequestOptions = {}): Promise<AuthJsonResponse> {
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
 * 解析用户粘贴的回调 URL 或授权码。
 *
 * 回调 URL 必须带 `code`；若带 `state` 则必须与本次登录一致。
 * 错误参数会转成可读的 400。
 * @param input - 用户输入
 * @param expectedState - 本次登录的 OAuth state
 * @throws {ApiError} 输入为空、回调带错误参数、state 不匹配或缺少授权码
 */
export function parseCodexCallbackInput(input: string, expectedState: string): string {
	const trimmed = input.trim();
	if (!trimmed) {
		throw ApiError.badRequest("请输入 OpenAI 回调 URL 或授权码");
	}
	let url: URL;
	try {
		url = new URL(trimmed);
	} catch {
		return trimmed;
	}
	const error = nonEmptyString(url.searchParams.get("error"));
	if (error) {
		const description = nonEmptyString(url.searchParams.get("error_description"));
		throw ApiError.badRequest(`OpenAI 授权失败：${description ?? error}`);
	}
	const state = nonEmptyString(url.searchParams.get("state"));
	if (state && expectedState && state !== expectedState) {
		throw ApiError.badRequest("OpenAI 回调 state 与本次登录不匹配，请重新登录");
	}
	if (!state && expectedState) {
		throw ApiError.badRequest("OpenAI 回调 URL 缺少 state，请完整复制回调地址");
	}
	const code = nonEmptyString(url.searchParams.get("code"));
	if (!code) {
		throw ApiError.badRequest("OpenAI 回调 URL 缺少 authorization code");
	}
	return code;
}
