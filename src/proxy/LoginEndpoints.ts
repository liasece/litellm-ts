/* eslint-disable camelcase */
/**
 * Login 端点
 *
 * 对齐 Python LiteLLM `/v2/login`：用户名密码登录成功后设置 `token` cookie，
 * 返回 WebUI 跳转地址。这里不修改 WebUI 源码，只补齐它依赖的 Proxy API 表面。
 * 协议源码：https://github.com/BerriAI/litellm/blob/main/litellm/proxy/proxy_server.py
 *
 * 协议要点（严格对齐 Python `authenticate_user` + `generate_key_helper_fn`）：
 * - 登录成功后通过 `generateApiKey()` 生成明文 `sk-*` virtual key；
 * - `hashApiKey(plainKey)` 写入 `LiteLLM_VerificationToken`（与 /key/generate 一致）；
 * - cookie JWT 的 `key` 字段携带**明文** `sk-*`，与 Python 行为一致；
 * - WebUI 通过 `jwtDecode(token)` 读取 `claims.key`，再以
 *   `Authorization: Bearer ${claims.key}` 发送后续请求；auth 层对该 Bearer 走
 *   hash → DB 查找路径识别身份。
 *
 * 安全契约（必须保留，避免误改）：
 * - 默认凭据：未设置 UI_USERNAME/UI_PASSWORD 时，UI 密码默认等于 master_key。
 *   因此持有 master key 等价持有 proxy_admin 登录凭据。
 * - cookie JWT 不携带 master key 明文；
 * - httpOnly=false：当前 WebUI 通过 `document.cookie` 读取 token 后挂在
 *   `Authorization` 头里再发请求。把 cookie 改成 httpOnly=true 会立即让
 *   复制来的 WebUI 全站 401，因此这里维持 httpOnly=false 作为临时 trade-off。
 *   后续应改造为 /auth/check/ 服务端 session 检查，再把 httpOnly 改回 true。
 * - secure：生产环境（HTTPS）下应设 true；本地开发 HTTP 站点（当前部署
 *   `http://192.168.1.220:18183`）下不应强制 secure，否则浏览器会丢弃 cookie
 *   导致登录失效。判定方式见 isProductionCookieSecure()。
 */
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import type { Response, Router } from "express";
import { registerRoute } from "../core/api/registerRoute";
import { ApiError } from "../core/api/ApiError";
import type { ServiceConfig } from "../core/config";
import type { DrizzleDb } from "../core/db/Database";
import { generateApiKey, hashApiKey } from "../core/utils/crypto";
import { LiteLLM_VerificationToken } from "../db/schema/verification-tokens";
import {
	LOGIN_METHOD_USERNAME_PASSWORD,
	PROXY_ADMIN_ROLE,
	PROXY_ADMIN_USER_ID,
	WEBUI_COOKIE_TOKEN_NAME,
	WEBUI_LOGIN_TEAM_ID,
} from "../types/webUiSession";

const DEFAULT_UI_USERNAME = "admin";
/** 强制 cookie secure 的环境变量名；存在并解析为 true 即视为生产。 */
const SECURE_COOKIE_ENV_VAR = "LITELLM_COOKIE_SECURE";

/** 日志中明文 key 只展示固定长度前缀，避免泄露完整密钥材料。 */
const TOKEN_LOG_PREFIX_LENGTH = 8;

/** WebUI 登录时生成新 virtual key 的最大碰撞重试次数。 */
const MAX_KEY_GEN_RETRIES = 3;

interface LoginRequestBody {
	readonly username?: unknown;
	readonly password?: unknown;
}

interface LoginResponse {
	readonly redirect_url: string;
}

/**
 * cookie JWT payload 形状。
 * `key` 字段为登录时生成的明文 `sk-*` virtual key（与 Python 一致），
 * 后续请求通过 `Authorization: Bearer ${claims.key}` 携带该 key。
 */
interface WebUiSessionClaims {
	readonly user_id: string;
	readonly key: string;
	readonly user_email: string | null;
	readonly user_role: string;
	readonly login_method: typeof LOGIN_METHOD_USERNAME_PASSWORD;
	readonly premium_user: boolean;
	readonly auth_header_name: string;
	readonly disabled_non_admin_personal_key_creation: boolean;
	readonly server_root_path: string;
}

/**
 * @param router
 * @param config - 服务配置，用于读取 master_key 与原始 general_settings
 * @param db - Drizzle DB 实例，用于把登录会话对应的 virtual key 写入
 * LiteLLM_VerificationToken
 */
export function registerLoginRoutes(router: Router, config: ServiceConfig, db: DrizzleDb): void {
	registerRoute(router, { method: "post", path: "/login" }, (req, res) => loginV2(req.body as LoginRequestBody, res, config, db));
	registerRoute(router, { method: "post", path: "/v2/login" }, (req, res) => loginV2(req.body as LoginRequestBody, res, config, db));
	registerRoute(router, { method: "post", path: "/v3/login" }, () => {
		throw ApiError.unavailable("Login v3 not implemented");
	});
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

	// 生成登录会话的 virtual key 并持久化 hash；与 /key/generate 一致，碰撞重试
	const { plainKey } = await issueLoginVirtualKey(db);

	const sessionClaims = createWebUiSessionClaims(config, plainKey);
	const jwtToken = signHs256(sessionClaims, masterKey);
	res.cookie(WEBUI_COOKIE_TOKEN_NAME, jwtToken, {
		httpOnly: false,
		path: "/",
		sameSite: "lax",
		// 生产环境（HTTPS）下应设 secure: true；本地 HTTP 站点不可强制，
		// 否则浏览器在 http 下不会回传 cookie，导致登录后所有请求 401。
		// 当前部署 `http://192.168.1.220:18183` 默认 secure=false。
		secure: isProductionCookieSecure(),
	});

	return { redirect_url: "/ui/?login=success" };
}

/**
 * 生成登录会话的 virtual key 并写入 LiteLLM_VerificationToken。
 * 若 hash 与现有记录碰撞（SHA-256 极小概率），最多重试 MAX_KEY_GEN_RETRIES 次。
 * @param db - Drizzle DB 实例
 * @returns 明文 key 与对应 hash（hash 入库，明文回写 JWT claims）
 */
async function issueLoginVirtualKey(db: DrizzleDb): Promise<{ plainKey: string; tokenHash: string }> {
	for (let attempt = 0; attempt < MAX_KEY_GEN_RETRIES; attempt++) {
		const plainKey = generateApiKey();
		const tokenHash = hashApiKey(plainKey);

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
			metadata: { login_method: LOGIN_METHOD_USERNAME_PASSWORD },
			models: [],
			blocked: false,
		});

		// 日志仅展示前缀，不打印明文 key
		const keyPrefix = plainKey.slice(0, TOKEN_LOG_PREFIX_LENGTH);
		process.stdout.write(`[LoginEndpoints] issued webui virtual key prefix=${keyPrefix}…\n`);
		return { plainKey: plainKey, tokenHash: tokenHash };
	}
	throw ApiError.unavailable("Failed to issue login virtual key after retries");
}

/**
 * 是否应在 cookie 上设置 Secure 标志。
 * - LITELLM_COOKIE_SECURE=true → 强制 secure（生产 HTTPS 站点）
 * - LITELLM_COOKIE_SECURE=false → 强制 insecure（HTTP 开发站点）
 * - 未设置 → 默认 insecure（与历史上线部署兼容；如需生产默认 secure，可改为
 *   检测 NODE_ENV=production 或显式 HTTPS upstream）。
 * @returns 是否 secure
 */
function isProductionCookieSecure(): boolean {
	const raw = process.env[SECURE_COOKIE_ENV_VAR];
	if (raw === undefined) {
		return false;
	}
	return raw.toLowerCase() === "true" || raw === "1";
}

/**
 * 构造 cookie JWT payload —— `key` 字段为登录生成的明文 `sk-*` virtual key。
 * 后续请求通过 `Authorization: Bearer ${claims.key}` 携带；auth 层对该 Bearer
 * 走 hash → DB 查找路径识别身份。
 * @param config
 * @param plainKey - 登录时生成的明文 virtual key
 */
function createWebUiSessionClaims(config: ServiceConfig, plainKey: string): WebUiSessionClaims {
	const authHeaderName = getStringSetting(config.generalSettingsRaw, "litellm_key_header_name") ?? "Authorization";
	return {
		user_id: PROXY_ADMIN_USER_ID,
		key: plainKey,
		user_email: null,
		user_role: PROXY_ADMIN_ROLE,
		login_method: LOGIN_METHOD_USERNAME_PASSWORD,
		premium_user: false,
		auth_header_name: authHeaderName,
		disabled_non_admin_personal_key_creation: false,
		server_root_path: "/",
	};
}

function getStringSetting(settings: Record<string, unknown> | undefined, key: string): string | undefined {
	const value = settings?.[key];
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function timingSafeEqual(left: string, right: string): boolean {
	const leftBuffer = Buffer.from(left, "utf8");
	const rightBuffer = Buffer.from(right, "utf8");
	if (leftBuffer.length !== rightBuffer.length) {
		return false;
	}
	return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function signHs256(payload: WebUiSessionClaims, secret: string): string {
	const header = { alg: "HS256", typ: "JWT" };
	const encodedHeader = base64UrlEncode(JSON.stringify(header));
	const encodedPayload = base64UrlEncode(JSON.stringify(payload));
	const signedData = `${encodedHeader}.${encodedPayload}`;
	const signature = crypto.createHmac("sha256", secret).update(signedData).digest("base64url");
	return `${signedData}.${signature}`;
}

function base64UrlEncode(value: string): string {
	return Buffer.from(value, "utf8").toString("base64url");
}
