/**
 * Kimi（Moonshot AI）订阅账号的 OAuth 设备码鉴权、刷新与登录。
 *
 * 对齐 Go 运行时 `internal/auth/kimi`：RFC 8628 设备授权流程、`auth.kimi.com`
 * 的 device/token 端点、`X-Msh-*` 客户端头与 auth JSON 字段。刷新同样使用
 * 表单 POST，不需要 PKCE。
 */

import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { ApiError } from "../../../core/api/ApiError";
import type { SubscriptionAccountStore } from "../accountStore";
import type { SubscriptionAccount, SubscriptionAuthHandler, SubscriptionLoginSession, SubscriptionSource } from "../types";
import {
	SUBSCRIPTION_FILE_LOCK_TIMEOUT_MS,
	SUBSCRIPTION_REFRESH_LEAD_MS,
	credentialExpiryMs,
	errorMessage,
	formatRfc3339,
	mergeWriteAccountFile,
	readPositiveNumberField,
	readStringField,
} from "./accountFile";
import { LoginSessionRegistry } from "./loginSession";
import { singleFlight } from "./inflight";

/** Kimi Code 的公开 OAuth client_id。 */
const KIMI_CLIENT_ID = "17e5f671-d194-4dfb-9706-5516cb48c098";
/** kimi.com 的 OAuth 主机。 */
const KIMI_COM_OAUTH_HOST = "https://auth.kimi.com";
/** kimi.ai 的 OAuth 主机。 */
const KIMI_AI_OAUTH_HOST = "https://auth.kimi.ai";
/** kimi.com 的 Coding API base URL。 */
const KIMI_COM_API_BASE_URL = "https://api.kimi.com/coding";
/** kimi.ai 的 Coding API base URL。 */
const KIMI_AI_API_BASE_URL = "https://api.kimi.ai/coding";
/** 设备码端点路径。 */
const KIMI_DEVICE_CODE_PATH = "/api/oauth/device_authorization";
/** token 端点路径。 */
const KIMI_TOKEN_PATH = "/api/oauth/token";
/** 设备码轮询的最小间隔。 */
const KIMI_MIN_POLL_INTERVAL_MS = 5 * 1000;
/** server 返回 slow_down 时增加的间隔。 */
const KIMI_SLOW_DOWN_INCREMENT_MS = 5 * 1000;
/** 等待用户授权的最大时长。 */
const KIMI_MAX_POLL_DURATION_MS = 15 * 60 * 1000;
/** 登录会话 TTL；略长于设备码最长等待时间。 */
const KIMI_LOGIN_SESSION_TTL_MS = 16 * 60 * 1000;
/** 同时保留的登录会话上限。 */
const KIMI_MAX_LOGIN_SESSIONS = 32;
/** 单次 OAuth HTTP 超时。 */
const KIMI_HTTP_TIMEOUT_MS = 30 * 1000;
/** 设备授权 grant type。 */
const KIMI_DEVICE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";

/** Kimi 鉴权处理器依赖。 */
export interface KimiAuthDependencies {
	/** 账号仓库。 */
	readonly accounts: SubscriptionAccountStore;
	/** 可注入的 fetch；测试使用。 */
	readonly fetch?: typeof fetch;
	/** 当前时间（毫秒）；测试注入。 */
	readonly now?: () => number;
	/** 登录会话 TTL（毫秒）。 */
	readonly loginSessionTtlMs?: number;
	/** 同时保留的登录会话上限。 */
	readonly maxLoginSessions?: number;
}

/** Kimi 域；决定 OAuth 主机与 API base URL。 */
type KimiDomain = "kimi.com" | "kimi.ai";

/** 设备码响应。 */
interface KimiDeviceCodePayload {
	/** 设备码。 */
	readonly deviceCode: string;
	/** 用户需要在验证页输入的代码。 */
	readonly userCode?: string;
	/** 验证地址。 */
	readonly verificationUri?: string;
	/** 带 user_code 的验证地址。 */
	readonly verificationUriComplete?: string;
	/** 设备码有效期秒数。 */
	readonly expiresInSeconds?: number;
	/** 轮询间隔毫秒。 */
	readonly intervalMs: number;
}

/** token 响应。 */
interface KimiTokenPayload {
	/** access token。 */
	readonly accessToken: string;
	/** 轮换后的 refresh token。 */
	readonly refreshToken?: string;
	/** token 类型。 */
	readonly tokenType?: string;
	/** 授权 scope。 */
	readonly scope?: string;
	/** 有效期秒数。 */
	readonly expiresInSeconds?: number;
}

/** 登录会话私有状态。 */
interface KimiLoginPayload {
	/** 设备码。 */
	readonly deviceCode: string;
	/** 本次登录使用的设备标识。 */
	readonly deviceId: string;
	/** OAuth 主机。 */
	readonly oauthHost: string;
	/** 域。 */
	readonly domain: KimiDomain;
	/** 轮询间隔毫秒。 */
	readonly intervalMs: number;
	/** 放弃等待的时间点（毫秒）。 */
	readonly deadline: number;
	/** 上次轮询时间（毫秒）。 */
	readonly lastPollAt: number;
}

/** 表单 POST 的结果；非 2xx 也解析 JSON（OAuth 错误体）。 */
interface KimiFormResponse {
	/** HTTP 状态码。 */
	readonly status: number;
	/** 是否 2xx。 */
	readonly ok: boolean;
	/** 解析后的 JSON；空响应为 `{}`。 */
	readonly body: Record<string, unknown>;
	/** 响应不是合法 JSON 对象。 */
	readonly invalidJson: boolean;
}

/**
 * 构造 Kimi 订阅鉴权处理器。
 * @param dependencies - 账号仓库与可注入依赖
 */
export function createKimiAuth(dependencies: KimiAuthDependencies): SubscriptionAuthHandler {
	return new KimiAuthHandler(dependencies);
}

/**
 * 判断值是否表示 kimi.ai。
 * @param value - 域、类型或主机名
 */
function isKimiAiDomain(value: string): boolean {
	const normalized = value.trim().toLowerCase();
	return normalized === "kimi.ai" || normalized === "ai" || normalized === "kimi-ai" || normalized.endsWith(".kimi.ai");
}

/**
 * 判断 URL 主机是否属于 kimi.ai。
 * @param value - URL
 */
function isKimiAiHost(value: string): boolean {
	try {
		const host = new URL(value).hostname.toLowerCase();
		return host === "kimi.ai" || host === "api.kimi.ai" || host === "auth.kimi.ai" || host.endsWith(".kimi.ai");
	} catch {
		return false;
	}
}

/**
 * 判断值是否表示 kimi.com。
 * @param value - 域、类型或主机名
 */
function isKimiComDomain(value: string): boolean {
	const normalized = value.trim().toLowerCase();
	return normalized === "kimi.com" || normalized === "com" || normalized === "kimi" || normalized.endsWith(".kimi.com");
}

/**
 * 判断 URL 主机是否属于 kimi.com。
 * @param value - URL
 */
function isKimiComHost(value: string): boolean {
	try {
		const host = new URL(value).hostname.toLowerCase();
		return host === "kimi.com" || host === "api.kimi.com" || host === "auth.kimi.com" || host.endsWith(".kimi.com");
	} catch {
		return false;
	}
}

/**
 * 从已有 auth JSON 判断域；依次看 domain、base_url、type，最后看文件名。
 * @param raw - auth JSON
 * @param fileName - 文件名
 */
function resolveKimiDomain(raw: Record<string, unknown>, fileName: string): KimiDomain {
	const domain = readStringField(raw, "domain");
	if (domain) {
		if (isKimiAiDomain(domain)) {
			return "kimi.ai";
		}
		if (isKimiComDomain(domain)) {
			return "kimi.com";
		}
	}
	const baseUrl = readStringField(raw, "base_url");
	if (baseUrl) {
		if (isKimiAiHost(baseUrl)) {
			return "kimi.ai";
		}
		if (isKimiComHost(baseUrl)) {
			return "kimi.com";
		}
	}
	const type = readStringField(raw, "type");
	if (type) {
		if (isKimiAiDomain(type)) {
			return "kimi.ai";
		}
		if (isKimiComDomain(type)) {
			return "kimi.com";
		}
	}
	const normalizedFileName = fileName.toLowerCase();
	if (normalizedFileName.includes("kimi-ai") || normalizedFileName.includes("kimi.ai")) {
		return "kimi.ai";
	}
	return "kimi.com";
}

/**
 * 域的 OAuth 主机。
 * @param domain - Kimi 域
 */
function kimiOAuthHost(domain: KimiDomain): string {
	return domain === "kimi.ai" ? KIMI_AI_OAUTH_HOST : KIMI_COM_OAUTH_HOST;
}

/**
 * 域的 Coding API base URL。
 * @param domain - Kimi 域
 */
function kimiApiBaseUrl(domain: KimiDomain): string {
	return domain === "kimi.ai" ? KIMI_AI_API_BASE_URL : KIMI_COM_API_BASE_URL;
}

/**
 * 客户端版本号；沿用托管运行时的版本环境变量。
 */
function kimiClientVersion(): string {
	// 与 Kimi 客户端协议匹配的版本号；不再读取 Go 宿主的环境变量。
	return "8.0.57";
}

/**
 * 设备名；取主机名，失败时用占位值。
 */
function kimiDeviceName(): string {
	try {
		return hostname() || "unknown";
	} catch {
		return "unknown";
	}
}

/**
 * 设备型号；对齐 Go 运行时的 `macOS arm64` 形态。
 */
function kimiDeviceModel(): string {
	const platforms: Record<string, string> = {
		darwin: "macOS",
		linux: "Linux",
		win32: "Windows",
	};
	// Node 与 Go 的架构命名不同（x64/ia32 对应 amd64/386）。
	const architectures: Record<string, string> = {
		x64: "amd64",
		ia32: "386",
	};
	const platform = platforms[process.platform] ?? process.platform;
	const architecture = architectures[process.arch] ?? process.arch;
	return `${platform} ${architecture}`;
}

/**
 * Kimi 请求头。
 * @param deviceId - 设备标识
 */
function kimiRequestHeaders(deviceId: string): Record<string, string> {
	return {
		"X-Msh-Platform": "CLIProxyAPI",
		"X-Msh-Version": kimiClientVersion(),
		"X-Msh-Device-Name": kimiDeviceName(),
		"X-Msh-Device-Model": kimiDeviceModel(),
		"X-Msh-Device-Id": deviceId,
	};
}

/**
 * 以表单提交并解析 JSON；非 2xx 不抛错，交给调用方按 OAuth 语义处理。
 * @param url - 端点
 * @param form - 表单字段
 * @param headers - 额外请求头
 * @param fetchImpl - 可注入的 fetch
 */
async function requestKimiForm(
	url: string,
	form: Record<string, string>,
	headers: Record<string, string>,
	fetchImpl: typeof fetch | undefined,
): Promise<KimiFormResponse> {
	const response = await (fetchImpl ?? fetch)(url, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			Accept: "application/json",
			...headers,
		},
		body: new URLSearchParams(form).toString(),
		signal: AbortSignal.timeout(KIMI_HTTP_TIMEOUT_MS),
	});
	const text = await response.text();
	if (!text.trim()) {
		return { status: response.status, ok: response.ok, body: {}, invalidJson: false };
	}
	try {
		const parsed = JSON.parse(text) as unknown;
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return {
				status: response.status,
				ok: response.ok,
				body: parsed as Record<string, unknown>,
				invalidJson: false,
			};
		}
	} catch {
		// 落到下面的 invalidJson 分支。
	}
	return { status: response.status, ok: response.ok, body: {}, invalidJson: true };
}

/**
 * 把 OAuth 错误体转成简短描述，不回显原始响应（避免泄露 token）。
 * @param response - 表单响应
 */
function kimiFailureText(response: KimiFormResponse): string {
	const code = readStringField(response.body, "error");
	if (!code) {
		return `HTTP ${response.status}`;
	}
	const description = readStringField(response.body, "error_description");
	return description ? `${code}: ${description}` : code;
}

/**
 * 解析设备码响应。
 * @param body - 设备码端点 JSON
 * @throws {ApiError} 响应缺少 device_code 时抛出
 */
function parseKimiDeviceCodePayload(body: Record<string, unknown>): KimiDeviceCodePayload {
	const deviceCode = readStringField(body, "device_code");
	if (!deviceCode) {
		throw ApiError.unavailable("Kimi 设备码响应缺少 device_code");
	}
	const userCode = readStringField(body, "user_code");
	const verificationUri = readStringField(body, "verification_uri");
	const verificationUriComplete = readStringField(body, "verification_uri_complete");
	const expiresIn = readPositiveNumberField(body, "expires_in");
	const interval = readPositiveNumberField(body, "interval");
	return {
		deviceCode: deviceCode,
		...(userCode ? { userCode: userCode } : {}),
		...(verificationUri ? { verificationUri: verificationUri } : {}),
		...(verificationUriComplete ? { verificationUriComplete: verificationUriComplete } : {}),
		...(expiresIn !== undefined ? { expiresInSeconds: Math.floor(expiresIn) } : {}),
		intervalMs: Math.max(KIMI_MIN_POLL_INTERVAL_MS, Math.floor((interval ?? 0) * 1000)),
	};
}

/**
 * 解析 token 响应。
 * @param body - token 端点 JSON
 * @throws {ApiError} 响应缺少 access_token 时抛出
 */
function parseKimiTokenPayload(body: Record<string, unknown>): KimiTokenPayload {
	const accessToken = readStringField(body, "access_token");
	if (!accessToken) {
		throw ApiError.unavailable("Kimi OAuth 未返回 access_token");
	}
	const refreshToken = readStringField(body, "refresh_token");
	const tokenType = readStringField(body, "token_type");
	const scope = readStringField(body, "scope");
	const expiresIn = readPositiveNumberField(body, "expires_in");
	return {
		accessToken: accessToken,
		...(refreshToken ? { refreshToken: refreshToken } : {}),
		...(tokenType ? { tokenType: tokenType } : {}),
		...(scope ? { scope: scope } : {}),
		...(expiresIn !== undefined ? { expiresInSeconds: Math.floor(expiresIn) } : {}),
	};
}

/**
 * 生成不冲突的文件名。
 * @param existing - 同来源已有账号
 * @param desired - 期望文件名
 */
function uniqueKimiFileName(existing: readonly SubscriptionAccount[], desired: string): string {
	const base = desired.replace(/\.json$/i, "");
	for (let index = 2; ; index += 1) {
		const candidate = `${base}-${index}.json`;
		if (!existing.some((account) => account.fileName.toLowerCase() === candidate.toLowerCase())) {
			return candidate;
		}
	}
}

/**
 * 计算 Kimi 账号文件名。
 *
 * 设备码响应没有账号身份字段，无法像 Claude 一样按身份命名；与 Go 运行时一致
 * 使用毫秒时间戳。已有账号保存了完全相同的凭据时复用原文件，避免重复账号；
 * 同一毫秒内重复登录时追加序号。
 * @param accounts - 账号仓库
 * @param token - 新 token
 * @param domain - Kimi 域
 * @param nowMs - 当前时间
 */
async function resolveKimiFileName(
	accounts: SubscriptionAccountStore,
	token: KimiTokenPayload,
	domain: KimiDomain,
	nowMs: number,
): Promise<string> {
	const existing = await accounts.list("kimi");
	const duplicate = existing.find((account) => {
		const accessToken = readStringField(account.raw, "access_token");
		const refreshToken = readStringField(account.raw, "refresh_token");
		return (
			(accessToken !== undefined && accessToken === token.accessToken) ||
			(refreshToken !== undefined && token.refreshToken !== undefined && refreshToken === token.refreshToken)
		);
	});
	if (duplicate) {
		return duplicate.fileName;
	}
	const prefix = domain === "kimi.ai" ? "kimi-ai" : "kimi";
	const desired = `${prefix}-${nowMs}.json`;
	if (!existing.some((account) => account.fileName.toLowerCase() === desired.toLowerCase())) {
		return desired;
	}
	return uniqueKimiFileName(existing, desired);
}

/**
 * Kimi 鉴权处理器实现。
 */
class KimiAuthHandler implements SubscriptionAuthHandler {
	readonly source: SubscriptionSource = "kimi";
	private readonly _accounts: SubscriptionAccountStore;
	private readonly _inflight = new Map<string, Promise<void>>();
	private readonly _fetch?: typeof fetch;
	private readonly _now: () => number;
	private readonly _sessions: LoginSessionRegistry<KimiLoginPayload>;

	constructor(dependencies: KimiAuthDependencies) {
		this._accounts = dependencies.accounts;
		this._fetch = dependencies.fetch;
		this._now = dependencies.now ?? (() => Date.now());
		this._sessions = new LoginSessionRegistry<KimiLoginPayload>({
			ttlMs: dependencies.loginSessionTtlMs ?? KIMI_LOGIN_SESSION_TTL_MS,
			maxEntries: dependencies.maxLoginSessions ?? KIMI_MAX_LOGIN_SESSIONS,
			now: this._now,
		});
	}

	/**
	 * 返回可用 access token；临近过期时在文件锁内刷新。
	 * @param account - 选中账号
	 */
	async ensureCredential(account: SubscriptionAccount): Promise<string> {
		const accessToken = readStringField(account.raw, "access_token");
		if (!accessToken) {
			throw ApiError.unavailable("Kimi 订阅账号缺少 access_token，请重新登录 Kimi");
		}
		const expiresAt = account.expiresAt ?? credentialExpiryMs(account.raw);
		if (expiresAt === undefined || expiresAt - this._now() > SUBSCRIPTION_REFRESH_LEAD_MS) {
			return accessToken;
		}
		await this._refreshLocked(account, true);
		const updated = await this._accounts.readRaw(account.fileName);
		const nextAccessToken = readStringField(updated, "access_token");
		if (!nextAccessToken) {
			throw ApiError.unavailable("Kimi 订阅账号刷新后仍缺少 access_token，请重新登录 Kimi");
		}
		return nextAccessToken;
	}

	/**
	 * 强制刷新并原子写回账号文件。
	 * @param account - 选中账号
	 */
	async refresh(account: SubscriptionAccount): Promise<void> {
		await this._refreshLocked(account, false);
	}

	/** 启动设备码登录；返回验证地址与 user_code。 */
	async startLogin(): Promise<SubscriptionLoginSession> {
		const domain: KimiDomain = "kimi.com";
		const deviceId = randomUUID();
		const oauthHost = kimiOAuthHost(domain);
		const response = await requestKimiForm(
			oauthHost + KIMI_DEVICE_CODE_PATH,
			{ client_id: KIMI_CLIENT_ID },
			kimiRequestHeaders(deviceId),
			this._fetch,
		);
		if (!response.ok) {
			throw ApiError.unavailable(`Kimi 设备码请求失败：${kimiFailureText(response)}`);
		}
		const device = parseKimiDeviceCodePayload(response.body);
		const url = device.verificationUriComplete ?? device.verificationUri;
		if (!url) {
			throw ApiError.unavailable("Kimi 设备码响应缺少验证地址");
		}
		const nowMs = this._now();
		const expiresInMs = device.expiresInSeconds !== undefined ? device.expiresInSeconds * 1000 : KIMI_MAX_POLL_DURATION_MS;
		const deadlineMs = nowMs + Math.min(expiresInMs, KIMI_MAX_POLL_DURATION_MS);
		const record = this._sessions.create(
			{
				deviceCode: device.deviceCode,
				deviceId: deviceId,
				oauthHost: oauthHost,
				domain: domain,
				intervalMs: device.intervalMs,
				deadline: deadlineMs,
				lastPollAt: nowMs,
			},
			{
				url: url,
				output: [
					"To authenticate, visit:",
					url,
					...(device.userCode ? [`User code: ${device.userCode}`] : []),
					"Waiting for authorization...",
				],
			},
		);
		return record.session;
	}

	/**
	 * 轮询 token 端点；遵守间隔、slow_down 与设备码有效期。
	 * @param id - 会话 ID
	 */
	async pollLogin(id: string): Promise<SubscriptionLoginSession> {
		const record = this._sessions.find(id);
		if (!record) {
			throw ApiError.notFound("登录会话不存在或已过期，请重新开始");
		}
		if (record.session.state !== "pending") {
			return record.session;
		}
		const nowMs = this._now();
		if (nowMs >= record.payload.deadline) {
			return this._fail(record.session.id, record.session.output, "Kimi 设备码已过期，请重新登录");
		}
		if (nowMs - record.payload.lastPollAt < record.payload.intervalMs) {
			return record.session;
		}
		// 先记录轮询时间，避免并发轮询重复请求 token 端点。
		this._sessions.replacePayload(id, { ...record.payload, lastPollAt: nowMs });
		const response = await requestKimiForm(
			record.payload.oauthHost + KIMI_TOKEN_PATH,
			{
				client_id: KIMI_CLIENT_ID,
				device_code: record.payload.deviceCode,
				grant_type: KIMI_DEVICE_GRANT_TYPE,
			},
			kimiRequestHeaders(record.payload.deviceId),
			this._fetch,
		);
		if (response.invalidJson) {
			return this._fail(id, record.session.output, "Kimi token 响应格式无效");
		}
		const errorCode = readStringField(response.body, "error");
		if (errorCode) {
			const description = readStringField(response.body, "error_description");
			switch (errorCode) {
				case "authorization_pending":
					return record.session;
				case "slow_down":
					this._sessions.replacePayload(id, {
						...record.payload,
						lastPollAt: nowMs,
						intervalMs: record.payload.intervalMs + KIMI_SLOW_DOWN_INCREMENT_MS,
					});
					return record.session;
				case "expired_token":
					return this._fail(id, record.session.output, "Kimi 设备码已过期，请重新登录");
				case "access_denied":
					return this._fail(id, record.session.output, "Kimi 授权已被拒绝");
				default:
					return this._fail(id, record.session.output, `Kimi 授权失败：${description ?? errorCode}`);
			}
		}
		if (!response.ok) {
			return this._fail(id, record.session.output, `Kimi token 端点返回 HTTP ${response.status}`);
		}
		let token: KimiTokenPayload;
		try {
			token = parseKimiTokenPayload(response.body);
		} catch (error) {
			return this._fail(id, record.session.output, errorMessage(error));
		}
		try {
			await this._persistLogin(token, record.payload);
			return this._sessions.update(id, {
				state: "success",
				output: [
					"Kimi authentication successful.",
					record.payload.domain === "kimi.ai" ? "Signed in to Kimi.ai." : "Signed in to Kimi.",
				],
			}).session;
		} catch (error) {
			return this._fail(id, record.session.output, errorMessage(error));
		}
	}

	/**
	 * 丢弃登录会话。
	 * @param id - 会话 ID
	 */
	async cancelLogin(id: string): Promise<void> {
		this._sessions.remove(id);
	}

	/**
	 * 把会话标记为失败并返回快照。
	 * @param id - 会话 ID
	 * @param output - 原有输出行
	 * @param message - 失败原因
	 */
	private _fail(id: string, output: readonly string[], message: string): SubscriptionLoginSession {
		try {
			return this._sessions.update(id, { state: "error", output: output, error: message }).session;
		} catch {
			return { id: id, state: "error", output: [...output], error: message };
		}
	}

	/**
	 * 在文件锁内重读账号并刷新；`skipIfFresh` 用于 ensureCredential 去重并发刷新。
	 * @param account - 选中账号
	 * @param skipIfFresh - 其他调用已经刷新出可用 token 时跳过 POST
	 */
	private async _refreshLocked(account: SubscriptionAccount, skipIfFresh: boolean): Promise<void> {
		return await singleFlight(this._inflight, `${account.fileName}:${skipIfFresh ? "fresh" : "force"}`, async () => {
			await this._refreshSerialized(account, skipIfFresh);
		});
	}

	/**
	 * 文件锁内实际刷新；`_refreshLocked` 负责并发去重。
	 * @param account - 选中账号
	 * @param skipIfFresh - 其他调用已经刷新出可用 token 时跳过 POST
	 */
	private async _refreshSerialized(account: SubscriptionAccount, skipIfFresh: boolean): Promise<void> {
		const snapshotAccessToken = readStringField(account.raw, "access_token");
		await this._accounts.withFileLock(account.fileName, SUBSCRIPTION_FILE_LOCK_TIMEOUT_MS, async () => {
			const raw = await this._accounts.readRaw(account.fileName);
			const currentAccessToken = readStringField(raw, "access_token");
			if (skipIfFresh && currentAccessToken && currentAccessToken !== snapshotAccessToken) {
				const currentExpiry = credentialExpiryMs(raw);
				if (currentExpiry === undefined || currentExpiry - this._now() > SUBSCRIPTION_REFRESH_LEAD_MS) {
					return;
				}
			}
			await this._postRefresh(account.fileName, raw);
		});
	}

	/**
	 * 用文件中的 refresh token 换取新凭据并原子写回。
	 * @param fileName - 账号文件名
	 * @param raw - 刚重读的 auth JSON
	 */
	private async _postRefresh(fileName: string, raw: Record<string, unknown>): Promise<void> {
		const refreshToken = readStringField(raw, "refresh_token");
		if (!refreshToken) {
			throw ApiError.unavailable("Kimi 订阅账号缺少 refresh_token，请重新登录 Kimi");
		}
		const domain = resolveKimiDomain(raw, fileName);
		const deviceId = readStringField(raw, "device_id") ?? randomUUID();
		const response = await requestKimiForm(
			kimiOAuthHost(domain) + KIMI_TOKEN_PATH,
			{
				client_id: KIMI_CLIENT_ID,
				grant_type: "refresh_token",
				refresh_token: refreshToken,
			},
			kimiRequestHeaders(deviceId),
			this._fetch,
		);
		if (response.invalidJson) {
			throw ApiError.unavailable(`Kimi token 刷新响应格式无效（HTTP ${response.status}）`);
		}
		if (response.status === 401 || response.status === 403) {
			throw ApiError.unavailable("Kimi refresh token 已被拒绝，请重新登录 Kimi");
		}
		if (!response.ok) {
			throw ApiError.unavailable(`Kimi token 刷新失败：${kimiFailureText(response)}`);
		}
		const token = parseKimiTokenPayload(response.body);
		const nowMs = this._now();
		const merged: Record<string, unknown> = {
			...raw,
			access_token: token.accessToken,
			last_refresh: formatRfc3339(nowMs),
		};
		if (token.refreshToken) {
			merged["refresh_token"] = token.refreshToken;
		}
		if (token.expiresInSeconds !== undefined) {
			merged["expired"] = formatRfc3339(nowMs + token.expiresInSeconds * 1000);
		}
		if (!readStringField(merged, "type")) {
			merged["type"] = domain === "kimi.ai" ? "kimi-ai" : "kimi";
		}
		if (!readStringField(merged, "domain")) {
			merged["domain"] = domain;
		}
		if (!readStringField(merged, "base_url")) {
			merged["base_url"] = kimiApiBaseUrl(domain);
		}
		await this._accounts.writeRaw(fileName, merged);
	}

	/**
	 * 保存登录结果；保留已有文件的未知字段。
	 * @param token - token 响应
	 * @param payload - 登录会话私有状态
	 */
	private async _persistLogin(token: KimiTokenPayload, payload: KimiLoginPayload): Promise<{ readonly fileName: string }> {
		const nowMs = this._now();
		const fileName = await resolveKimiFileName(this._accounts, token, payload.domain, nowMs);
		const record: Record<string, unknown> = {
			access_token: token.accessToken,
			refresh_token: token.refreshToken ?? "",
			token_type: token.tokenType ?? "",
			device_id: payload.deviceId,
			type: payload.domain === "kimi.ai" ? "kimi-ai" : "kimi",
			domain: payload.domain,
			base_url: kimiApiBaseUrl(payload.domain),
			timestamp: nowMs,
		};
		if (token.scope) {
			record["scope"] = token.scope;
		}
		if (token.expiresInSeconds !== undefined) {
			record["expired"] = formatRfc3339(nowMs + token.expiresInSeconds * 1000);
		}
		await mergeWriteAccountFile(this._accounts, fileName, record);
		return { fileName: fileName };
	}
}
