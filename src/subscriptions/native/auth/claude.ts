/**
 * Claude（Anthropic）订阅账号的 OAuth 鉴权、刷新与登录。
 *
 * 对齐 Go 运行时 `internal/auth/claude`：授权码 + PKCE 流程、`platform.claude.com`
 * 的 token 端点、OAuth profile 身份查询与 auth JSON 字段。纯 Node 环境没有
 * uTLS/Chrome 指纹，这里使用普通 fetch；CCH 请求签名不属于鉴权层。
 */

import { createHash, randomBytes } from "node:crypto";
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
	readAccountFile,
	readPositiveNumberField,
	readRecordField,
	readStringField,
} from "./accountFile";
import type { AuthHttpOptions, TokenEndpointResponse } from "./http";
import { createPkce, createState, extractAuthorizationCode, getJson, postJson } from "./http";
import { LoginSessionRegistry } from "./loginSession";
import { singleFlight } from "./inflight";

/** Claude OAuth 授权页。 */
const CLAUDE_AUTHORIZE_URL = "https://claude.ai/oauth/authorize";
/** 授权码交换与刷新共用的 token 端点（Claude Code 2.1.220 之后的实际地址）。 */
const CLAUDE_TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
/** OAuth 账号身份查询端点。 */
const CLAUDE_PROFILE_URL = "https://api.anthropic.com/api/oauth/profile";
/** Claude Code 的公开 OAuth client_id。 */
const CLAUDE_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
/** 本地回调地址；手动回调登录不实际监听端口。 */
const CLAUDE_REDIRECT_URI = "http://localhost:54545/callback";
/** Claude Code 请求的 OAuth scope。 */
const CLAUDE_SCOPE = "user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload";
/** 原生客户端使用 axios 形态的请求头。 */
const CLAUDE_OAUTH_HEADERS: Record<string, string> = {
	Accept: "application/json, text/plain, */*",
	"User-Agent": "axios/1.15.2",
};
/** 登录会话 TTL；覆盖用户打开授权页并粘贴回调的时间。 */
const CLAUDE_LOGIN_SESSION_TTL_MS = 10 * 60 * 1000;
/** 同时保留的登录会话上限。 */
const CLAUDE_MAX_LOGIN_SESSIONS = 32;
/** 单次 OAuth HTTP 超时。 */
const CLAUDE_HTTP_TIMEOUT_MS = 30 * 1000;

/** Claude 鉴权处理器依赖。 */
export interface ClaudeAuthDependencies {
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

/** 从 token 端点解析出的凭据。 */
interface ClaudeTokenPayload {
	/** access token。 */
	readonly accessToken: string;
	/** 轮换后的 refresh token；端点未返回时缺省。 */
	readonly refreshToken?: string;
	/** 有效期秒数。 */
	readonly expiresInSeconds?: number;
	/** token 响应里的账号邮箱。 */
	readonly email?: string;
	/** token 响应里的账号 UUID。 */
	readonly accountUuid?: string;
	/** token 响应里的组织 UUID。 */
	readonly organizationUuid?: string;
	/** token 响应里的组织名。 */
	readonly organizationName?: string;
}

/** 账号身份；profile 查询优先，token 响应兜底。 */
interface ClaudeIdentity {
	/** 展示邮箱。 */
	readonly email?: string;
	/** 账号 UUID。 */
	readonly accountUuid?: string;
	/** 组织 UUID。 */
	readonly organizationUuid?: string;
	/** 组织名。 */
	readonly organizationName?: string;
}

/** 回调输入解析结果。 */
interface ClaudeCallbackInput {
	/** 授权码。 */
	readonly code: string;
	/** 回调携带的 state；只粘贴授权码时缺省。 */
	readonly state?: string;
}

/** 登录会话私有状态。 */
interface ClaudeLoginPayload {
	/** OAuth state。 */
	readonly state: string;
	/** PKCE code_verifier。 */
	readonly codeVerifier: string;
}

/**
 * 构造 Claude 订阅鉴权处理器。
 * @param dependencies - 账号仓库与可注入依赖
 */
export function createClaudeAuth(dependencies: ClaudeAuthDependencies): SubscriptionAuthHandler {
	return new ClaudeAuthHandler(dependencies);
}

/**
 * 构造授权页 URL。
 * @param state - OAuth state
 * @param challenge - PKCE code_challenge
 */
function buildAuthorizeUrl(state: string, challenge: string): string {
	const params = new URLSearchParams();
	params.set("client_id", CLAUDE_CLIENT_ID);
	params.set("code", "true");
	params.set("code_challenge", challenge);
	params.set("code_challenge_method", "S256");
	params.set("redirect_uri", CLAUDE_REDIRECT_URI);
	params.set("response_type", "code");
	params.set("scope", CLAUDE_SCOPE);
	params.set("state", state);
	return `${CLAUDE_AUTHORIZE_URL}?${params.toString()}`;
}

/**
 * 解析 URL fragment 参数。
 * @param hash - `#` 开头或裸参数串
 */
function fragmentParams(hash: string): URLSearchParams {
	return new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
}

/**
 * 解析用户粘贴的回调 URL 或授权码。
 *
 * 回调 URL 会校验其中的 `error` 参数并提取 state；只粘贴授权码时按
 * `code#state` 形式拆出可选的 state。
 * @param input - 回调 URL 或授权码
 * @throws {ApiError} 输入为空、回调缺少授权码或回调携带错误时抛出
 */
function parseClaudeCallback(input: string): ClaudeCallbackInput {
	const trimmed = input.trim();
	if (!trimmed) {
		throw ApiError.badRequest("请输入 Claude 回调 URL 或授权码");
	}
	try {
		const url = new URL(trimmed);
		const errorCode = url.searchParams.get("error");
		if (errorCode) {
			const description = url.searchParams.get("error_description");
			throw ApiError.badRequest(`Claude 授权失败：${description ?? errorCode}`);
		}
		const hash = fragmentParams(url.hash);
		const rawCode = url.searchParams.get("code") ?? hash.get("code");
		const queryState = url.searchParams.get("state") ?? hash.get("state");
		if (!rawCode) {
			throw ApiError.badRequest("Claude 回调 URL 缺少 code 参数");
		}
		// 与原生客户端一致：code 里附加的 #state 优先于 query 中的 state。
		const separator = rawCode.indexOf("#");
		const code = separator >= 0 ? rawCode.slice(0, separator) : rawCode;
		const embeddedState = separator >= 0 ? rawCode.slice(separator + 1) : "";
		const state = embeddedState || queryState;
		return state ? { code: code, state: state } : { code: code };
	} catch (error) {
		if (error instanceof ApiError) {
			throw error;
		}
		// 不是 URL，按授权码处理。
	}
	const extracted = extractAuthorizationCode(trimmed);
	if (!extracted) {
		throw ApiError.badRequest("请输入 Claude 回调 URL 或授权码");
	}
	const separator = extracted.indexOf("#");
	const code = separator >= 0 ? extracted.slice(0, separator) : extracted;
	const state = separator >= 0 ? extracted.slice(separator + 1) : "";
	if (!code) {
		throw ApiError.badRequest("请输入 Claude 回调 URL 或授权码");
	}
	return state ? { code: code, state: state } : { code: code };
}

/**
 * 解析 token 端点响应。
 * @param response - token 端点 JSON
 * @throws {ApiError} 响应携带错误码或缺少 access token 时抛出
 */
function parseClaudeTokenPayload(response: TokenEndpointResponse): ClaudeTokenPayload {
	const errorCode = readStringField(response, "error");
	if (errorCode) {
		const description = readStringField(response, "error_description");
		throw ApiError.unavailable(`Claude OAuth 失败：${description ?? errorCode}`);
	}
	const accessToken = readStringField(response, "access_token");
	if (!accessToken) {
		throw ApiError.unavailable("Claude OAuth 未返回 access_token");
	}
	const account = readRecordField(response, "account");
	const organization = readRecordField(response, "organization");
	const email = account ? (readStringField(account, "email_address") ?? readStringField(account, "email")) : undefined;
	const accountUuid = account ? readStringField(account, "uuid") : undefined;
	const organizationUuid = organization ? readStringField(organization, "uuid") : undefined;
	const organizationName = organization ? readStringField(organization, "name") : undefined;
	const expiresIn = readPositiveNumberField(response, "expires_in");
	const refreshToken = readStringField(response, "refresh_token");
	return {
		accessToken: accessToken,
		...(refreshToken ? { refreshToken: refreshToken } : {}),
		...(expiresIn !== undefined ? { expiresInSeconds: Math.floor(expiresIn) } : {}),
		...(email ? { email: email } : {}),
		...(accountUuid ? { accountUuid: accountUuid } : {}),
		...(organizationUuid ? { organizationUuid: organizationUuid } : {}),
		...(organizationName ? { organizationName: organizationName } : {}),
	};
}

/**
 * 生成 Claude Code 形态的设备标识（32 字节小写 hex）。
 */
function createClaudeDeviceId(): string {
	return randomBytes(32).toString("hex");
}

/**
 * 读取已有文件的设备池；Go 运行时每次登录会复用旧设备标识。
 * @param raw - 已有 auth JSON
 */
function readClaudeDeviceIds(raw: Record<string, unknown> | undefined): string[] | undefined {
	if (!raw) {
		return undefined;
	}
	const value = raw["claude_device_ids"];
	if (!Array.isArray(value)) {
		return undefined;
	}
	for (const entry of value) {
		if (typeof entry !== "string") {
			continue;
		}
		const normalized = entry.trim().toLowerCase();
		if (/^[0-9a-f]{64}$/.test(normalized)) {
			return [normalized];
		}
	}
	return undefined;
}

/**
 * 清理文件名中不能安全落盘的部分。
 * @param value - 原始文本
 */
function sanitizeFileNamePart(value: string): string {
	return value.trim().replace(/[\\/\p{Cc}]/gu, "_");
}

/**
 * 计算 Claude 账号文件名。
 *
 * 有组织/账号 UUID 时使用 8 位身份哈希前缀，避免同邮箱多组织互相覆盖；
 * 没有身份信息时退回旧的 `claude-<email>.json` 形式。
 * @param email - 账号邮箱
 * @param organizationUuid - 组织 UUID
 * @param accountUuid - 账号 UUID
 */
export function claudeCredentialFileName(email: string, organizationUuid?: string, accountUuid?: string): string {
	const safeEmail = sanitizeFileNamePart(email);
	const identity = organizationUuid?.trim() || accountUuid?.trim() || "";
	if (!identity) {
		return `claude-${safeEmail}.json`;
	}
	const digest = createHash("sha256").update(identity).digest("hex").slice(0, 8);
	return `claude-${digest}-${safeEmail}.json`;
}

/**
 * 判断已有账号 JSON 是否与目标身份相同。
 * @param raw - 已有 auth JSON
 * @param identity - 目标身份
 * @param email - 目标邮箱（小写）
 */
function isSameClaudeAccount(raw: Record<string, unknown>, identity: ClaudeIdentity, email: string): boolean {
	const candidateEmail = readStringField(raw, "email")?.toLowerCase();
	if (candidateEmail !== email) {
		return false;
	}
	const candidateOrganization = readStringField(raw, "organization_uuid")?.toLowerCase();
	const candidateAccount = readStringField(raw, "account_uuid")?.toLowerCase();
	const organization = identity.organizationUuid?.toLowerCase();
	const account = identity.accountUuid?.toLowerCase();
	if (candidateOrganization && organization) {
		return candidateOrganization === organization;
	}
	if (candidateOrganization) {
		return false;
	}
	if (candidateAccount && account) {
		return candidateAccount === account;
	}
	// 任一侧缺少 UUID 时只能按邮箱识别；旧版文件通常没有身份字段。
	return true;
}

/**
 * 生成不冲突的文件名。
 * @param existing - 同来源已有账号
 * @param desired - 期望文件名
 */
function uniqueClaudeFileName(existing: readonly SubscriptionAccount[], desired: string): string {
	const base = desired.replace(/\.json$/i, "");
	for (let index = 2; ; index += 1) {
		const candidate = `${base}-${index}.json`;
		if (!existing.some((account) => account.fileName.toLowerCase() === candidate.toLowerCase())) {
			return candidate;
		}
	}
}

/**
 * 在已有账号中寻找同一 Claude 身份的文件，避免重复账号或覆盖他人。
 *
 * 优先复用旧版邮箱文件名（Go 运行时的历史格式），其次使用身份匹配的文件；
 * 只有在无法识别时才使用新的规范文件名。
 * @param accounts - 账号仓库
 * @param targetName - 按身份算出的规范文件名
 * @param identity - 目标身份
 * @param email - 目标邮箱
 */
async function resolveClaudeFileName(
	accounts: SubscriptionAccountStore,
	targetName: string,
	identity: ClaudeIdentity,
	email: string,
): Promise<string> {
	const existing = await accounts.list("claude");
	const normalizedEmail = email.trim().toLowerCase();
	const exact = existing.find((account) => account.fileName.toLowerCase() === targetName.toLowerCase());
	if (exact && isSameClaudeAccount(exact.raw, identity, normalizedEmail)) {
		return exact.fileName;
	}
	const match = existing.find((account) => isSameClaudeAccount(account.raw, identity, normalizedEmail));
	if (match) {
		return match.fileName;
	}
	if (exact) {
		return uniqueClaudeFileName(existing, targetName);
	}
	return targetName;
}

/**
 * Claude 鉴权处理器实现。
 */
class ClaudeAuthHandler implements SubscriptionAuthHandler {
	readonly source: SubscriptionSource = "claude";
	private readonly _accounts: SubscriptionAccountStore;
	private readonly _inflight = new Map<string, Promise<void>>();
	private readonly _fetch?: typeof fetch;
	private readonly _now: () => number;
	private readonly _sessions: LoginSessionRegistry<ClaudeLoginPayload>;

	constructor(dependencies: ClaudeAuthDependencies) {
		this._accounts = dependencies.accounts;
		this._fetch = dependencies.fetch;
		this._now = dependencies.now ?? (() => Date.now());
		this._sessions = new LoginSessionRegistry<ClaudeLoginPayload>({
			ttlMs: dependencies.loginSessionTtlMs ?? CLAUDE_LOGIN_SESSION_TTL_MS,
			maxEntries: dependencies.maxLoginSessions ?? CLAUDE_MAX_LOGIN_SESSIONS,
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
			throw ApiError.unavailable("Claude 订阅账号缺少 access_token，请重新登录 Claude");
		}
		const expiresAt = account.expiresAt ?? credentialExpiryMs(account.raw);
		if (expiresAt === undefined || expiresAt - this._now() > SUBSCRIPTION_REFRESH_LEAD_MS) {
			return accessToken;
		}
		await this._refreshLocked(account, true);
		const updated = await this._accounts.readRaw(account.fileName);
		const nextAccessToken = readStringField(updated, "access_token");
		if (!nextAccessToken) {
			throw ApiError.unavailable("Claude 订阅账号刷新后仍缺少 access_token，请重新登录 Claude");
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

	/** 启动 PKCE 登录会话，返回授权 URL。 */
	async startLogin(): Promise<SubscriptionLoginSession> {
		const pkce = createPkce();
		const state = createState();
		const url = buildAuthorizeUrl(state, pkce.challenge);
		const record = this._sessions.create(
			{ state: state, codeVerifier: pkce.verifier },
			{
				url: url,
				output: [
					"Visit the following URL to continue Claude authentication:",
					url,
					"Paste the callback URL or authorization code after authorizing.",
				],
				prompt: "Paste the Claude callback URL or authorization code:",
			},
		);
		return record.session;
	}

	/**
	 * 查询登录状态；Claude 手动回调在提交前始终为 pending。
	 * @param id - 会话 ID
	 */
	async pollLogin(id: string): Promise<SubscriptionLoginSession> {
		const record = this._sessions.find(id);
		if (!record) {
			throw ApiError.notFound("登录会话不存在或已过期，请重新开始");
		}
		return record.session;
	}

	/**
	 * 提交回调 URL 或授权码，交换 token 并保存账号。
	 * @param id - 会话 ID
	 * @param input - 回调 URL 或授权码
	 */
	async submitLoginInput(id: string, input: string): Promise<SubscriptionLoginSession> {
		const record = this._sessions.find(id);
		if (!record) {
			throw ApiError.notFound("登录会话不存在或已过期，请重新开始");
		}
		if (record.session.state !== "pending") {
			return record.session;
		}
		let parsed: ClaudeCallbackInput;
		try {
			parsed = parseClaudeCallback(input);
			if (parsed.state && parsed.state !== record.payload.state) {
				throw ApiError.badRequest("Claude 授权回调的 state 与登录会话不匹配，请重新登录");
			}
		} catch (error) {
			return this._fail(record, errorMessage(error));
		}
		try {
			const token = await this._exchangeCode(parsed.code, parsed.state ?? record.payload.state, record.payload.codeVerifier);
			const identity = await this._resolveIdentity(token);
			await this._persistLogin(token, identity);
			return this._sessions.update(id, {
				state: "success",
				output: ["Claude authentication successful.", `Authenticated as ${identity.email ?? "unknown"}.`],
			}).session;
		} catch (error) {
			return this._fail(record, errorMessage(error));
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
	 * @param record - 会话记录
	 * @param message - 失败原因
	 */
	private _fail(record: { readonly session: SubscriptionLoginSession }, message: string): SubscriptionLoginSession {
		try {
			return this._sessions.update(record.session.id, {
				state: "error",
				output: record.session.output,
				error: message,
			}).session;
		} catch {
			// 会话在请求期间过期：仍然把失败原因返回给本次调用方。
			return { id: record.session.id, state: "error", output: record.session.output, error: message };
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
		const accessToken = await this._accounts.withFileLock(account.fileName, SUBSCRIPTION_FILE_LOCK_TIMEOUT_MS, async () => {
			const raw = await this._accounts.readRaw(account.fileName);
			const currentAccessToken = readStringField(raw, "access_token");
			if (skipIfFresh && currentAccessToken && currentAccessToken !== snapshotAccessToken) {
				const currentExpiry = credentialExpiryMs(raw);
				if (currentExpiry === undefined || currentExpiry - this._now() > SUBSCRIPTION_REFRESH_LEAD_MS) {
					return currentAccessToken;
				}
			}
			return await this._postRefresh(account.fileName, raw);
		});
		// profile 查询是额外网络往返，放到文件锁外；仅当 token 未被其他刷新轮换时合并身份字段。
		const profile = await this._fetchProfile(accessToken);
		if (!profile) {
			return;
		}
		const latest = await this._accounts.readRaw(account.fileName);
		if (readStringField(latest, "access_token") !== accessToken) {
			return;
		}
		const patch: Record<string, string> = {};
		if (profile.email) {
			patch["email"] = profile.email;
		}
		if (profile.accountUuid) {
			patch["account_uuid"] = profile.accountUuid;
		}
		if (profile.organizationUuid) {
			patch["organization_uuid"] = profile.organizationUuid;
		}
		if (profile.organizationName) {
			patch["organization_name"] = profile.organizationName;
		}
		if (Object.keys(patch).length > 0) {
			await this._accounts.patchRaw(account.fileName, patch);
		}
	}

	/**
	 * 用文件中的 refresh token 换取新凭据并原子写回。
	 * @param fileName - 账号文件名
	 * @param raw - 刚重读的 auth JSON
	 */
	private async _postRefresh(fileName: string, raw: Record<string, unknown>): Promise<string> {
		const refreshToken = readStringField(raw, "refresh_token");
		if (!refreshToken) {
			throw ApiError.unavailable("Claude 订阅账号缺少 refresh_token，请重新登录 Claude");
		}
		const response = await postJson(
			CLAUDE_TOKEN_URL,
			{
				client_id: CLAUDE_CLIENT_ID,
				grant_type: "refresh_token",
				refresh_token: refreshToken,
				scope: CLAUDE_SCOPE,
			},
			CLAUDE_OAUTH_HEADERS,
			this._httpOptions(),
		);
		const token = parseClaudeTokenPayload(response);
		const nowMs = this._now();
		const merged: Record<string, unknown> = {
			...raw,
			access_token: token.accessToken,
			refresh_token: token.refreshToken ?? refreshToken,
			type: "claude",
			last_refresh: formatRfc3339(nowMs),
		};
		if (token.expiresInSeconds !== undefined) {
			merged["expired"] = formatRfc3339(nowMs + token.expiresInSeconds * 1000);
		}
		await this._accounts.writeRaw(fileName, merged);
		return token.accessToken;
	}

	/**
	 * 授权码换 token。
	 * @param code - 授权码
	 * @param state - OAuth state
	 * @param verifier - PKCE code_verifier
	 */
	private async _exchangeCode(code: string, state: string, verifier: string): Promise<ClaudeTokenPayload> {
		// 字段顺序与原生 Claude Code 交换请求一致。
		const response = await postJson(
			CLAUDE_TOKEN_URL,
			{
				grant_type: "authorization_code",
				code: code,
				redirect_uri: CLAUDE_REDIRECT_URI,
				client_id: CLAUDE_CLIENT_ID,
				code_verifier: verifier,
				state: state,
			},
			CLAUDE_OAUTH_HEADERS,
			this._httpOptions(),
		);
		return parseClaudeTokenPayload(response);
	}

	/**
	 * 合并 token 响应与 profile 身份。
	 * @param token - token 响应
	 */
	private async _resolveIdentity(token: ClaudeTokenPayload): Promise<ClaudeIdentity> {
		const profile = await this._fetchProfile(token.accessToken);
		const email = profile?.email ?? token.email;
		const accountUuid = profile?.accountUuid ?? token.accountUuid;
		const organizationUuid = profile?.organizationUuid ?? token.organizationUuid;
		const organizationName = profile?.organizationName ?? token.organizationName;
		return {
			...(email ? { email: email } : {}),
			...(accountUuid ? { accountUuid: accountUuid } : {}),
			...(organizationUuid ? { organizationUuid: organizationUuid } : {}),
			...(organizationName ? { organizationName: organizationName } : {}),
		};
	}

	/**
	 * 查询 OAuth profile；失败时返回 undefined（身份字段为可选信息）。
	 * @param accessToken - 新 access token
	 */
	private async _fetchProfile(accessToken: string): Promise<ClaudeIdentity | undefined> {
		try {
			const body = await getJson(
				CLAUDE_PROFILE_URL,
				{
					Authorization: `Bearer ${accessToken}`,
					"Cache-Control": "no-cache",
					...CLAUDE_OAUTH_HEADERS,
				},
				this._httpOptions(),
			);
			const account = readRecordField(body, "account");
			const organization = readRecordField(body, "organization");
			const accountUuid = account ? readStringField(account, "uuid") : undefined;
			if (!accountUuid) {
				return undefined;
			}
			const email = account ? readStringField(account, "email") : undefined;
			const organizationUuid = organization ? readStringField(organization, "uuid") : undefined;
			const organizationName = organization ? readStringField(organization, "name") : undefined;
			return {
				...(email ? { email: email } : {}),
				accountUuid: accountUuid,
				...(organizationUuid ? { organizationUuid: organizationUuid } : {}),
				...(organizationName ? { organizationName: organizationName } : {}),
			};
		} catch {
			return undefined;
		}
	}

	/**
	 * 保存登录结果；复用同一账号的既有文件名并保留未知字段。
	 * @param token - token 响应
	 * @param identity - 账号身份
	 */
	private async _persistLogin(
		token: ClaudeTokenPayload,
		identity: ClaudeIdentity,
	): Promise<{ readonly fileName: string; readonly email: string }> {
		const email = identity.email;
		if (!email) {
			throw ApiError.unavailable("Claude OAuth 未返回账号邮箱，无法保存账号；请确认该账号已完成 Claude Code 授权");
		}
		const targetName = claudeCredentialFileName(email, identity.organizationUuid, identity.accountUuid);
		const fileName = await resolveClaudeFileName(this._accounts, targetName, identity, email);
		const existing = await readAccountFile(this._accounts, fileName);
		const nowMs = this._now();
		const record: Record<string, unknown> = {
			access_token: token.accessToken,
			refresh_token: token.refreshToken ?? "",
			last_refresh: formatRfc3339(nowMs),
			email: email,
			claude_device_ids: readClaudeDeviceIds(existing) ?? [createClaudeDeviceId()],
			type: "claude",
		};
		if (identity.accountUuid) {
			record["account_uuid"] = identity.accountUuid;
		}
		if (identity.organizationUuid) {
			record["organization_uuid"] = identity.organizationUuid;
		}
		if (identity.organizationName) {
			record["organization_name"] = identity.organizationName;
		}
		if (token.expiresInSeconds !== undefined) {
			record["expired"] = formatRfc3339(nowMs + token.expiresInSeconds * 1000);
		}
		await mergeWriteAccountFile(this._accounts, fileName, record);
		return { fileName: fileName, email: email };
	}

	/** 组装共用的 HTTP 选项。 */
	private _httpOptions(): AuthHttpOptions {
		return {
			...(this._fetch ? { fetch: this._fetch } : {}),
			timeoutMs: CLAUDE_HTTP_TIMEOUT_MS,
		};
	}
}
