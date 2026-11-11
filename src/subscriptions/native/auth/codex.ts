/**
 * Codex 订阅账号鉴权。
 *
 * 支持两种登录：
 * - 浏览器授权码 + PKCE：`startLogin` 生成授权 URL，用户在浏览器完成授权后
 *   把回调 URL 或授权码交给 `submitLoginInput`；
 * - 设备码：`startDeviceLogin` 申请 device code 并后台轮询，直到用户授权。
 *
 * token 刷新使用账号仓库的文件锁串行化，写回时保留 auth JSON 的未知字段，
 * 字段名与旧运行时的 Codex auth 文件保持一致。
 */

import { randomBytes } from "node:crypto";
import { access } from "node:fs/promises";
import path from "node:path";
import { ApiError } from "../../../core/api/ApiError";
import type { SubscriptionAccountStore } from "../accountStore";
import type {
	SubscriptionAccount,
	SubscriptionAuthHandler,
	SubscriptionLoginSession,
	SubscriptionLoginState,
	SubscriptionSource,
} from "../types";
import { createPkce, createState, postForm } from "./http";
import type { TokenEndpointResponse } from "./http";
import {
	CODEX_OAUTH,
	codexCredentialFileName,
	codexExpiryMs,
	codexIdentityFromTokens,
	codexTokenExpiryMs,
	formatRfc3339,
	parseCodexCallbackInput,
	requestAuthJson,
} from "./codexOAuth";
import type { AuthRequestOptions, CodexIdentity } from "./codexOAuth";

/** 登录会话默认 TTL（毫秒）。 */
const LOGIN_SESSION_TTL_MS = 15 * 60 * 1000;
/** 登录会话数量上限。 */
const LOGIN_SESSION_LIMIT = 8;
/** 账号文件锁等待上限（毫秒）。 */
const FILE_LOCK_TIMEOUT_MS = 30_000;
/** 单个 auth 文件的临时文件名生成尝试次数上限。 */
const FILE_NAME_ATTEMPTS = 50;

/** Codex 鉴权处理器依赖。 */
export interface CodexAuthDependencies {
	/** 账号仓库。 */
	readonly accounts: SubscriptionAccountStore;
	/** 注入的 fetch；缺省使用全局 fetch。 */
	readonly fetch?: typeof fetch;
	/** token 端点覆盖；缺省使用 OpenAI 官方端点。 */
	readonly tokenUrl?: string;
	/** 浏览器授权端点覆盖。 */
	readonly authUrl?: string;
	/** 设备码申请端点覆盖。 */
	readonly deviceUserCodeUrl?: string;
	/** 设备码轮询端点覆盖。 */
	readonly deviceTokenUrl?: string;
	/** 设备码输入页面覆盖。 */
	readonly deviceVerificationUrl?: string;
	/** 浏览器授权回调地址覆盖。 */
	readonly redirectUri?: string;
	/** 设备码换 token 的回调地址覆盖。 */
	readonly deviceRedirectUri?: string;
	/** 设备码轮询间隔覆盖（毫秒）；用于测试或私有部署。 */
	readonly devicePollIntervalMs?: number;
	/** 设备码等待授权上限覆盖（毫秒）。 */
	readonly deviceTimeoutMs?: number;
	/** 登录会话 TTL 覆盖（毫秒）。 */
	readonly loginSessionTtlMs?: number;
	/** 登录会话数量上限。 */
	readonly maxLoginSessions?: number;
	/** 单次 HTTP 请求超时（毫秒）。 */
	readonly requestTimeoutMs?: number;
	/** SIWC token 端点覆盖；缺省使用 OpenAI 官方端点。 */
	readonly siwcTokenUrl?: string;
}

/** Codex 鉴权处理器；在通用处理器之外提供设备码登录。 */
export interface CodexAuthHandler extends SubscriptionAuthHandler {
	/** 来源。 */
	readonly source: SubscriptionSource;
	/**
	 * 启动浏览器授权登录。
	 */
	startLogin(): Promise<SubscriptionLoginSession>;
	/**
	 * 按请求头返回可用凭据；非 Codex 客户端优先使用 SIWC 分区。
	 * @param account - 选中账号
	 * @param headers - 请求头
	 */
	ensureCredentialForRequest(account: SubscriptionAccount, headers: Record<string, string>): Promise<string>;
	/**
	 * 按请求头强制刷新对应 token 分区。
	 * @param account - 选中账号
	 * @param headers - 请求头
	 */
	refreshForRequest(account: SubscriptionAccount, headers: Record<string, string>): Promise<void>;
	/**
	 * 轮询登录会话状态。
	 * @param id - 会话 ID
	 */
	pollLogin(id: string): Promise<SubscriptionLoginSession>;
	/**
	 * 提交回调 URL 或授权码。
	 * @param id - 会话 ID
	 * @param input - 回调 URL 或授权码
	 */
	submitLoginInput(id: string, input: string): Promise<SubscriptionLoginSession>;
	/**
	 * 取消并清理登录会话。
	 * @param id - 会话 ID
	 */
	cancelLogin(id: string): Promise<void>;
	/**
	 * 启动 Codex 设备码登录；用户在浏览器输入设备码后自动完成。
	 */
	startDeviceLogin(): Promise<SubscriptionLoginSession>;
}

/** 内存中的登录会话。 */
interface CodexLoginSession {
	/** 会话 ID。 */
	readonly id: string;
	/** 登录方式。 */
	readonly kind: "browser" | "device";
	/** 当前状态。 */
	state: SubscriptionLoginState;
	/** 授权 URL。 */
	readonly url: string;
	/** 输出行。 */
	output: string[];
	/** 需要用户输入的提示。 */
	prompt?: string;
	/** 失败原因。 */
	error?: string;
	/** 创建时间。 */
	readonly createdAt: number;
	/** 过期时间。 */
	expiresAt: number;
	/** 浏览器登录的 OAuth state。 */
	readonly oauthState?: string;
	/** 浏览器登录的 PKCE verifier。 */
	readonly verifier?: string;
	/** 设备码登录的 device_auth_id。 */
	readonly deviceAuthId?: string;
	/** 设备码登录的 user_code。 */
	readonly userCode?: string;
	/** 设备码轮询间隔。 */
	readonly pollIntervalMs?: number;
	/** 是否已取消。 */
	cancelled: boolean;
	/** 唤醒后台轮询的 sleep。 */
	wake?: () => void;
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
 * 提取错误消息；避免把对象整体序列化进日志或响应。
 * @param error - 捕获值
 */
function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * 从错误文本中移除 token/授权码，避免凭据进入日志或 API 响应。
 * @param message - 原始错误文本
 * @param secrets - 需要脱敏的凭据
 */
function redactSecrets(message: string, secrets: readonly (string | undefined)[]): string {
	let redacted = message;
	for (const secret of secrets) {
		if (secret) {
			redacted = redacted.split(secret).join("[redacted]");
		}
	}
	return redacted;
}

/**
 * 判断文件是否存在。
 * @param filePath - 绝对路径
 */
async function fileExists(filePath: string): Promise<boolean> {
	try {
		await access(filePath);
		return true;
	} catch {
		return false;
	}
}

/**
 * 解析设备码接口返回的 interval；兼容字符串与数字秒。
 * @param value - interval 原始值
 */
function parseDeviceIntervalMs(value: unknown): number | undefined {
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

/**
 * 判断 auth JSON 是否属于本次登录的同一 Codex 账号。
 *
 * 有 account_id 时以它为准（同邮箱的不同 ChatGPT 账号必须分开保存）；
 * 缺少 account_id 时回退到邮箱 + 套餐。
 * @param raw - 磁盘上的 auth JSON
 * @param identity - 本次登录身份
 */
function codexIdentityMatches(raw: Record<string, unknown>, identity: CodexIdentity): boolean {
	const rawAccountId = nonEmptyString(raw["account_id"]);
	if (identity.accountId) {
		return rawAccountId === identity.accountId;
	}
	const rawEmail = nonEmptyString(raw["email"]);
	if (!identity.email || !rawEmail || identity.email.toLowerCase() !== rawEmail.toLowerCase()) {
		return false;
	}
	const rawPlan = nonEmptyString(raw["plan_type"]);
	return !identity.planType || !rawPlan || identity.planType === rawPlan;
}

/**
 * 构造浏览器授权 URL；参数集合对齐 Go `GenerateAuthURL`。
 * @param authUrl - 授权端点
 * @param redirectUri - 回调地址
 * @param state - OAuth state
 * @param challenge - PKCE S256 challenge
 * @param clientId - OAuth client_id
 */
function buildCodexAuthUrl(authUrl: string, redirectUri: string, state: string, challenge: string, clientId: string): string {
	const params = new URLSearchParams({
		client_id: clientId,
		response_type: "code",
		redirect_uri: redirectUri,
		scope: CODEX_OAUTH.scope,
		state: state,
		code_challenge: challenge,
		code_challenge_method: "S256",
		prompt: "login",
		id_token_add_organizations: "true",
		codex_cli_simplified_flow: "true",
	});
	return `${authUrl}?${params.toString()}`;
}

/**
 * Codex 鉴权处理器实现。
 */
class CodexAuth implements CodexAuthHandler {
	readonly source: SubscriptionSource = "codex";
	private readonly _accounts: SubscriptionAccountStore;
	private readonly _fetch?: typeof fetch;
	private readonly _tokenUrl: string;
	private readonly _authUrl: string;
	private readonly _deviceUserCodeUrl: string;
	private readonly _deviceTokenUrl: string;
	private readonly _deviceVerificationUrl: string;
	private readonly _redirectUri: string;
	private readonly _deviceRedirectUri: string;
	private readonly _devicePollIntervalMs?: number;
	private readonly _deviceTimeoutMs: number;
	private readonly _loginSessionTtlMs: number;
	private readonly _maxLoginSessions: number;
	private readonly _requestTimeoutMs: number;
	private readonly _siwcTokenUrl: string;
	private readonly _sessions = new Map<string, CodexLoginSession>();
	private readonly _inflight = new Map<string, Promise<Record<string, unknown>>>();

	constructor(dependencies: CodexAuthDependencies) {
		this._accounts = dependencies.accounts;
		this._fetch = dependencies.fetch;
		this._tokenUrl = dependencies.tokenUrl ?? CODEX_OAUTH.tokenUrl;
		this._authUrl = dependencies.authUrl ?? CODEX_OAUTH.authUrl;
		this._deviceUserCodeUrl = dependencies.deviceUserCodeUrl ?? CODEX_OAUTH.deviceUserCodeUrl;
		this._deviceTokenUrl = dependencies.deviceTokenUrl ?? CODEX_OAUTH.deviceTokenUrl;
		this._deviceVerificationUrl = dependencies.deviceVerificationUrl ?? CODEX_OAUTH.deviceVerificationUrl;
		this._redirectUri = dependencies.redirectUri ?? CODEX_OAUTH.redirectUri;
		this._deviceRedirectUri = dependencies.deviceRedirectUri ?? CODEX_OAUTH.deviceRedirectUri;
		this._devicePollIntervalMs = dependencies.devicePollIntervalMs;
		this._deviceTimeoutMs = dependencies.deviceTimeoutMs ?? CODEX_OAUTH.deviceTimeoutMs;
		this._loginSessionTtlMs = dependencies.loginSessionTtlMs ?? LOGIN_SESSION_TTL_MS;
		this._maxLoginSessions = Math.max(1, Math.trunc(dependencies.maxLoginSessions ?? LOGIN_SESSION_LIMIT));
		this._requestTimeoutMs = dependencies.requestTimeoutMs ?? 30_000;
		this._siwcTokenUrl = dependencies.siwcTokenUrl ?? CODEX_OAUTH.siwcTokenUrl;
	}

	async ensureCredential(account: SubscriptionAccount): Promise<string> {
		const accessToken = nonEmptyString(account.raw["access_token"]);
		const expiresAt = account.expiresAt ?? codexExpiryMs(account.raw);
		const expiring = typeof expiresAt === "number" && expiresAt <= Date.now() + CODEX_OAUTH.refreshLeadMs;
		if (accessToken && !expiring) {
			return accessToken;
		}
		const refreshed = await this._refreshOnce(account, true, "outer");
		const next = nonEmptyString(refreshed["access_token"]);
		if (!next) {
			throw ApiError.unavailable("Codex 账号刷新后仍缺少 access_token");
		}
		return next;
	}

	async ensureCredentialForRequest(account: SubscriptionAccount, headers: Record<string, string>): Promise<string> {
		if (!this._usesSiwc(account) || this._isCodexClient(headers)) {
			return await this.ensureCredential(account);
		}
		const siwc = this._siwcSection(account);
		const token = nonEmptyString(siwc?.["access_token"]);
		if (token && !this._siwcExpiring(siwc)) {
			return token;
		}
		const refreshed = await this._refreshOnce(account, true, "siwc");
		const next = nonEmptyString(this._siwcSection({ ...account, raw: refreshed })?.["access_token"]);
		if (!next) {
			throw ApiError.unavailable("Codex SIWC 刷新后仍缺少 access_token");
		}
		return next;
	}

	async refresh(account: SubscriptionAccount): Promise<void> {
		await this._refreshOnce(account, false, "outer");
	}

	async refreshForRequest(account: SubscriptionAccount, headers: Record<string, string>): Promise<void> {
		if (this._usesSiwc(account) && !this._isCodexClient(headers)) {
			await this._refreshOnce(account, false, "siwc");
			return;
		}
		await this.refresh(account);
	}

	async startLogin(): Promise<SubscriptionLoginSession> {
		this._pruneSessions();
		const pkce = createPkce();
		const oauthState = createState();
		const url = buildCodexAuthUrl(this._authUrl, this._redirectUri, oauthState, pkce.challenge, CODEX_OAUTH.clientId);
		const session: CodexLoginSession = {
			id: randomBytes(12).toString("hex"),
			kind: "browser",
			state: "pending",
			url: url,
			output: ["在浏览器打开以下地址完成 Codex 授权：", url, "授权后浏览器会跳转到回调地址；若页面打不开，请复制地址栏完整 URL。"],
			prompt: "粘贴回调 URL 或授权码，然后提交",
			createdAt: Date.now(),
			expiresAt: Date.now() + this._loginSessionTtlMs,
			oauthState: oauthState,
			verifier: pkce.verifier,
			cancelled: false,
		};
		this._storeSession(session);
		return this._toLoginSession(session);
	}

	async pollLogin(id: string): Promise<SubscriptionLoginSession> {
		this._pruneSessions();
		const session = this._requireSession(id);
		return this._toLoginSession(session);
	}

	async submitLoginInput(id: string, input: string): Promise<SubscriptionLoginSession> {
		const session = this._requireSession(id);
		if (session.kind !== "browser") {
			throw ApiError.badRequest("Codex 设备码登录无需手动提交授权码");
		}
		if (session.cancelled) {
			throw ApiError.notFound("登录会话不存在或已过期");
		}
		if (session.state === "success") {
			return this._toLoginSession(session);
		}
		session.state = "pending";
		session.error = undefined;
		try {
			const code = parseCodexCallbackInput(input, session.oauthState ?? "");
			const response = await this._exchangeCode(code, session.verifier ?? "", this._redirectUri);
			const saved = await this._persistLoginCredential(response);
			session.state = "success";
			session.prompt = undefined;
			session.output = [...session.output, `Codex 登录成功：${saved.email}（${saved.fileName}）`];
			return this._toLoginSession(session);
		} catch (error) {
			session.state = "error";
			session.error = messageOf(error);
			throw error;
		}
	}

	async cancelLogin(id: string): Promise<void> {
		const session = this._sessions.get(id);
		if (!session) {
			return;
		}
		session.cancelled = true;
		session.wake?.();
		this._sessions.delete(id);
	}

	async startDeviceLogin(): Promise<SubscriptionLoginSession> {
		this._pruneSessions();
		const response = await requestAuthJson(
			this._deviceUserCodeUrl,
			{
				method: "POST",
				headers: { "Content-Type": "application/json", Accept: "application/json" },
				body: JSON.stringify({ client_id: CODEX_OAUTH.clientId }),
			},
			this._httpOptions(),
		);
		if (!response.ok) {
			if (response.status === 404) {
				throw ApiError.unavailable("Codex 设备码端点不可用，请改用浏览器登录");
			}
			throw ApiError.unavailable(`Codex 设备码申请失败（HTTP ${response.status}）`);
		}
		const deviceAuthId = nonEmptyString(response.body["device_auth_id"]);
		const userCode = nonEmptyString(response.body["user_code"]) ?? nonEmptyString(response.body["usercode"]);
		if (!deviceAuthId || !userCode) {
			throw ApiError.unavailable("Codex 设备码响应缺少 device_auth_id 或 user_code");
		}
		const serverIntervalMs = parseDeviceIntervalMs(response.body["interval"]);
		const pollIntervalMs = this._devicePollIntervalMs ?? serverIntervalMs ?? CODEX_OAUTH.deviceDefaultPollIntervalMs;
		const now = Date.now();
		const session: CodexLoginSession = {
			id: randomBytes(12).toString("hex"),
			kind: "device",
			state: "pending",
			url: this._deviceVerificationUrl,
			output: [
				"已申请 Codex 设备码。",
				`在浏览器打开：${this._deviceVerificationUrl}`,
				`输入设备码：${userCode}`,
				"等待授权完成，此页面会自动更新。",
			],
			createdAt: now,
			expiresAt: now + Math.max(this._loginSessionTtlMs, this._deviceTimeoutMs),
			deviceAuthId: deviceAuthId,
			userCode: userCode,
			pollIntervalMs: pollIntervalMs,
			cancelled: false,
		};
		this._storeSession(session);
		void this._runDeviceLogin(session);
		return this._toLoginSession(session);
	}

	/**
	 * 在文件锁内刷新凭据；并发调用只消费一次 refresh_token。
	 * @param account - 账号
	 * @param skipIfFresh - 其他调用已刷新出可用 token 时跳过 POST；`ensureCredential` 使用
	 * @param kind - outer 或 siwc token 分区
	 */
	private async _refreshOnce(
		account: SubscriptionAccount,
		skipIfFresh: boolean,
		kind: "outer" | "siwc",
	): Promise<Record<string, unknown>> {
		const key = `${account.fileName}:${kind}`;
		const existing = this._inflight.get(key);
		if (existing) {
			return existing;
		}
		const task = this._refreshUnderLock(account, skipIfFresh, kind).finally(() => {
			this._inflight.delete(key);
		});
		this._inflight.set(key, task);
		return task;
	}

	/**
	 * 读取锁内的最新文件并调用 token 端点；失败时不写回。
	 * @param account - 账号
	 * @param skipIfFresh - 磁盘凭据已被其他调用刷新且仍有效时直接复用
	 * @param kind - outer 或 siwc token 分区
	 * @throws {ApiError} 账号缺少 refresh_token、刷新失败或写回失败
	 */
	private async _refreshUnderLock(
		account: SubscriptionAccount,
		skipIfFresh: boolean,
		kind: "outer" | "siwc",
	): Promise<Record<string, unknown>> {
		return this._accounts.withFileLock(account.fileName, FILE_LOCK_TIMEOUT_MS, async () => {
			const disk = await this._accounts.readRaw(account.fileName);
			if (kind === "siwc") {
				return await this._refreshSiwcLocked(account, disk, skipIfFresh);
			}
			const diskAccess = nonEmptyString(disk["access_token"]);
			const diskRefresh = nonEmptyString(disk["refresh_token"]);
			const baselineAccess = nonEmptyString(account.raw["access_token"]);
			const baselineRefresh = nonEmptyString(account.raw["refresh_token"]);
			const rotated =
				(diskAccess !== undefined && diskAccess !== baselineAccess) ||
				(diskRefresh !== undefined && diskRefresh !== baselineRefresh);
			if (skipIfFresh && rotated && !this._needsRefresh(disk)) {
				return disk;
			}
			const refreshToken = diskRefresh ?? baselineRefresh;
			if (!refreshToken) {
				throw ApiError.unavailable("Codex 订阅账号缺少 refresh_token，请重新登录");
			}
			const response = await this._requestRefresh(refreshToken);
			const accessToken = nonEmptyString(response.access_token);
			if (!accessToken) {
				throw ApiError.unavailable("Codex 刷新响应缺少 access_token");
			}
			const idToken = nonEmptyString(response.id_token);
			const identity = codexIdentityFromTokens(idToken, accessToken);
			const now = Date.now();
			const next: Record<string, unknown> = { ...disk };
			next["type"] = "codex";
			next["access_token"] = accessToken;
			next["refresh_token"] = nonEmptyString(response.refresh_token) ?? diskRefresh ?? refreshToken;
			if (idToken) {
				next["id_token"] = idToken;
			}
			const accountId = identity.accountId ?? nonEmptyString(disk["account_id"]);
			if (accountId) {
				next["account_id"] = accountId;
			}
			const email = identity.email ?? nonEmptyString(disk["email"]);
			if (email) {
				next["email"] = email;
			}
			next["plan_type"] = identity.planType ?? nonEmptyString(disk["plan_type"]) ?? "free";
			const expired = formatRfc3339(codexTokenExpiryMs(response, accessToken, now));
			next["expired"] = expired;
			if (Object.hasOwn(disk, "expires_at")) {
				next["expires_at"] = expired;
			}
			next["last_refresh"] = formatRfc3339(now);
			await this._accounts.writeRaw(account.fileName, next);
			return next;
		});
	}

	/**
	 * 判断磁盘凭据是否已进入刷新窗口。
	 * @param raw - auth JSON
	 */
	private _needsRefresh(raw: Record<string, unknown>): boolean {
		const expiresAt = codexExpiryMs(raw);
		return typeof expiresAt === "number" && expiresAt <= Date.now() + CODEX_OAUTH.refreshLeadMs;
	}

	/**
	 * 账号是否启用 SIWC 分区。
	 * @param account - 账号
	 */
	private _usesSiwc(account: SubscriptionAccount): boolean {
		const value = account.raw["use_siwc"];
		return (value === true || value === "true") && this._siwcSection(account) !== undefined;
	}

	/**
	 * 读取嵌套 siwc 分区。
	 * @param account - 账号
	 */
	private _siwcSection(account: { raw: Record<string, unknown> }): Record<string, unknown> | undefined {
		const value = account.raw["siwc"];
		return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
	}

	/**
	 * 请求是否来自 Codex 客户端；这类请求固定使用外层 token。
	 * @param headers - 请求头
	 */
	private _isCodexClient(headers: Record<string, string>): boolean {
		const userAgent = headers["user-agent"] ?? "";
		const originator = headers["originator"] ?? "";
		return `${userAgent} ${originator}`.toLowerCase().includes("codex");
	}

	/**
	 * SIWC token 是否进入刷新窗口。
	 * @param siwc - siwc 分区
	 */
	private _siwcExpiring(siwc: Record<string, unknown> | undefined): boolean {
		if (!siwc) {
			return true;
		}
		const expiry = codexExpiryMs(siwc);
		return typeof expiry !== "number" || expiry <= Date.now() + CODEX_OAUTH.refreshLeadMs;
	}

	/**
	 * 锁内刷新 SIWC 分区。
	 * @param account - 账号
	 * @param disk - 锁内最新 JSON
	 * @param skipIfFresh - 其他请求已轮换且仍有效时复用
	 * @throws {ApiError} 缺少 client_id/refresh_token 或 token 响应不合法
	 */
	private async _refreshSiwcLocked(
		account: SubscriptionAccount,
		disk: Record<string, unknown>,
		skipIfFresh: boolean,
	): Promise<Record<string, unknown>> {
		const siwc = this._siwcSection({ raw: disk });
		if (!siwc) {
			throw ApiError.unavailable("Codex 账号缺少 siwc 分区，请重新登录");
		}
		const baseline = this._siwcSection(account);
		const diskAccess = nonEmptyString(siwc["access_token"]);
		const diskRefresh = nonEmptyString(siwc["refresh_token"]);
		const rotated =
			(diskAccess !== undefined && diskAccess !== nonEmptyString(baseline?.["access_token"])) ||
			(diskRefresh !== undefined && diskRefresh !== nonEmptyString(baseline?.["refresh_token"]));
		if (skipIfFresh && rotated && !this._siwcExpiring(siwc)) {
			return disk;
		}
		const refreshToken = diskRefresh ?? nonEmptyString(baseline?.["refresh_token"]);
		const clientId = nonEmptyString(siwc["client_id"]) ?? nonEmptyString(baseline?.["client_id"]);
		if (!refreshToken || !clientId) {
			throw ApiError.unavailable("Codex SIWC 账号缺少 refresh_token 或 client_id，请重新登录");
		}
		const response = await this._requestSiwcRefresh(refreshToken, clientId);
		const accessToken = nonEmptyString(response["access_token"]);
		const nextRefresh = nonEmptyString(response["refresh_token"]);
		const scope = nonEmptyString(response["scope"]);
		const expiresIn = typeof response["expires_in"] === "number" ? response["expires_in"] : 0;
		if (!accessToken || !nextRefresh || !scope || expiresIn <= 0) {
			throw ApiError.unavailable("Codex SIWC 刷新响应缺少 access_token/refresh_token/scope/expires_in");
		}
		if (!scope.split(/\s+/).includes(CODEX_OAUTH.siwcDirectScope)) {
			throw ApiError.unavailable(`Codex SIWC 授权未包含 ${CODEX_OAUTH.siwcDirectScope}`);
		}
		const now = Date.now();
		const expiresAtMs = now + expiresIn * 1000;
		const expiredMs = Math.max(now, expiresAtMs - CODEX_OAUTH.siwcExpiryMarginMs);
		const next: Record<string, unknown> = { ...disk };
		const updated: Record<string, unknown> = {
			...siwc,
			access_token: accessToken,
			refresh_token: nextRefresh,
			client_id: clientId,
			scope: scope,
			scopes: scope.split(/\s+/),
			expired: formatRfc3339(expiredMs),
			expires_at: formatRfc3339(expiresAtMs),
			last_refresh: formatRfc3339(now),
		};
		const idToken = nonEmptyString(response["id_token"]);
		if (idToken) {
			updated["id_token"] = idToken;
		}
		next["siwc"] = updated;
		await this._accounts.writeRaw(account.fileName, next);
		return next;
	}

	/**
	 * 请求 SIWC token 端点。
	 * @param refreshToken - SIWC refresh_token
	 * @param clientId - 登录时签发的 client_id
	 * @throws {ApiError} token 端点失败
	 */
	private async _requestSiwcRefresh(refreshToken: string, clientId: string): Promise<Record<string, unknown>> {
		try {
			return await postForm(
				this._siwcTokenUrl,
				{
					grant_type: "refresh_token",
					client_id: clientId,
					refresh_token: refreshToken,
					resource: CODEX_OAUTH.siwcResource,
				},
				this._httpOptions(),
			);
		} catch (error) {
			throw ApiError.unavailable(`Codex SIWC 凭据刷新失败：${redactSecrets(messageOf(error), [refreshToken])}`);
		}
	}

	/**
	 * 请求 token 端点刷新凭据。
	 * @param refreshToken - refresh_token
	 * @throws {ApiError} token 端点失败
	 */
	private async _requestRefresh(refreshToken: string): Promise<TokenEndpointResponse> {
		try {
			return await postForm(
				this._tokenUrl,
				{
					client_id: CODEX_OAUTH.clientId,
					grant_type: "refresh_token",
					refresh_token: refreshToken,
					scope: CODEX_OAUTH.refreshScope,
				},
				this._httpOptions(),
			);
		} catch (error) {
			throw ApiError.unavailable(`Codex 凭据刷新失败：${redactSecrets(messageOf(error), [refreshToken])}`);
		}
	}

	/**
	 * 用授权码换 token。
	 * @param code - authorization code
	 * @param verifier - PKCE verifier
	 * @param redirectUri - 本次授权使用的回调地址
	 * @throws {ApiError} token 端点失败
	 */
	private async _exchangeCode(code: string, verifier: string, redirectUri: string): Promise<TokenEndpointResponse> {
		try {
			return await postForm(
				this._tokenUrl,
				{
					grant_type: "authorization_code",
					client_id: CODEX_OAUTH.clientId,
					code: code,
					redirect_uri: redirectUri,
					code_verifier: verifier,
				},
				this._httpOptions(),
			);
		} catch (error) {
			throw ApiError.unavailable(`Codex 授权码换取 token 失败：${redactSecrets(messageOf(error), [code])}`);
		}
	}

	/**
	 * 把登录响应写入 auth 文件；同账号已有文件时原地更新并保留未知字段。
	 * @param response - token 端点响应
	 * @throws {ApiError} 响应缺少必要字段或写入失败
	 */
	private async _persistLoginCredential(response: TokenEndpointResponse): Promise<{ fileName: string; email: string }> {
		const accessToken = nonEmptyString(response.access_token);
		if (!accessToken) {
			throw ApiError.unavailable("Codex 登录响应缺少 access_token");
		}
		const idToken = nonEmptyString(response.id_token);
		const identity = codexIdentityFromTokens(idToken, accessToken);
		const fileName = await this._resolveCredentialFile(identity);
		const existing = await this._accounts.findByFileName(fileName);
		const previous = existing?.raw ?? {};
		const email = identity.email ?? nonEmptyString(previous["email"]);
		if (!email) {
			throw ApiError.unavailable("Codex 登录响应缺少邮箱，无法保存账号");
		}
		const planType = identity.planType ?? nonEmptyString(previous["plan_type"]) ?? "free";
		const now = Date.now();
		const raw: Record<string, unknown> = { ...previous };
		raw["type"] = "codex";
		raw["access_token"] = accessToken;
		raw["refresh_token"] = nonEmptyString(response.refresh_token) ?? nonEmptyString(previous["refresh_token"]) ?? "";
		raw["id_token"] = idToken ?? nonEmptyString(previous["id_token"]) ?? "";
		raw["account_id"] = identity.accountId ?? nonEmptyString(previous["account_id"]) ?? "";
		raw["email"] = email;
		raw["expired"] = formatRfc3339(codexTokenExpiryMs(response, accessToken, now));
		raw["last_refresh"] = formatRfc3339(now);
		raw["plan_type"] = planType;
		if (Object.hasOwn(previous, "expires_at")) {
			raw["expires_at"] = raw["expired"];
		}
		await this._accounts.writeRaw(fileName, raw);
		return { fileName: fileName, email: email };
	}

	/**
	 * 选择登录写入的文件名：同来源同账号已有文件时复用，否则生成不冲突的新文件名。
	 * @param identity - 登录身份
	 */
	private async _resolveCredentialFile(identity: CodexIdentity): Promise<string> {
		const accounts = await this._accounts.list("codex");
		const existing = accounts.find((account) => codexIdentityMatches(account.raw, identity));
		if (existing) {
			return existing.fileName;
		}
		const base = codexCredentialFileName(identity.email ?? "", identity.planType ?? "free", identity.accountId ?? "");
		for (let attempt = 0; attempt < FILE_NAME_ATTEMPTS; attempt += 1) {
			const candidate = attempt === 0 ? base : base.replace(/\.json$/, `-${attempt + 1}.json`);
			const absolute = path.join(this._accounts.authDir, candidate);
			if (!(await fileExists(absolute))) {
				return candidate;
			}
			const parsed = await this._accounts.findByFileName(candidate);
			if (parsed?.source === "codex" && codexIdentityMatches(parsed.raw, identity)) {
				return candidate;
			}
		}
		throw ApiError.conflict("无法为 Codex 账号生成唯一文件名");
	}

	/**
	 * 后台轮询设备码，授权后换 token 并写文件。
	 * @param session - 设备码会话
	 */
	private async _runDeviceLogin(session: CodexLoginSession): Promise<void> {
		const deadline = Date.now() + this._deviceTimeoutMs;
		const interval = session.pollIntervalMs ?? CODEX_OAUTH.deviceDefaultPollIntervalMs;
		try {
			while (!session.cancelled) {
				if (Date.now() > deadline) {
					throw ApiError.unavailable("Codex 设备码登录超时，请重新开始");
				}
				const response = await requestAuthJson(
					this._deviceTokenUrl,
					{
						method: "POST",
						headers: { "Content-Type": "application/json", Accept: "application/json" },
						body: JSON.stringify({
							device_auth_id: session.deviceAuthId ?? "",
							user_code: session.userCode ?? "",
						}),
					},
					this._httpOptions(),
				);
				if (session.cancelled) {
					return;
				}
				if (response.ok) {
					const code = nonEmptyString(response.body["authorization_code"]);
					const verifier = nonEmptyString(response.body["code_verifier"]);
					if (!code || !verifier) {
						throw ApiError.unavailable("Codex 设备码响应缺少 authorization_code 或 code_verifier");
					}
					const tokenResponse = await this._exchangeCode(code, verifier, this._deviceRedirectUri);
					if (session.cancelled) {
						return;
					}
					const saved = await this._persistLoginCredential(tokenResponse);
					session.state = "success";
					session.error = undefined;
					session.output = [...session.output, `Codex 设备码登录成功：${saved.email}（${saved.fileName}）`];
					return;
				}
				if (response.status === 403 || response.status === 404) {
					await this._sleep(session, interval);
					continue;
				}
				throw ApiError.unavailable(`Codex 设备码轮询失败（HTTP ${response.status}）`);
			}
		} catch (error) {
			if (!session.cancelled) {
				session.state = "error";
				session.error = messageOf(error);
			}
		}
	}

	/**
	 * 可被取消的等待。
	 * @param session - 会话
	 * @param ms - 等待毫秒
	 */
	private async _sleep(session: CodexLoginSession, ms: number): Promise<void> {
		if (session.cancelled) {
			return;
		}
		await new Promise<void>((resolve) => {
			const timer = setTimeout(
				() => {
					session.wake = undefined;
					resolve();
				},
				Math.max(ms, 0),
			);
			session.wake = () => {
				clearTimeout(timer);
				session.wake = undefined;
				resolve();
			};
		});
	}

	/**
	 * 保存会话并淘汰最旧会话，保持内存上限。
	 * @param session - 新会话
	 */
	private _storeSession(session: CodexLoginSession): void {
		if (this._sessions.size >= this._maxLoginSessions) {
			const candidates = [...this._sessions.values()].sort((left, right) => left.createdAt - right.createdAt);
			const victim = candidates.find((candidate) => candidate.state !== "pending") ?? candidates[0];
			if (victim) {
				victim.cancelled = true;
				victim.wake?.();
				this._sessions.delete(victim.id);
			}
		}
		this._sessions.set(session.id, session);
	}

	/**
	 * 清理过期会话；待授权会话转为 error 并停止后台轮询。
	 */
	private _pruneSessions(): void {
		const now = Date.now();
		for (const [id, session] of this._sessions) {
			if (session.state === "pending" && now > session.expiresAt) {
				session.state = "error";
				session.error = "登录会话已过期，请重新开始";
				session.cancelled = true;
				session.wake?.();
			}
			if (session.state !== "pending" && now > session.expiresAt + 5 * 60 * 1000) {
				session.cancelled = true;
				session.wake?.();
				this._sessions.delete(id);
			}
		}
	}

	/**
	 * 按 ID 读取会话。
	 * @param id - 会话 ID
	 * @throws {ApiError} 会话不存在
	 */
	private _requireSession(id: string): CodexLoginSession {
		const session = this._sessions.get(id);
		if (!session) {
			throw ApiError.notFound("登录会话不存在或已过期");
		}
		return session;
	}

	/**
	 * 转成只读快照，避免调用方修改内部状态。
	 * @param session - 内部会话
	 */
	private _toLoginSession(session: CodexLoginSession): SubscriptionLoginSession {
		return {
			id: session.id,
			state: session.state,
			url: session.url,
			output: [...session.output],
			prompt: session.prompt,
			error: session.error,
		};
	}

	/**
	 * 组装 HTTP 选项。
	 */
	private _httpOptions(): AuthRequestOptions {
		return { fetch: this._fetch, timeoutMs: this._requestTimeoutMs };
	}
}

/**
 * 创建 Codex 订阅鉴权处理器。
 * @param dependencies - 仓库、fetch 与端点覆盖
 */
export function createCodexAuth(dependencies: CodexAuthDependencies): CodexAuthHandler {
	return new CodexAuth(dependencies);
}
