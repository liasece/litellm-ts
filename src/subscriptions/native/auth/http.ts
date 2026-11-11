/**
 * OAuth/设备码流程共用的 HTTP 与编码工具。
 */

import { createHash, randomBytes } from "node:crypto";

/** token 端点返回的通用字段。 */
export interface TokenEndpointResponse {
	/** access token。 */
	readonly access_token?: string;
	/** refresh token。 */
	readonly refresh_token?: string;
	/** 到期秒数。 */
	readonly expires_in?: number;
	/** token 类型。 */
	readonly token_type?: string;
	/** 作用域。 */
	readonly scope?: string;
	/** OAuth 错误码。 */
	readonly error?: string;
	/** OAuth 错误描述。 */
	readonly error_description?: string;
	/** 其他字段。 */
	readonly [key: string]: unknown;
}

/** HTTP 请求选项。 */
export interface AuthHttpOptions {
	/** 超时毫秒。 */
	readonly timeoutMs?: number;
	/** 注入的 fetch。 */
	readonly fetch?: typeof fetch;
	/** 可重试失败的额外次数；缺省 1 次。 */
	readonly retries?: number;
}

/**
 * 以 application/x-www-form-urlencoded 提交并解析 JSON。
 * @param url - 端点
 * @param form - 表单字段
 * @param options - 超时/fetch
 */
export async function postForm(url: string, form: Record<string, string>, options: AuthHttpOptions = {}): Promise<TokenEndpointResponse> {
	const response = await request(
		url,
		{
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
			body: new URLSearchParams(form).toString(),
		},
		options,
	);
	return (await response.json()) as TokenEndpointResponse;
}

/**
 * 以 JSON 提交并解析 JSON。
 * @param url - 端点
 * @param body - JSON 体
 * @param headers - 额外请求头
 * @param options - 超时/fetch
 */
export async function postJson(
	url: string,
	body: unknown,
	headers: Record<string, string> = {},
	options: AuthHttpOptions = {},
): Promise<TokenEndpointResponse> {
	const response = await request(
		url,
		{
			method: "POST",
			headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
			body: JSON.stringify(body),
		},
		options,
	);
	return (await response.json()) as TokenEndpointResponse;
}

/**
 * GET JSON。
 * @param url - 端点
 * @param headers - 请求头
 * @param options - 超时/fetch
 */
export async function getJson(
	url: string,
	headers: Record<string, string> = {},
	options: AuthHttpOptions = {},
): Promise<Record<string, unknown>> {
	const response = await request(url, { method: "GET", headers: { Accept: "application/json", ...headers } }, options);
	const parsed: unknown = await response.json();
	return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
}

/**
 * 发起请求并把非 2xx 转成包含正文的错误。
 * @param url - 端点
 * @param init - fetch init
 * @param options - 超时/fetch
 */
async function request(url: string, init: RequestInit, options: AuthHttpOptions): Promise<Response> {
	const fetchImpl = options.fetch ?? fetch;
	const attempts = Math.max(1, Math.trunc(options.retries ?? 1) + 1);
	for (let attempt = 0; attempt < attempts; attempt += 1) {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);
		let response: Response;
		try {
			response = await fetchImpl(url, { ...init, signal: controller.signal });
		} catch (error) {
			clearTimeout(timeout);
			const timedOut = error instanceof Error && error.name === "AbortError";
			if (attempt + 1 < attempts && !timedOut) {
				await new Promise<void>((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
				continue;
			}
			throw error;
		} finally {
			clearTimeout(timeout);
		}
		if (response.ok) {
			return response;
		}
		const text = await response.text().catch(() => "");
		if ((response.status >= 500 || response.status === 429) && attempt + 1 < attempts) {
			await new Promise<void>((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
			continue;
		}
		throw new Error(`HTTP ${response.status} ${url}: ${text.slice(0, 500)}`);
	}
	throw new Error(`HTTP 请求失败：${url}`);
}

/**
 * 解析 JWT payload，不校验签名。
 * @param token - JWT
 */
export function parseJwtPayload(token: string): Record<string, unknown> | undefined {
	const parts = token.split(".");
	if (parts.length < 2 || !parts[1]) {
		return undefined;
	}
	try {
		const parsed: unknown = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
	} catch {
		return undefined;
	}
}

/** PKCE 参数。 */
export interface PkcePair {
	/** code_verifier。 */
	readonly verifier: string;
	/** S256 code_challenge。 */
	readonly challenge: string;
}

/**
 * 生成 PKCE verifier/challenge。
 */
export function createPkce(): PkcePair {
	const verifier = randomBytes(48).toString("base64url");
	const challenge = createHash("sha256").update(verifier).digest("base64url");
	return { verifier: verifier, challenge: challenge };
}

/**
 * 生成 OAuth state。
 */
export function createState(): string {
	return randomBytes(24).toString("base64url");
}

/**
 * 从用户粘贴的回调 URL 或授权码中提取 code。
 * @param input - 完整回调 URL 或 code
 */
export function extractAuthorizationCode(input: string): string | undefined {
	const trimmed = input.trim();
	if (!trimmed) {
		return undefined;
	}
	try {
		const url = new URL(trimmed);
		const code = url.searchParams.get("code");
		if (code) {
			return code;
		}
	} catch {
		// 不是 URL，按 code 处理。
	}
	return trimmed;
}
