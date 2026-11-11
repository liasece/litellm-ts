/**
 * xAI 订阅账号鉴权。
 *
 * xAI 只提供 OAuth 设备码登录：`startLogin` 通过 OIDC discovery 解析端点、
 * 申请 device code，并在后台轮询 token 端点；`pollLogin` 读取会话状态。
 * token 刷新使用账号仓库的文件锁串行化，写回时保留未知字段。
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
import { postForm } from "./http";
import type { TokenEndpointResponse } from "./http";
import {
	discoverXaiEndpoints,
	formatXaiRfc3339,
	nonEmptyXaiString,
	requestXaiJson,
	xaiCredentialFileName,
	xaiDeviceIntervalMs,
	xaiExpiryMs,
	xaiIdentityFromToken,
	XAI_OAUTH,
	xaiTokenExpiryMs,
} from "./xaiOAuth";
import type { XaiDiscovery, XaiRequestOptions } from "./xaiOAuth";

/** 登录会话默认 TTL（毫秒）。 */
const LOGIN_SESSION_TTL_MS = 30 * 60 * 1000;
/** 登录会话数量上限。 */
const LOGIN_SESSION_LIMIT = 8;
/** 账号文件锁等待上限（毫秒）。 */
const FILE_LOCK_TIMEOUT_MS = 30_000;
/** 账号文件名冲突时的生成尝试次数。 */
const FILE_NAME_ATTEMPTS = 50;

/** xAI 鉴权处理器依赖。 */
export interface XaiAuthDependencies {
	/** 账号仓库。 */
	readonly accounts: SubscriptionAccountStore;
	/** 注入的 fetch；缺省使用全局 fetch。 */
	readonly fetch?: typeof fetch;
	/** OIDC discovery 地址覆盖。 */
	readonly discoveryUrl?: string;
	/** 设备授权端点覆盖；与 tokenEndpoint 同时提供时跳过 discovery。 */
	readonly deviceAuthorizationEndpoint?: string;
	/** token 端点覆盖；与 deviceAuthorizationEndpoint 同时提供时跳过 discovery。 */
	readonly tokenEndpoint?: string;
	/** 是否允许非 https/非 x.ai 端点；仅用于本地测试。 */
	readonly allowInsecureEndpoints?: boolean;
	/** 设备码轮询间隔覆盖（毫秒）。 */
	readonly devicePollIntervalMs?: number;
	/** 登录会话 TTL 覆盖（毫秒）。 */
	readonly loginSessionTtlMs?: number;
	/** 登录会话数量上限。 */
	readonly maxLoginSessions?: number;
	/** 单次 HTTP 请求超时（毫秒）。 */
	readonly requestTimeoutMs?: number;
}

/** xAI 鉴权处理器。 */
export interface XaiAuthHandler extends SubscriptionAuthHandler {
	/** 来源。 */
	readonly source: SubscriptionSource;
	/**
	 * 启动 xAI 设备码登录。
	 */
	startLogin(): Promise<SubscriptionLoginSession>;
	/**
	 * 轮询登录会话状态。
	 * @param id - 会话 ID
	 */
	pollLogin(id: string): Promise<SubscriptionLoginSession>;
	/**
	 * 取消并清理登录会话。
	 * @param id - 会话 ID
	 */
	cancelLogin(id: string): Promise<void>;
}

/** 内存中的 xAI 登录会话。 */
interface XaiLoginSession {
	/** 会话 ID。 */
	readonly id: string;
	/** 当前状态。 */
	state: SubscriptionLoginState;
	/** 授权 URL。 */
	readonly url: string;
	/** 输出行。 */
	output: string[];
	/** 失败原因。 */
	error?: string;
	/** 创建时间。 */
	readonly createdAt: number;
	/** 过期时间。 */
	expiresAt: number;
	/** device_code。 */
	readonly deviceCode: string;
	/** user_code，仅用于展示。 */
	readonly userCode?: string;
	/** token 端点。 */
	readonly tokenEndpoint: string;
	/** 轮询间隔。 */
	readonly pollIntervalMs: number;
	/** 等待授权的 deadline。 */
	readonly deadlineMs: number;
	/** 是否已取消。 */
	cancelled: boolean;
	/** 唤醒后台轮询的 sleep。 */
	wake?: () => void;
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
 * 判断 auth JSON 是否属于本次登录的同一 xAI 账号。
 *
 * 邮箱大小写不敏感；subject 精确匹配。至少一个身份字段相符且不冲突。
 * @param raw - 磁盘上的 auth JSON
 * @param email - 本次登录邮箱
 * @param subject - 本次登录 subject
 */
function xaiIdentityMatches(raw: Record<string, unknown>, email: string | undefined, subject: string | undefined): boolean {
	const rawEmail = nonEmptyXaiString(raw["email"]);
	// 与 Go 的 `CredentialFileName` 一致：有邮箱时邮箱就是账号主键，
	// 只有邮箱缺失时才用 subject 兜底。
	if (email !== undefined && rawEmail !== undefined) {
		return email.toLowerCase() === rawEmail.toLowerCase();
	}
	const rawSubject = nonEmptyXaiString(raw["sub"]);
	return subject !== undefined && rawSubject !== undefined && subject === rawSubject;
}

/**
 * xAI 鉴权处理器实现。
 */
class XaiAuth implements XaiAuthHandler {
	readonly source: SubscriptionSource = "xai";
	private readonly _accounts: SubscriptionAccountStore;
	private readonly _fetch?: typeof fetch;
	private readonly _discoveryUrl: string;
	private readonly _deviceAuthorizationEndpoint?: string;
	private readonly _tokenEndpoint?: string;
	private readonly _allowInsecureEndpoints: boolean;
	private readonly _devicePollIntervalMs?: number;
	private readonly _loginSessionTtlMs: number;
	private readonly _maxLoginSessions: number;
	private readonly _requestTimeoutMs: number;
	private readonly _sessions = new Map<string, XaiLoginSession>();
	private readonly _inflight = new Map<string, Promise<Record<string, unknown>>>();

	constructor(dependencies: XaiAuthDependencies) {
		this._accounts = dependencies.accounts;
		this._fetch = dependencies.fetch;
		this._discoveryUrl = dependencies.discoveryUrl ?? XAI_OAUTH.discoveryUrl;
		this._deviceAuthorizationEndpoint = dependencies.deviceAuthorizationEndpoint;
		this._tokenEndpoint = dependencies.tokenEndpoint;
		this._allowInsecureEndpoints = dependencies.allowInsecureEndpoints === true;
		this._devicePollIntervalMs = dependencies.devicePollIntervalMs;
		this._loginSessionTtlMs = dependencies.loginSessionTtlMs ?? LOGIN_SESSION_TTL_MS;
		this._maxLoginSessions = Math.max(1, Math.trunc(dependencies.maxLoginSessions ?? LOGIN_SESSION_LIMIT));
		this._requestTimeoutMs = dependencies.requestTimeoutMs ?? 30_000;
	}

	async ensureCredential(account: SubscriptionAccount): Promise<string> {
		const accessToken = nonEmptyXaiString(account.raw["access_token"]);
		const expiresAt = account.expiresAt ?? xaiExpiryMs(account.raw);
		const expiring = typeof expiresAt === "number" && expiresAt <= Date.now() + XAI_OAUTH.refreshLeadMs;
		if (accessToken && !expiring) {
			return accessToken;
		}
		const refreshed = await this._refreshOnce(account, true);
		const next = nonEmptyXaiString(refreshed["access_token"]);
		if (!next) {
			throw ApiError.unavailable("xAI 账号刷新后仍缺少 access_token");
		}
		return next;
	}

	async refresh(account: SubscriptionAccount): Promise<void> {
		await this._refreshOnce(account, false);
	}

	async startLogin(): Promise<SubscriptionLoginSession> {
		this._pruneSessions();
		const discovery = await this._discover();
		const response = await requestXaiJson(
			discovery.deviceAuthorizationEndpoint,
			{
				method: "POST",
				headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
				body: new URLSearchParams({ client_id: XAI_OAUTH.clientId, scope: XAI_OAUTH.scope }).toString(),
			},
			this._httpOptions(),
		);
		if (!response.ok) {
			throw ApiError.unavailable(`xAI 设备码申请失败（HTTP ${response.status}）`);
		}
		const deviceCode = nonEmptyXaiString(response.body["device_code"]);
		const userCode = nonEmptyXaiString(response.body["user_code"]);
		const verificationUri =
			nonEmptyXaiString(response.body["verification_uri_complete"]) ??
			nonEmptyXaiString(response.body["verification_uri"]);
		if (!deviceCode || !userCode || !verificationUri) {
			throw ApiError.unavailable("xAI 设备码响应缺少 device_code、user_code 或验证地址");
		}
		const expiresIn = response.body["expires_in"];
		const expiresInMs =
			typeof expiresIn === "number" && Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn * 1000 : undefined;
		const deadlineMs = Date.now() + Math.min(XAI_OAUTH.maxPollDurationMs, expiresInMs ?? XAI_OAUTH.maxPollDurationMs);
		const pollIntervalMs =
			this._devicePollIntervalMs ??
			Math.max(
				xaiDeviceIntervalMs(response.body["interval"]) ?? XAI_OAUTH.defaultPollIntervalMs,
				XAI_OAUTH.defaultPollIntervalMs,
			);
		const output = [
			"已申请 xAI 设备码。",
			`在浏览器打开：${verificationUri}`,
			`输入代码：${userCode}`,
			"等待授权完成，此页面会自动更新。",
		];
		const session: XaiLoginSession = {
			id: randomBytes(12).toString("hex"),
			state: "pending",
			url: verificationUri,
			output: output,
			createdAt: Date.now(),
			expiresAt: deadlineMs,
			deviceCode: deviceCode,
			userCode: userCode,
			tokenEndpoint: discovery.tokenEndpoint,
			pollIntervalMs: pollIntervalMs,
			deadlineMs: deadlineMs,
			cancelled: false,
		};
		this._storeSession(session);
		void this._runLoginPolling(session);
		return this._toLoginSession(session);
	}

	async pollLogin(id: string): Promise<SubscriptionLoginSession> {
		this._pruneSessions();
		const session = this._requireSession(id);
		return this._toLoginSession(session);
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

	/**
	 * 在文件锁内刷新凭据；并发调用只消费一次 refresh_token。
	 * @param account - 账号
	 * @param skipIfFresh - 其他调用已刷新出可用 token 时跳过 POST；`ensureCredential` 使用
	 */
	private async _refreshOnce(account: SubscriptionAccount, skipIfFresh: boolean): Promise<Record<string, unknown>> {
		const key = account.fileName;
		const existing = this._inflight.get(key);
		if (existing) {
			return existing;
		}
		const task = this._refreshUnderLock(account, skipIfFresh).finally(() => {
			this._inflight.delete(key);
		});
		this._inflight.set(key, task);
		return task;
	}

	/**
	 * 读取锁内最新文件并刷新；失败时不写回。
	 * @param account - 账号
	 * @param skipIfFresh - 磁盘凭据已被其他调用刷新且仍有效时直接复用
	 * @throws {ApiError} 缺少 refresh_token、刷新失败或写回失败
	 */
	private async _refreshUnderLock(account: SubscriptionAccount, skipIfFresh: boolean): Promise<Record<string, unknown>> {
		return this._accounts.withFileLock(account.fileName, FILE_LOCK_TIMEOUT_MS, async () => {
			const disk = await this._accounts.readRaw(account.fileName);
			const diskAccess = nonEmptyXaiString(disk["access_token"]);
			const diskRefresh = nonEmptyXaiString(disk["refresh_token"]);
			const baselineAccess = nonEmptyXaiString(account.raw["access_token"]);
			const baselineRefresh = nonEmptyXaiString(account.raw["refresh_token"]);
			const rotated =
				(diskAccess !== undefined && diskAccess !== baselineAccess) ||
				(diskRefresh !== undefined && diskRefresh !== baselineRefresh);
			if (skipIfFresh && rotated && !this._needsRefresh(disk)) {
				return disk;
			}
			const refreshToken = diskRefresh ?? baselineRefresh;
			if (!refreshToken) {
				throw ApiError.unavailable("xAI 订阅账号缺少 refresh_token，请重新登录");
			}
			const endpoint = await this._resolveTokenEndpoint(disk);
			const response = await this._requestRefresh(refreshToken, endpoint.tokenEndpoint);
			const accessToken = nonEmptyXaiString(response.access_token);
			if (!accessToken) {
				throw ApiError.unavailable("xAI 刷新响应缺少 access_token");
			}
			const idToken = nonEmptyXaiString(response.id_token);
			const identity = xaiIdentityFromToken(idToken);
			const now = Date.now();
			const next: Record<string, unknown> = { ...disk };
			next["type"] = "xai";
			next["auth_kind"] = "oauth";
			next["access_token"] = accessToken;
			next["refresh_token"] = nonEmptyXaiString(response.refresh_token) ?? diskRefresh ?? refreshToken;
			if (idToken) {
				next["id_token"] = idToken;
			}
			const tokenType = nonEmptyXaiString(response.token_type);
			if (tokenType) {
				next["token_type"] = tokenType;
			}
			const expiresIn = response["expires_in"];
			if (typeof expiresIn === "number" && Number.isFinite(expiresIn) && expiresIn > 0) {
				next["expires_in"] = expiresIn;
			}
			const email = identity.email ?? nonEmptyXaiString(disk["email"]);
			if (email) {
				next["email"] = email;
			}
			const subject = identity.subject ?? nonEmptyXaiString(disk["sub"]);
			if (subject) {
				next["sub"] = subject;
			}
			if (!nonEmptyXaiString(disk["base_url"])) {
				next["base_url"] = XAI_OAUTH.defaultApiBaseUrl;
			}
			next["token_endpoint"] = endpoint.tokenEndpoint;
			next["expired"] = formatXaiRfc3339(xaiTokenExpiryMs(response, accessToken, now));
			if (Object.hasOwn(disk, "expires_at")) {
				next["expires_at"] = next["expired"];
			}
			next["last_refresh"] = formatXaiRfc3339(now);
			await this._accounts.writeRaw(account.fileName, next);
			return next;
		});
	}

	/**
	 * 判断磁盘凭据是否已进入刷新窗口。
	 * @param raw - auth JSON
	 */
	private _needsRefresh(raw: Record<string, unknown>): boolean {
		const expiresAt = xaiExpiryMs(raw);
		return typeof expiresAt === "number" && expiresAt <= Date.now() + XAI_OAUTH.refreshLeadMs;
	}

	/**
	 * 解析刷新使用的 token 端点：磁盘记录优先，缺失时走 discovery。
	 * @param raw - auth JSON
	 */
	private async _resolveTokenEndpoint(raw: Record<string, unknown>): Promise<XaiDiscovery> {
		const stored = nonEmptyXaiString(raw["token_endpoint"]);
		if (stored) {
			return { deviceAuthorizationEndpoint: "", tokenEndpoint: stored };
		}
		return this._discover();
	}

	/**
	 * 通过 OIDC discovery（或显式覆盖端点）解析 xAI OAuth 端点。
	 * @throws {ApiError} discovery 失败或端点不合法
	 */
	private async _discover(): Promise<XaiDiscovery> {
		return discoverXaiEndpoints({
			discoveryUrl: this._discoveryUrl,
			deviceAuthorizationEndpoint: this._deviceAuthorizationEndpoint,
			tokenEndpoint: this._tokenEndpoint,
			allowInsecure: this._allowInsecureEndpoints,
			fetch: this._fetch,
			timeoutMs: this._requestTimeoutMs,
		});
	}

	/**
	 * 请求 token 端点刷新凭据。
	 * @param refreshToken - refresh_token
	 * @param tokenEndpoint - token 端点
	 * @throws {ApiError} token 端点失败
	 */
	private async _requestRefresh(refreshToken: string, tokenEndpoint: string): Promise<TokenEndpointResponse> {
		try {
			return await postForm(
				tokenEndpoint,
				{
					grant_type: "refresh_token",
					client_id: XAI_OAUTH.clientId,
					refresh_token: refreshToken,
				},
				this._httpOptions(),
			);
		} catch (error) {
			throw ApiError.unavailable(`xAI 凭据刷新失败：${redactSecrets(messageOf(error), [refreshToken])}`);
		}
	}

	/**
	 * 后台轮询设备码，授权后把 token 写入 auth 文件。
	 * @param session - 设备码会话
	 */
	private async _runLoginPolling(session: XaiLoginSession): Promise<void> {
		let intervalMs = session.pollIntervalMs;
		const slowDownStepMs = this._devicePollIntervalMs ?? XAI_OAUTH.defaultPollIntervalMs;
		try {
			while (!session.cancelled) {
				if (Date.now() > session.deadlineMs) {
					throw ApiError.unavailable("xAI 设备码授权等待超时，请重新开始");
				}
				const response = await requestXaiJson(
					session.tokenEndpoint,
					{
						method: "POST",
						headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
						body: new URLSearchParams({
							grant_type: XAI_OAUTH.deviceGrantType,
							device_code: session.deviceCode,
							client_id: XAI_OAUTH.clientId,
						}).toString(),
					},
					this._httpOptions(),
				);
				if (session.cancelled) {
					return;
				}
				const error = nonEmptyXaiString(response.body["error"]);
				if (error) {
					switch (error) {
						case "authorization_pending":
							await this._sleep(session, intervalMs);
							continue;
						case "slow_down":
							intervalMs += slowDownStepMs;
							await this._sleep(session, intervalMs);
							continue;
						case "expired_token":
							throw ApiError.unavailable("xAI 设备码已过期，请重新开始");
						case "access_denied":
							throw ApiError.unavailable("xAI 设备授权被拒绝");
						default: {
							const description = nonEmptyXaiString(response.body["error_description"]);
							throw ApiError.unavailable(`xAI 设备码授权失败：${description ?? error}`);
						}
					}
				}
				if (!response.ok) {
					throw ApiError.unavailable(`xAI 设备码轮询失败（HTTP ${response.status}）`);
				}
				const accessToken = nonEmptyXaiString(response.body["access_token"]);
				if (!accessToken) {
					throw ApiError.unavailable("xAI 设备码响应缺少 access_token");
				}
				const saved = await this._persistLoginCredential(response.body, session.tokenEndpoint);
				session.state = "success";
				session.error = undefined;
				session.output = [...session.output, `xAI 登录成功：${saved.email ?? saved.subject ?? saved.fileName}`];
				return;
			}
		} catch (error) {
			if (!session.cancelled) {
				session.state = "error";
				session.error = messageOf(error);
			}
		}
	}

	/**
	 * 把设备码换到的 token 写入 auth 文件；同账号已有文件时原地更新。
	 * @param response - token 端点响应
	 * @param tokenEndpoint - 本次使用的 token 端点
	 * @throws {ApiError} 缺少必要字段或写入失败
	 */
	private async _persistLoginCredential(
		response: Record<string, unknown>,
		tokenEndpoint: string,
	): Promise<{ fileName: string; email?: string; subject?: string }> {
		const accessToken = nonEmptyXaiString(response["access_token"]);
		if (!accessToken) {
			throw ApiError.unavailable("xAI 登录响应缺少 access_token");
		}
		const idToken = nonEmptyXaiString(response["id_token"]);
		const identity = xaiIdentityFromToken(idToken);
		const fileName = await this._resolveCredentialFile(identity.email, identity.subject);
		const existing = await this._accounts.findByFileName(fileName);
		const previous = existing?.raw ?? {};
		const email = identity.email ?? nonEmptyXaiString(previous["email"]);
		const subject = identity.subject ?? nonEmptyXaiString(previous["sub"]);
		const now = Date.now();
		const raw: Record<string, unknown> = { ...previous };
		raw["type"] = "xai";
		raw["access_token"] = accessToken;
		raw["refresh_token"] = nonEmptyXaiString(response["refresh_token"]) ?? nonEmptyXaiString(previous["refresh_token"]) ?? "";
		const nextIdToken = idToken ?? nonEmptyXaiString(previous["id_token"]);
		if (nextIdToken) {
			raw["id_token"] = nextIdToken;
		}
		const tokenType = nonEmptyXaiString(response["token_type"]) ?? nonEmptyXaiString(previous["token_type"]);
		if (tokenType) {
			raw["token_type"] = tokenType;
		}
		const expiresIn = response["expires_in"];
		if (typeof expiresIn === "number" && Number.isFinite(expiresIn) && expiresIn > 0) {
			raw["expires_in"] = expiresIn;
		}
		if (email) {
			raw["email"] = email;
		}
		if (subject) {
			raw["sub"] = subject;
		}
		raw["expired"] = formatXaiRfc3339(xaiTokenExpiryMs(response, accessToken, now));
		if (Object.hasOwn(previous, "expires_at")) {
			raw["expires_at"] = raw["expired"];
		}
		raw["last_refresh"] = formatXaiRfc3339(now);
		raw["base_url"] = nonEmptyXaiString(previous["base_url"]) ?? XAI_OAUTH.defaultApiBaseUrl;
		raw["token_endpoint"] = tokenEndpoint;
		raw["auth_kind"] = "oauth";
		await this._accounts.writeRaw(fileName, raw);
		return { fileName: fileName, email: email, subject: subject };
	}

	/**
	 * 选择登录写入的文件名：同来源同账号已有文件时复用，否则生成不冲突的新文件名。
	 * @param email - 登录邮箱
	 * @param subject - 登录 subject
	 */
	private async _resolveCredentialFile(email: string | undefined, subject: string | undefined): Promise<string> {
		const accounts = await this._accounts.list("xai");
		const existing = accounts.find((account) => xaiIdentityMatches(account.raw, email, subject));
		if (existing) {
			return existing.fileName;
		}
		const base = xaiCredentialFileName(email ?? "", subject ?? "");
		for (let attempt = 0; attempt < FILE_NAME_ATTEMPTS; attempt += 1) {
			const candidate = attempt === 0 ? base : base.replace(/\.json$/, `-${attempt + 1}.json`);
			const absolute = path.join(this._accounts.authDir, candidate);
			if (!(await fileExists(absolute))) {
				return candidate;
			}
			const parsed = await this._accounts.findByFileName(candidate);
			if (parsed?.source === "xai" && xaiIdentityMatches(parsed.raw, email, subject)) {
				return candidate;
			}
		}
		throw ApiError.conflict("无法为 xAI 账号生成唯一文件名");
	}

	/**
	 * 可被取消的等待。
	 * @param session - 会话
	 * @param ms - 等待毫秒
	 */
	private async _sleep(session: XaiLoginSession, ms: number): Promise<void> {
		if (session.cancelled) {
			return;
		}
		await new Promise<void>((resolve) => {
			const timer = setTimeout(() => {
				session.wake = undefined;
				resolve();
			}, Math.max(ms, 0));
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
	private _storeSession(session: XaiLoginSession): void {
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
	private _requireSession(id: string): XaiLoginSession {
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
	private _toLoginSession(session: XaiLoginSession): SubscriptionLoginSession {
		return {
			id: session.id,
			state: session.state,
			url: session.url,
			output: [...session.output],
			error: session.error,
		};
	}

	/**
	 * 组装 HTTP 选项。
	 */
	private _httpOptions(): XaiRequestOptions {
		return { fetch: this._fetch, timeoutMs: this._requestTimeoutMs };
	}
}

/**
 * 创建 xAI 订阅鉴权处理器。
 * @param dependencies - 仓库、fetch 与端点覆盖
 */
export function createXaiAuth(dependencies: XaiAuthDependencies): XaiAuthHandler {
	return new XaiAuth(dependencies);
}
