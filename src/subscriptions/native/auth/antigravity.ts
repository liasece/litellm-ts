/**
 * Antigravity 订阅鉴权。
 *
 * 账号仍以 auth JSON 文件为持久化载体：`type: "antigravity"`、`access_token`、
 * `refresh_token`、`expires_in`、`timestamp`、`expired`、`email`、`project_id`
 * 等字段与 Go 运行时（CLIProxyAPI）保持一致，未知字段原样保留。刷新在账号文件
 * 锁内重读、请求 Google token 端点并原子写回；登录使用 Google OAuth PKCE，
 * 由用户手动粘贴回调地址或授权码。
 */

import { randomUUID } from "node:crypto";
import { ApiError } from "../../../core/api/ApiError";
import { logger } from "../../../core/utils/logger";
import type { SubscriptionAccountStore } from "../accountStore";
import type { SubscriptionAccount, SubscriptionAuthHandler, SubscriptionLoginSession, SubscriptionSource } from "../types";
import { ANTIGRAVITY_AUTH_TYPE, ANTIGRAVITY_REDIRECT_URI } from "./antigravityConstants";
import {
	buildAntigravityAuthUrl,
	exchangeAntigravityCode,
	fetchAntigravityEmail,
	refreshAntigravityToken,
	requestAntigravityProjectId,
	type AntigravityTokenSet,
} from "./antigravityEndpoints";
import { createPkce, createState, parseJwtPayload } from "./http";
import type { PkcePair } from "./http";
import { singleFlight } from "./inflight";

/** 刷新提前量：access token 到期前 5 分钟开始刷新。 */
const REFRESH_SKEW_MS = 5 * 60_000;

/** token 响应缺少 `expires_in` 时使用的有效期秒数。 */
const DEFAULT_EXPIRES_IN_SECONDS = 3_600;

/** 账号文件锁等待上限。 */
const FILE_LOCK_TIMEOUT_MS = 30_000;

/** 登录会话默认存活时间。 */
const LOGIN_SESSION_TTL_MS = 15 * 60_000;

/** 内存中同时保留的登录会话上限。 */
const LOGIN_SESSION_LIMIT = 8;

/** 账号文件后缀。 */
const ACCOUNT_SUFFIX = ".json";

/** Antigravity 鉴权处理器的依赖。 */
export interface AntigravityAuthDependencies {
	/** 账号仓库。 */
	readonly accounts: SubscriptionAccountStore;
	/** 注入的 fetch；测试用它避免真实网络。 */
	readonly fetch?: typeof fetch;
	/** 注入的当前时间（毫秒）。 */
	readonly now?: () => number;
	/** 注入的休眠，用于 onboardUser 轮询。 */
	readonly sleep?: (ms: number) => Promise<void>;
	/** 登录回调地址覆盖；缺省使用 Go 实现的 localhost 回调。 */
	readonly redirectUri?: string;
	/** 登录会话存活时间；缺省 15 分钟。 */
	readonly loginSessionTtlMs?: number;
	/** 内存中同时保留的登录会话上限；缺省 8。 */
	readonly maxLoginSessions?: number;
	/** 单次 HTTP 请求超时（毫秒）；缺省 30 秒。 */
	readonly requestTimeoutMs?: number;
}

/** 刷新结果。 */
interface RefreshedCredential {
	/** 新 access token。 */
	readonly accessToken: string;
	/** 账号 project_id；onboarding 失败时为空串。 */
	readonly projectId: string;
	/** onboarding 失败原因；成功时缺省。 */
	readonly projectError?: string;
}

/** 登录会话的内部状态。 */
interface AntigravityLoginSessionRecord {
	/** 会话 ID。 */
	readonly id: string;
	/** 需要用户打开的授权 URL。 */
	readonly url: string;
	/** 本次 OAuth 的 state。 */
	readonly stateParam: string;
	/** 本次 OAuth 的 PKCE 参数。 */
	readonly pkce: PkcePair;
	/** 换取 token 时使用的回调地址。 */
	readonly redirectUri: string;
	/** 创建时间（毫秒）。 */
	readonly createdAt: number;
	/** 终端式输出行。 */
	readonly output: string[];
	/** 当前状态。 */
	state: SubscriptionLoginSession["state"];
	/** 需要用户输入的提示。 */
	prompt?: string;
	/** 失败原因。 */
	error?: string;
	/** 是否正在处理用户输入。 */
	busy: boolean;
}

/** 从用户输入解析出的回调信息。 */
interface ParsedCallbackInput {
	/** 授权码。 */
	readonly code?: string;
	/** Google 返回的错误。 */
	readonly error?: string;
	/** state 是否与本次会话不匹配。 */
	readonly stateMismatch?: boolean;
}

/**
 * 创建 Antigravity 鉴权处理器。
 * @param dependencies - 账号仓库、注入的 fetch/时钟与登录会话限制
 */
export function createAntigravityAuth(dependencies: AntigravityAuthDependencies): SubscriptionAuthHandler {
	return new AntigravityAuthHandler(dependencies);
}

/**
 * Antigravity 的 `SubscriptionAuthHandler` 实现。
 */
class AntigravityAuthHandler implements SubscriptionAuthHandler {
	public readonly source: SubscriptionSource = ANTIGRAVITY_AUTH_TYPE;

	private readonly _accounts: SubscriptionAccountStore;

	private readonly _inflight = new Map<string, Promise<RefreshedCredential>>();

	private readonly _fetch: typeof fetch | undefined;

	private readonly _now: () => number;

	private readonly _sleep: (ms: number) => Promise<void>;

	private readonly _redirectUri: string;

	private readonly _sessionTtlMs: number;

	private readonly _sessionLimit: number;

	private readonly _requestTimeoutMs: number | undefined;

	private readonly _sessions = new Map<string, AntigravityLoginSessionRecord>();

	constructor(dependencies: AntigravityAuthDependencies) {
		this._accounts = dependencies.accounts;
		this._fetch = dependencies.fetch;
		this._now = dependencies.now ?? ((): number => Date.now());
		this._sleep = dependencies.sleep ?? defaultSleep;
		this._redirectUri = dependencies.redirectUri ?? ANTIGRAVITY_REDIRECT_URI;
		this._sessionTtlMs = positiveOr(dependencies.loginSessionTtlMs, LOGIN_SESSION_TTL_MS);
		this._sessionLimit = Math.max(1, Math.trunc(positiveOr(dependencies.maxLoginSessions, LOGIN_SESSION_LIMIT)));
		this._requestTimeoutMs = positiveNumber(dependencies.requestTimeoutMs);
	}

	/**
	 * 返回可用 access token；到期前 5 分钟或缺少 project_id 时先补齐凭据。
	 * @param account - 选中账号
	 */
	public async ensureCredential(account: SubscriptionAccount): Promise<string> {
		const raw = await this._readSnapshot(account);
		const accessToken = trimmedString(raw["access_token"]);
		const expiresAt = resolveAccessTokenExpiry(raw);
		// 缺少到期信息时按 Go 的行为保守刷新，避免把状态不明的 token 直接发给上游。
		if (accessToken && expiresAt !== undefined && expiresAt - this._now() > REFRESH_SKEW_MS) {
			if (!trimmedString(raw["project_id"])) {
				await this._fillMissingProject(account, accessToken);
			}
			return accessToken;
		}
		const refreshed = await this._refreshWithLock(account);
		if (!refreshed.projectId) {
			const detail = refreshed.projectError ? `：${refreshed.projectError}` : "";
			throw ApiError.unauthorized(`Antigravity 账号缺少 project_id，请重新登录${detail}`);
		}
		return refreshed.accessToken;
	}

	/**
	 * 强制刷新账号凭据并原子写回。
	 * @param account - 选中账号
	 */
	public async refresh(account: SubscriptionAccount): Promise<void> {
		await this._refreshWithLock(account);
	}

	/**
	 * 启动 Google OAuth PKCE 登录，返回授权 URL。
	 */
	public async startLogin(): Promise<SubscriptionLoginSession> {
		const nowMs = this._now();
		this._pruneSessions(nowMs);
		const pkce = createPkce();
		const stateParam = createState();
		const record: AntigravityLoginSessionRecord = {
			id: randomUUID(),
			url: buildAntigravityAuthUrl(stateParam, pkce.challenge, this._redirectUri),
			stateParam: stateParam,
			pkce: pkce,
			redirectUri: this._redirectUri,
			createdAt: nowMs,
			output: [
				"已生成 Google OAuth 授权链接。",
				"完成授权后浏览器会跳转到本地回调地址；请把地址栏里的完整 URL（或授权码）粘贴回来。",
			],
			state: "pending",
			prompt: "粘贴 Antigravity 回调 URL 或授权码",
			busy: false,
		};
		this._sessions.set(record.id, record);
		this._enforceSessionLimit();
		return snapshotSession(record);
	}

	/**
	 * 轮询登录会话状态。
	 * @param id - 会话 ID
	 */
	public async pollLogin(id: string): Promise<SubscriptionLoginSession> {
		const record = this._sessions.get(id);
		if (!record) {
			throw ApiError.notFound("登录会话不存在或已过期，请重新发起登录");
		}
		if (this._isSessionExpired(record)) {
			this._sessions.delete(id);
			return expiredSession(record);
		}
		return snapshotSession(record);
	}

	/**
	 * 提交回调 URL 或授权码，完成 token 交换、onboarding 与账号文件写入。
	 * @param id - 会话 ID
	 * @param input - 完整回调 URL 或授权码
	 */
	public async submitLoginInput(id: string, input: string): Promise<SubscriptionLoginSession> {
		const record = this._sessions.get(id);
		if (!record) {
			throw ApiError.notFound("登录会话不存在或已过期，请重新发起登录");
		}
		if (this._isSessionExpired(record)) {
			this._sessions.delete(id);
			throw ApiError.notFound("登录会话已过期，请重新发起登录");
		}
		if (record.state !== "pending") {
			return snapshotSession(record);
		}
		if (record.busy) {
			throw ApiError.conflict("登录会话正在处理中，请稍后轮询结果");
		}
		const parsed = parseCallbackInput(input, record.stateParam);
		if (parsed.error) {
			return this._failSession(record, `Google 授权失败：${parsed.error}`);
		}
		if (parsed.stateMismatch) {
			return this._failSession(record, "OAuth state 不匹配，请重新发起登录");
		}
		const code = parsed.code;
		if (!code) {
			throw ApiError.badRequest("回调 URL 缺少 code 参数，请粘贴完整回调地址或授权码");
		}

		record.busy = true;
		try {
			record.output.push("正在用授权码换取 Google token…");
			let tokens: AntigravityTokenSet;
			try {
				tokens = await exchangeAntigravityCode(code, record.pkce.verifier, record.redirectUri, {
					fetch: this._fetch,
					timeoutMs: this._requestTimeoutMs,
				});
			} catch (error) {
				return this._failSession(record, `Antigravity token 交换失败：${redactSecrets(errorMessage(error), [code])}`);
			}
			const refreshToken = tokens.refreshToken;
			if (!refreshToken) {
				return this._failSession(record, "Google 未返回 refresh token，请撤销授权后重新登录");
			}

			record.output.push("正在读取 Google 账号信息…");
			let email: string;
			try {
				email = await fetchAntigravityEmail(tokens.accessToken, {
					fetch: this._fetch,
					timeoutMs: this._requestTimeoutMs,
				});
			} catch (error) {
				return this._failSession(
					record,
					`Antigravity 读取账号信息失败：${redactSecrets(errorMessage(error), [tokens.accessToken])}`,
				);
			}

			record.output.push("正在获取 Antigravity 的 GCP project…");
			let projectId: string;
			try {
				projectId = await requestAntigravityProjectId(tokens.accessToken, {
					fetch: this._fetch,
					sleep: this._sleep,
					timeoutMs: this._requestTimeoutMs,
				});
			} catch (error) {
				return this._failSession(
					record,
					`Antigravity 获取 project_id 失败：${redactSecrets(errorMessage(error), [tokens.accessToken, refreshToken])}`,
				);
			}

			const target = await this._resolveLoginTarget(email, tokens);
			const raw = buildLoginAuthFile(target.previous, tokens, refreshToken, email, projectId, this._now());
			try {
				await this._accounts.writeRaw(target.fileName, raw);
			} catch (error) {
				return this._failSession(record, `保存 Antigravity 账号失败：${errorMessage(error)}`);
			}
			record.state = "success";
			record.prompt = undefined;
			record.output.push(`Antigravity 账号 ${email} 已保存为 ${target.fileName}。`);
			return snapshotSession(record);
		} finally {
			record.busy = false;
		}
	}

	/**
	 * 取消并清理登录会话。
	 * @param id - 会话 ID
	 */
	public async cancelLogin(id: string): Promise<void> {
		this._sessions.delete(id);
	}

	/**
	 * 读取账号最新 auth JSON；文件暂时不可读时退回内存快照。
	 * @param account - 账号
	 */
	private async _readSnapshot(account: SubscriptionAccount): Promise<Record<string, unknown>> {
		try {
			return await this._accounts.readRaw(account.fileName);
		} catch {
			return account.raw;
		}
	}

	/**
	 * 在账号文件锁内刷新 token；失败时不写文件。
	 * @param account - 账号
	 */
	private async _refreshWithLock(account: SubscriptionAccount): Promise<RefreshedCredential> {
		return await singleFlight(this._inflight, account.fileName, async () => {
			return await this._refreshSerialized(account);
		});
	}

	/**
	 * 文件锁内实际刷新；`_refreshWithLock` 负责并发去重。
	 * @param account - 账号
	 */
	private async _refreshSerialized(account: SubscriptionAccount): Promise<RefreshedCredential> {
		return this._accounts.withFileLock(account.fileName, FILE_LOCK_TIMEOUT_MS, async () => {
			const raw = await this._accounts.readRaw(account.fileName);
			const refreshToken = trimmedString(raw["refresh_token"]);
			if (!refreshToken) {
				throw ApiError.unauthorized("Antigravity 账号缺少 refresh token，请重新登录");
			}
			let tokens: AntigravityTokenSet;
			try {
				tokens = await refreshAntigravityToken(refreshToken, {
					fetch: this._fetch,
					timeoutMs: this._requestTimeoutMs,
				});
			} catch (error) {
				throw ApiError.unavailable(`Antigravity token 刷新失败：${redactSecrets(errorMessage(error), [refreshToken])}`);
			}
			const nowMs = this._now();
			const expiresIn = tokens.expiresIn ?? DEFAULT_EXPIRES_IN_SECONDS;
			raw["access_token"] = tokens.accessToken;
			if (tokens.refreshToken) {
				raw["refresh_token"] = tokens.refreshToken;
			}
			raw["expires_in"] = expiresIn;
			raw["timestamp"] = nowMs;
			applyExpiryFields(raw, formatRfc3339(nowMs + expiresIn * 1_000));
			raw["type"] = ANTIGRAVITY_AUTH_TYPE;

			let projectId = trimmedString(raw["project_id"]) ?? "";
			let projectError: string | undefined;
			if (!projectId) {
				try {
					projectId = await requestAntigravityProjectId(tokens.accessToken, {
						fetch: this._fetch,
						sleep: this._sleep,
						timeoutMs: this._requestTimeoutMs,
					});
					raw["project_id"] = projectId;
				} catch (error) {
					projectError = redactSecrets(errorMessage(error), [tokens.accessToken, refreshToken, tokens.refreshToken]);
					logger.warn(`Antigravity 账号 ${account.fileName} 刷新后缺少 project_id：${projectError}`);
				}
			}
			await this._accounts.writeRaw(account.fileName, raw);
			return { accessToken: tokens.accessToken, projectId: projectId, projectError: projectError };
		});
	}

	/**
	 * 为已有 access token 的账号补齐 project_id 并写回。
	 * @param account - 账号
	 * @param accessToken - 当前 access token
	 */
	private async _fillMissingProject(account: SubscriptionAccount, accessToken: string): Promise<void> {
		await this._accounts.withFileLock(account.fileName, FILE_LOCK_TIMEOUT_MS, async () => {
			const raw = await this._accounts.readRaw(account.fileName);
			if (trimmedString(raw["project_id"])) {
				return;
			}
			// 锁内优先使用文件里的最新 token，避免拿刷新前的旧 token 去 onboard。
			const currentToken = trimmedString(raw["access_token"]) ?? accessToken;
			let projectId: string;
			try {
				projectId = await requestAntigravityProjectId(currentToken, {
					fetch: this._fetch,
					sleep: this._sleep,
					timeoutMs: this._requestTimeoutMs,
				});
			} catch (error) {
				throw ApiError.unavailable(`Antigravity 获取 project_id 失败：${redactSecrets(errorMessage(error), [currentToken])}`);
			}
			raw["project_id"] = projectId;
			await this._accounts.writeRaw(account.fileName, raw);
		});
	}

	/**
	 * 选择登录要写入的文件，避免同来源重复账号。
	 * @param email - Google 账号邮箱
	 * @param tokens - 新 token
	 */
	private async _resolveLoginTarget(
		email: string,
		tokens: AntigravityTokenSet,
	): Promise<{ readonly fileName: string; readonly previous: Record<string, unknown> | undefined }> {
		const accounts = await this._accounts.list(ANTIGRAVITY_AUTH_TYPE);
		const existing =
			accounts.find((account) => sameEmail(account.raw["email"], email)) ??
			accounts.find((account) => sameToken(account.raw, tokens));
		let fileName: string;
		if (existing) {
			fileName = existing.fileName;
		} else {
			const segment = fileNameSegment(email);
			const taken = new Set(accounts.map((account) => account.fileName));
			fileName = `antigravity-${segment}${ACCOUNT_SUFFIX}`;
			for (let index = 2; taken.has(fileName) && index <= 99; index += 1) {
				fileName = `antigravity-${segment}-${index}${ACCOUNT_SUFFIX}`;
			}
			if (taken.has(fileName)) {
				throw ApiError.conflict("Antigravity 账号文件名冲突，请先清理重复账号");
			}
		}
		let previous: Record<string, unknown> | undefined;
		try {
			previous = await this._accounts.readRaw(fileName);
		} catch {
			previous = undefined;
		}
		return { fileName: fileName, previous: previous };
	}

	/**
	 * 标记会话失败并返回快照。
	 * @param record - 会话
	 * @param message - 失败原因
	 */
	private _failSession(record: AntigravityLoginSessionRecord, message: string): SubscriptionLoginSession {
		record.state = "error";
		record.error = message;
		record.prompt = undefined;
		record.output.push(message);
		return snapshotSession(record);
	}

	/**
	 * 判断会话是否已超过 TTL。
	 * @param record - 会话
	 */
	private _isSessionExpired(record: AntigravityLoginSessionRecord): boolean {
		return this._now() - record.createdAt > this._sessionTtlMs;
	}

	/**
	 * 清理过期会话。
	 * @param nowMs - 当前时间
	 */
	private _pruneSessions(nowMs: number): void {
		for (const [id, record] of this._sessions) {
			if (nowMs - record.createdAt > this._sessionTtlMs) {
				this._sessions.delete(id);
			}
		}
	}

	/**
	 * 超出容量时淘汰最旧的会话。
	 */
	private _enforceSessionLimit(): void {
		while (this._sessions.size > this._sessionLimit) {
			const oldest = this._sessions.keys().next();
			if (oldest.done) {
				return;
			}
			this._sessions.delete(oldest.value);
		}
	}
}

/**
 * 生成登录会话快照，避免向调用方暴露可变内部状态。
 * @param record - 会话
 */
function snapshotSession(record: AntigravityLoginSessionRecord): SubscriptionLoginSession {
	return {
		id: record.id,
		state: record.state,
		url: record.url,
		output: [...record.output],
		...(record.prompt === undefined ? {} : { prompt: record.prompt }),
		...(record.error === undefined ? {} : { error: record.error }),
	};
}

/**
 * 把过期会话转成错误快照。
 * @param record - 会话
 */
function expiredSession(record: AntigravityLoginSessionRecord): SubscriptionLoginSession {
	return {
		id: record.id,
		state: "error",
		url: record.url,
		output: [...record.output, "登录会话已过期，请重新发起登录。"],
		error: "登录会话已过期，请重新发起登录",
	};
}

/**
 * 解析用户粘贴的回调 URL 或授权码。
 * @param input - 用户输入
 * @param expectedState - 本次会话的 state
 * @throws {ApiError} 输入为空时抛出参数错误
 */
function parseCallbackInput(input: string, expectedState: string): ParsedCallbackInput {
	const trimmed = input.trim();
	if (!trimmed) {
		throw ApiError.badRequest("请粘贴 Antigravity 回调 URL 或授权码");
	}
	let url: URL;
	try {
		url = new URL(trimmed);
	} catch {
		return { code: trimmed };
	}
	const error = trimmedString(url.searchParams.get("error"));
	if (error) {
		return { error: error };
	}
	const state = trimmedString(url.searchParams.get("state"));
	if (state && state !== expectedState) {
		return { stateMismatch: true };
	}
	return { code: trimmedString(url.searchParams.get("code")) };
}

/**
 * 构造新登录账号的 auth JSON，保留既有文件中的未知字段。
 * @param previous - 既有文件内容
 * @param tokens - 新 token
 * @param refreshToken - 新 refresh token
 * @param email - 账号邮箱
 * @param projectId - GCP project
 * @param nowMs - 当前时间
 */
function buildLoginAuthFile(
	previous: Record<string, unknown> | undefined,
	tokens: AntigravityTokenSet,
	refreshToken: string,
	email: string,
	projectId: string,
	nowMs: number,
): Record<string, unknown> {
	const expiresIn = tokens.expiresIn ?? DEFAULT_EXPIRES_IN_SECONDS;
	const expired = formatRfc3339(nowMs + expiresIn * 1_000);
	const credential: Record<string, unknown> = {
		type: ANTIGRAVITY_AUTH_TYPE,
		access_token: tokens.accessToken,
		refresh_token: refreshToken,
		expires_in: expiresIn,
		timestamp: nowMs,
		expired: expired,
		email: email,
		project_id: projectId,
	};
	const merged: Record<string, unknown> = { ...(previous ?? {}), ...credential };
	applyExpiryFields(merged, expired);
	if (typeof merged["disabled"] !== "boolean") {
		merged["disabled"] = false;
	}
	return merged;
}

/**
 * 写入到期时间；文件里已有的兼容字段 `expires_at` 同步更新，避免被旧值覆盖。
 * @param raw - 待写入的 auth JSON
 * @param expired - RFC3339 到期时间
 */
function applyExpiryFields(raw: Record<string, unknown>, expired: string): void {
	raw["expired"] = expired;
	if (Object.hasOwn(raw, "expires_at")) {
		raw["expires_at"] = expired;
	}
}

/**
 * 从 auth JSON 推导 access token 到期时间。
 * @param raw - auth JSON
 */
function resolveAccessTokenExpiry(raw: Record<string, unknown>): number | undefined {
	for (const key of ["expired", "expires_at", "expiry", "expires"]) {
		const parsed = timestampMs(raw[key]);
		if (parsed !== undefined) {
			return parsed;
		}
	}
	const timestamp = timestampMs(raw["timestamp"]);
	const expiresIn = positiveNumber(raw["expires_in"]);
	if (timestamp !== undefined && expiresIn !== undefined) {
		return timestamp + expiresIn * 1_000;
	}
	const accessToken = trimmedString(raw["access_token"]);
	if (accessToken) {
		const payload = parseJwtPayload(accessToken);
		const exp = payload?.["exp"];
		if (typeof exp === "number" && Number.isFinite(exp)) {
			return exp * 1_000;
		}
	}
	return undefined;
}

/**
 * 把数值或时间字符串解析为毫秒时间戳；兼容秒与毫秒。
 * @param value - 任意字段值
 */
function timestampMs(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value > 10_000_000_000 ? value : value * 1_000;
	}
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	if (!trimmed) {
		return undefined;
	}
	if (/^\d+$/.test(trimmed)) {
		const numeric = Number(trimmed);
		return numeric > 10_000_000_000 ? numeric : numeric * 1_000;
	}
	const parsed = Date.parse(trimmed);
	return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * 读取正数，兼容数字字符串。
 * @param value - 任意值
 */
function positiveNumber(value: unknown): number | undefined {
	const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
	return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
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
 * 输出不带毫秒的 RFC3339 时间，贴近 Go 的 `time.RFC3339`。
 * @param ms - 毫秒时间戳
 */
function formatRfc3339(ms: number): string {
	return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * 邮箱是否与已有账号一致（忽略大小写）。
 * @param value - 已有 email 字段
 * @param email - 新邮箱
 */
function sameEmail(value: unknown, email: string): boolean {
	const existing = trimmedString(value);
	return existing !== undefined && existing.toLowerCase() === email.toLowerCase();
}

/**
 * 已有账号是否持有同一份 token。
 * @param raw - 已有 auth JSON
 * @param tokens - 新 token
 */
function sameToken(raw: Record<string, unknown>, tokens: AntigravityTokenSet): boolean {
	const accessToken = trimmedString(raw["access_token"]);
	const refreshToken = trimmedString(raw["refresh_token"]);
	return (
		(accessToken !== undefined && accessToken === tokens.accessToken) ||
		(refreshToken !== undefined && refreshToken === tokens.refreshToken)
	);
}

/**
 * 把邮箱转成安全的文件名片段。
 * @param email - 邮箱
 */
function fileNameSegment(email: string): string {
	const safe = email
		.trim()
		.replace(/[\\/:*?"<>|]/g, "_")
		// eslint-disable-next-line no-control-regex
		.replace(/[\u0000-\u001f\u007f]/g, "_")
		.replace(/\s+/g, "_");
	return safe || "account";
}

/**
 * 从错误中取出消息文本。
 * @param error - 任意错误
 */
function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * 从错误文本中抹掉 token 等敏感值。
 * @param message - 原始错误
 * @param secrets - 需要抹掉的值
 */
function redactSecrets(message: string, secrets: readonly (string | undefined)[]): string {
	let redacted = message;
	for (const secret of secrets) {
		if (secret && secret.length >= 4) {
			redacted = redacted.split(secret).join("[redacted]");
		}
	}
	return redacted;
}

/**
 * 取正的配置值，否则回退默认值。
 * @param value - 配置值
 * @param fallback - 默认值
 */
function positiveOr(value: number | undefined, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * 默认休眠实现。
 * @param ms - 毫秒
 */
function defaultSleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
