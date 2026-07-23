/**
 * UserApiKeyAuth — API 密钥认证中间件
 *
 * 等效于 Python litellm-proxy 的 user_api_key_auth()。
 * 从请求头提取 API 密钥，哈希后在 LiteLLM_VerificationToken 表中查找，
 * 将认证元数据挂载到 req.auth 上供下游使用。
 * 协议源码：https://github.com/BerriAI/litellm/blob/main/litellm/proxy/auth/user_api_key_auth.py
 */

import * as crypto from "node:crypto";
import type { Request, RequestHandler } from "express";
import { ApiError } from "../core/api/ApiError";
import { hashApiKey } from "../core/utils/crypto";
import type { AuthRepository } from "./AuthRepository";
import type { BudgetSnapshots, UserAPIKeyAuth } from "../types/auth";
import { JWTHandler } from "./JWTHandler";
import { createModuleLogger } from "../core/utils/logger";
import {
	WEBUI_COOKIE_TOKEN_NAME,
	WEBUI_CSRF_COOKIE_NAME,
	WEBUI_CSRF_HEADER_NAME,
	WEBUI_LOGIN_TEAM_ID,
	JWT_FALLBACK_USER_ID,
	PROXY_ADMIN_ROLE,
	PROXY_ADMIN_USER_ID,
} from "../types/webUiSession";

const logger = createModuleLogger("UserApiKeyAuth");

/**
 * Express Request 扩展 — 增加 auth 属性
 * 认证中间件将解析结果挂载到此字段
 */
declare global {
	namespace Express {
		interface Request {
			auth?: UserAPIKeyAuth;
		}
	}
}

/** 支持的 API 密钥来源请求头（按优先级降序） */
const API_KEY_HEADERS = ["x-api-key", "x-litellm-key", "api-key", "x-goog-api-key"] as const;

/** Azure API Management subscription key 头 */
const AZURE_APIM_HEADER = "azure-apim-subscription-key";

/** WebSocket 子协议前缀（用于提取 API 密钥） */
const WS_SUBPROTOCOL_PREFIX = "litellm_";

/** Authorization Header 前缀 */
const BEARER_PREFIX = "Bearer ";

/** cookie 头中单个 cookie 的最大字节数（防止超长输入进入鉴权路径） */
const MAX_COOKIE_VALUE_LENGTH = 4096;

/** cookie 名最大长度（远大于 `token`，仅作健壮性检查） */
const MAX_COOKIE_NAME_LENGTH = 64;

/**
 * 安全写入 req.auth.metadata 的 JWT 字段白名单。
 *
 * 不要直接把 `jwtResult.claims as Record<string, unknown>` 透传——后续
 * 任何 metadata 读取（spend log / 调试端点 / WebUI 错误回显）都可能
 * 把未受控字段（如 iat/exp/iss/aud，或某些 IdP 注入的 org_* 字段）暴露
 * 给客户端，甚至把 `api_key` 之类的高敏字段也带回响应。
 *
 * 白名单只覆盖"明确安全且 WebUI 实际读取"的字段。
 */
const SAFE_JWT_CLAIM_KEYS: readonly string[] = [
	"user_id",
	"user_role",
	"user_email",
	"login_method",
	"premium_user",
	"disabled_non_admin_personal_key_creation",
	"server_root_path",
	"webui_session",
];

/**
 * 从 JWT claims 中挑出白名单字段，构造 req.auth.metadata。
 * @param claims - JWT 验签后的 claims 对象
 * @returns 仅含 SAFE_JWT_CLAIM_KEYS 中声明字段的子集
 */
function pickSafeJwtClaims(claims: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const key of SAFE_JWT_CLAIM_KEYS) {
		if (claims[key] !== undefined) {
			out[key] = claims[key];
		}
	}
	return out;
}

/**
 * 安全地从 JWT claims 读取字符串字段，类型不匹配时返回 undefined。
 * @param claims
 * @param key
 */
function pickStringClaim(claims: Record<string, unknown>, key: string): string | undefined {
	const claimValue = claims[key];
	return typeof claimValue === "string" ? claimValue : undefined;
}

/**
 * GAP 10: 从请求中提取 end_user_id — 对齐 PY get_end_user_id_for_cost_tracking。
 * 优先级（高→低）：x-end-user-id header > req.body.user > req.body.metadata.user_id。
 * @param req
 */
function _extractEndUserId(req: Request): string | undefined {
	const headerVal = req.headers["x-end-user-id"];
	if (typeof headerVal === "string" && headerVal.length > 0) {
		return headerVal;
	}
	const body = req.body as Record<string, unknown> | undefined;
	if (body) {
		if (typeof body["user"] === "string" && (body["user"] as string).length > 0) {
			return body["user"] as string;
		}
		const meta = body["metadata"] as Record<string, unknown> | undefined;
		if (meta && typeof meta["user_id"] === "string" && (meta["user_id"] as string).length > 0) {
			return meta["user_id"] as string;
		}
	}
	return undefined;
}

/**
 * 从请求中提取 API 密钥
 * 优先级（PY user_api_key_auth.py:342-399）：
 *   X-LiteLLM-API-Key > Authorization (Bearer/Basic/AWS4) >
 *   anthropic-authorization > azure-authorization > google-ai-studio-authorization >
 *   custom_litellm_key_header_name > x-api-key > x-litellm-key > api-key > x-goog-api-key >
 *   litellm_user_api_key > azure-apim-subscription-key >
 *   WebSocket subprotocol > ?key query param
 * @param req
 * @param customKeyHeaderName - 可选的自定义密钥头名（PY general_settings.custom_litellm_key_header_name）
 */
export function extractApiKey(req: Request, customKeyHeaderName?: string): string | null {
	// PY: X-LiteLLM-API-Key 最高优先级 (get_api_key:345)
	const xLiteLLMApiKey = req.headers["x-litellm-api-key"];
	if (typeof xLiteLLMApiKey === "string" && xLiteLLMApiKey.length > 0) {
		return xLiteLLMApiKey.trim();
	}

	const authHeader = req.headers.authorization;
	if (authHeader) {
		if (authHeader.startsWith(BEARER_PREFIX)) {
			return authHeader.slice(BEARER_PREFIX.length).trim();
		}
		// PY: lowercase "bearer " prefix support (user_api_key_auth.py:150-153)
		if (authHeader.startsWith("bearer ")) {
			return authHeader.slice(7).trim();
		}
		if (authHeader.startsWith("Basic ")) {
			// PY: Base64 decode Basic auth — extract password (2nd part after colon) as API key
			// (user_api_key_auth.py:430-437)
			try {
				const basicCreds = Buffer.from(authHeader.slice(6).trim(), "base64").toString("utf-8");
				const colonIndex = basicCreds.indexOf(":");
				if (colonIndex >= 0) {
					return basicCreds.slice(colonIndex + 1).trim();
				}
				return basicCreds;
			} catch {
				return authHeader.slice(6).trim();
			}
		}
		if (authHeader.includes("AWS4-HMAC-SHA256")) {
			const match = /Credential=Bearer\s+([^/\s,]+)/.exec(authHeader);
			if (match) {
				return match[1]!;
			}
			const credMatch = /Credential=([^/\s,]+)/.exec(authHeader);
			if (credMatch) {
				return credMatch[1]!;
			}
			return null;
		}
	}

	// PY: Anthropic authorization header
	const anthropicAuth = req.headers["anthropic-authorization"];
	if (typeof anthropicAuth === "string" && anthropicAuth.length > 0) {
		return anthropicAuth.startsWith(BEARER_PREFIX) ? anthropicAuth.slice(BEARER_PREFIX.length).trim() : anthropicAuth.trim();
	}

	// PY: Azure authorization header
	const azureAuth = req.headers["azure-authorization"];
	if (typeof azureAuth === "string" && azureAuth.length > 0) {
		return azureAuth.startsWith(BEARER_PREFIX) ? azureAuth.slice(BEARER_PREFIX.length).trim() : azureAuth.trim();
	}

	// PY: Google AI Studio authorization header
	const googleAuth = req.headers["google-ai-studio-authorization"];
	if (typeof googleAuth === "string" && googleAuth.length > 0) {
		return googleAuth.startsWith(BEARER_PREFIX) ? googleAuth.slice(BEARER_PREFIX.length).trim() : googleAuth.trim();
	}

	// PY: custom_litellm_key_header_name (general_settings 中可配置的任意 header 名)
	if (customKeyHeaderName) {
		const customHeader = req.headers[customKeyHeaderName.toLowerCase()];
		if (typeof customHeader === "string" && customHeader.length > 0) {
			return customHeader.trim();
		}
	}

	for (const header of API_KEY_HEADERS) {
		const value = req.headers[header];
		if (typeof value === "string" && value.length > 0) {
			return value.trim();
		}
	}

	// PY: litellm_user_api_key custom header for pass-through endpoints (user_api_key_auth.py:402-447)
	const litellmUserApiKey = req.headers["litellm_user_api_key"];
	if (typeof litellmUserApiKey === "string" && litellmUserApiKey.length > 0) {
		return litellmUserApiKey.trim();
	}

	// PY: Azure APIM subscription key header (user_api_key_auth.py:379-381)
	const azureApimValue = req.headers[AZURE_APIM_HEADER];
	if (typeof azureApimValue === "string" && azureApimValue.length > 0) {
		return azureApimValue.trim();
	}

	// PY: WebSocket sec-websocket-protocol subprotocol extraction
	const wsProtocol = req.headers["sec-websocket-protocol"];
	if (typeof wsProtocol === "string" && wsProtocol.includes(WS_SUBPROTOCOL_PREFIX)) {
		const parts = wsProtocol.split(",").map((s) => s.trim());
		const litellmPart = parts.find((p) => p.startsWith(WS_SUBPROTOCOL_PREFIX));
		if (litellmPart) {
			return litellmPart.slice(WS_SUBPROTOCOL_PREFIX.length).trim();
		}
	}

	// PY: Google query param key (?key=) for Vertex AI routes
	if (typeof req.query?.key === "string" && req.query.key.length > 0) {
		return req.query.key.trim();
	}

	// PY: WebUI 登录后 `token` cookie 携带 JWT（user_api_key_auth.py:323-330）
	// Python 使用 FastAPI Request.cookies；Node 需手动解析 Cookie 头
	const cookieToken = parseCookieToken(req.headers.cookie);
	if (cookieToken) {
		return cookieToken;
	}

	return null;
}

/**
 * 从 Cookie 头中提取 WebUI 登录 JWT cookie 字段。
 * 不引入 cookie-parser 依赖，直接字符串解析（与 Python webui 行为一致）。
 *
 * 安全约束：token 字段长度不得超过 MAX_COOKIE_VALUE_LENGTH，避免超长/异常输入进入
 * 后续的 JWT 验签或哈希路径。
 * @param cookieHeader - req.headers.cookie 原始字符串
 * @returns token 值或 null
 */
export function parseCookieToken(cookieHeader: string | undefined): string | null {
	return parseCookieValue(cookieHeader, WEBUI_COOKIE_TOKEN_NAME);
}

/**
 * 解析受长度限制的单个 cookie 值。
 * @param cookieHeader
 * @param cookieName
 */
export function parseCookieValue(cookieHeader: string | undefined, cookieName: string): string | null {
	if (!cookieHeader || cookieName.length === 0 || cookieName.length > MAX_COOKIE_NAME_LENGTH) {
		return null;
	}
	for (const part of cookieHeader.split(";")) {
		const trimmed = part.trim();
		if (trimmed.length === 0 || trimmed.length > MAX_COOKIE_NAME_LENGTH + 1 + MAX_COOKIE_VALUE_LENGTH) {
			continue;
		}
		const eqIndex = trimmed.indexOf("=");
		if (eqIndex <= 0 || eqIndex > MAX_COOKIE_NAME_LENGTH || trimmed.slice(0, eqIndex) !== cookieName) {
			continue;
		}
		const rawValue = trimmed.slice(eqIndex + 1);
		if (rawValue.length === 0 || rawValue.length > MAX_COOKIE_VALUE_LENGTH) {
			return null;
		}
		try {
			return decodeURIComponent(rawValue);
		} catch {
			return null;
		}
	}
	return null;
}

/**
 * 创建 API 密钥认证中间件
 * @param repository - 认证仓库实例
 * @param masterKey - 可选超级管理员密钥（直接放行）
 * @param jwtHandler
 * @param customKeyHeaderName - 可选的自定义密钥头名（PY general_settings.custom_litellm_key_header_name）
 * @returns Express 请求处理中间件
 */
export function createApiKeyAuth(
	repository: AuthRepository,
	masterKey?: string,
	jwtHandler?: JWTHandler,
	customKeyHeaderName?: string,
): RequestHandler {
	return async (req, _res, next): Promise<void> => {
		try {
			const cookieToken = parseCookieToken(req.headers.cookie);
			const apiKey = extractApiKey(req, customKeyHeaderName);
			const isCookieCredential = cookieToken !== null && apiKey === cookieToken;

			if (!apiKey) {
				throw ApiError.unauthorized("Missing API key");
			}

			// 超级管理员密钥检查（使用 timingSafeEqual 防止时序攻击）
			// PY: 两个分支: 1) 直接比较 2) 哈希后比较 (user_api_key_auth.py:1055-1065)
			// PY: master key 认证通过时 user_role=LitellmUserRoles.PROXY_ADMIN
			// (user_api_key_auth.py:1073-1085)，使 /get/config/callbacks、
			// /model/cost_map/source 等 admin 端点对 master key 放行。
			if (masterKey && apiKey.length === masterKey.length) {
				try {
					if (crypto.timingSafeEqual(Buffer.from(apiKey), Buffer.from(masterKey))) {
						// 批次 9: master key 请求 user_id=default_user_id，对齐 PY
						// user_api_key_auth.py:1081 valid_token_dict user_id=litellm_proxy_admin_name
						// （constants.py LITELLM_PROXY_ADMIN_NAME="default_user_id"），
						// SpendLogs.user 与 Python 生产行一致。
						req.auth = {
							api_key: apiKey,
							user_id: PROXY_ADMIN_USER_ID,
							user_role: PROXY_ADMIN_ROLE,
						} satisfies UserAPIKeyAuth;
						next();
						return;
					}
				} catch {
					// 类型不兼容时继续 DB 查找
				}
				// PY: 第二个分支 — 允许传入已哈希的 master key 进行比较
				try {
					const hashedApiKey = hashApiKey(apiKey);
					if (
						hashedApiKey.length === masterKey.length &&
						crypto.timingSafeEqual(Buffer.from(hashedApiKey), Buffer.from(masterKey))
					) {
						req.auth = {
							api_key: apiKey,
							user_id: PROXY_ADMIN_USER_ID,
							user_role: PROXY_ADMIN_ROLE,
						} satisfies UserAPIKeyAuth;
						next();
						return;
					}
				} catch {
					// 类型不兼容时继续 DB 查找
				}
			}
			// Cookie JWT 是服务端 session：验签后还必须用 jti hash 查询 DB，
			// 从而让 expires、blocked 与 logout 可立即撤销浏览器会话。
			if (jwtHandler && JWTHandler.isJwt(apiKey)) {
				const jwtResult = await jwtHandler.verifyJwt(apiKey);
				if (!jwtResult) {
					throw ApiError.unauthorized("JWT verification failed");
				}
				if (isCookieCredential) {
					const claims = jwtResult.claims;
					const jti = pickStringClaim(claims, "jti");
					if (
						claims.webui_session !== true ||
						!jti ||
						typeof claims.iat !== "number" ||
						typeof claims.exp !== "number" ||
						claims.exp <= claims.iat
					) {
						throw ApiError.unauthorized("Invalid WebUI session claims");
					}
					const sessionHash = hashApiKey(jti);
					const session = await repository.findVerificationTokenByHash(sessionHash);
					const metadata = session?.metadata as Record<string, unknown> | null | undefined;
					if (
						!session ||
						session.blocked ||
						session.teamId !== WEBUI_LOGIN_TEAM_ID ||
						metadata?.webui_session !== true ||
						!session.expires ||
						session.expires.getTime() <= Date.now()
					) {
						throw ApiError.unauthorized("Invalid or revoked WebUI session");
					}
					req.auth = {
						api_key: session.token,
						token: session.token,
						user_id: pickStringClaim(claims, "user_id") ?? PROXY_ADMIN_USER_ID,
						user_role: pickStringClaim(claims, "user_role") ?? PROXY_ADMIN_ROLE,
						team_id: session.teamId,
						expires: session.expires.toISOString(),
						metadata: pickSafeJwtClaims(claims),
					} satisfies UserAPIKeyAuth;
					next();
					return;
				}
				req.auth = {
					api_key: apiKey,
					user_id:
						pickStringClaim(jwtResult.claims, "sub") ?? pickStringClaim(jwtResult.claims, "user_id") ?? JWT_FALLBACK_USER_ID,
					metadata: pickSafeJwtClaims(jwtResult.claims),
				} satisfies UserAPIKeyAuth;
				next();
				return;
			}

			// 哈希密钥并在数据库中查找
			const tokenHash = hashApiKey(apiKey);
			let token = await repository.findVerificationTokenByHash(tokenHash);

			if (!token) {
				const deprecatedToken = await repository.findDeprecatedVerificationTokenByHash(tokenHash);
				if (!deprecatedToken || deprecatedToken.revokeAt.getTime() <= Date.now()) {
					throw ApiError.unauthorized("Invalid or revoked API key");
				}
				token = await repository.findVerificationTokenByHash(deprecatedToken.activeTokenId);
			}
			if (!token) {
				throw ApiError.unauthorized("Invalid or revoked API key");
			}
			// TS type narrowing: token is guaranteed non-null after this check
			const verifiedToken: NonNullable<typeof token> = token;

			if (verifiedToken.blocked) {
				throw ApiError.unauthorized("API key is blocked");
			}

			// 检查令牌是否过期
			// DIFF-AUTH-02: 对齐 PY `litellm/proxy/auth/user_api_key_auth.py:1313-1334` —
			// Python 用 `datetime.now(timezone.utc)` 取得 UTC 当前时间再与 expires 比较。
			// TS 端使用 epoch 毫秒比较：`new Date(verifiedToken.expires).getTime()` 把 ISO-8601
			// 时间解析为 epoch 毫秒（与时区无关，等价于 UTC 毫秒），与 `Date.now()`（UTC 毫秒）直接
			// 数值比较即可，语义与 PY 的 `datetime.now(timezone.utc)` 一致。
			// 注意：此处未使用 `Date.UTC(...)`（那是构造器，参数是字段分量而非 timestamp），
			// 也不需要 `Date.parse` —— 直接用 `new Date(iso).getTime()` 即可。
			// 之前注释把"用 Date.UTC 显式构造 UTC 毫秒"当作实现，与实际代码不一致，已重写。
			if (verifiedToken.expires) {
				const expiryMs = new Date(verifiedToken.expires).getTime();
				const nowMs = Date.now();
				// PY: 严格 < 视为过期。`expiryMs === nowMs` 也应判过期（边界条件）。
				if (expiryMs <= nowMs) {
					throw ApiError.unauthorized("API key has expired");
				}
			}

			// 若关联了端用户，检查端用户是否被阻止
			// 若关联了预算，根据预算设置限制
			const keyBudget = verifiedToken.budgetId ? await repository.findBudgetById(verifiedToken.budgetId) : null;
			const budgetSnapshots: BudgetSnapshots = {
				key: {
					id: verifiedToken.token,
					spend: verifiedToken.spend ?? 0,
					max_budget: keyBudget?.max_budget ?? verifiedToken.maxBudget ?? null,
					budget_id: verifiedToken.budgetId ?? undefined,
				},
			};
			let teamModelAliases: Record<string, string> | undefined;
			let teamSoftBudget: number | undefined;
			let teamAlias: string | undefined;
			if (verifiedToken.teamId) {
				const team = await repository.findTeamById(verifiedToken.teamId);
				if (team?.blocked) {
					throw ApiError.unauthorized("Associated team is disabled");
				}
				if (team) {
					budgetSnapshots.team = { id: team.teamId, spend: team.spend ?? 0, max_budget: team.maxBudget ?? null };
				}
				teamAlias = team?.teamAlias ?? undefined;
				const meta = (team?.metadata as Record<string, unknown> | undefined) ?? {};
				teamModelAliases = meta["model_group_alias"] as Record<string, string> | undefined;
				teamSoftBudget = team?.softBudget ?? (meta["soft_budget"] as number | undefined);
			}

			let userRole: string | undefined;
			if (verifiedToken.userId) {
				const user = await repository.findUserById(verifiedToken.userId);
				userRole = user?.userRole ?? "internal_user";
				if (user) {
					budgetSnapshots.user = { id: user.userId, spend: user.spend ?? 0, max_budget: user.maxBudget ?? null };
				}
			}

			if (verifiedToken.userId && verifiedToken.teamId && repository.findTeamMembership) {
				const membership = await repository.findTeamMembership(verifiedToken.userId, verifiedToken.teamId);
				if (membership) {
					const budget = membership.budgetId ? await repository.findBudgetById(membership.budgetId) : null;
					budgetSnapshots.team_member = {
						id: `${membership.userId}:${membership.teamId}`,
						spend: membership.spend ?? 0,
						max_budget: budget?.max_budget ?? null,
						budget_id: membership.budgetId ?? undefined,
					};
				}
			}

			if (verifiedToken.organizationId && repository.findOrganizationById) {
				const organization = await repository.findOrganizationById(verifiedToken.organizationId);
				if (organization) {
					const budget = await repository.findBudgetById(organization.budgetId);
					budgetSnapshots.organization = {
						id: organization.organizationId,
						spend: organization.spend ?? 0,
						max_budget: budget?.max_budget ?? null,
						budget_id: organization.budgetId,
					};
				}
			}

			if (verifiedToken.projectId && repository.findProjectById) {
				const project = await repository.findProjectById(verifiedToken.projectId);
				if (project) {
					const budget = project.budgetId ? await repository.findBudgetById(project.budgetId) : null;
					budgetSnapshots.project = {
						id: project.projectId,
						spend: project.spend ?? 0,
						max_budget: budget?.max_budget ?? null,
						budget_id: project.budgetId ?? undefined,
					};
				}
			}

			const endUserId = _extractEndUserId(req);
			if (endUserId && repository.findEndUserById) {
				const endUser = await repository.findEndUserById(endUserId);
				if (endUser?.blocked) {
					throw ApiError.forbidden("End user is blocked");
				}
				if (endUser) {
					const budget = endUser.budgetId ? await repository.findBudgetById(endUser.budgetId) : null;
					budgetSnapshots.end_user = {
						id: endUser.userId,
						spend: endUser.spend ?? 0,
						max_budget: budget?.max_budget ?? null,
						budget_id: endUser.budgetId ?? undefined,
					};
				}
			}

			// 构造认证上下文
			req.auth = {
				api_key: apiKey,
				token: verifiedToken.token,
				user_id: verifiedToken.userId ?? undefined,
				user_role: userRole,
				team_id: verifiedToken.teamId ?? undefined,
				team_alias: teamAlias,
				organization_id: verifiedToken.organizationId ?? undefined,
				project_id: verifiedToken.projectId ?? undefined,
				key_alias: verifiedToken.keyAlias ?? undefined,
				models: verifiedToken.models,
				spend: verifiedToken.spend ?? 0,
				max_budget: verifiedToken.maxBudget ?? undefined,
				budget_snapshots: budgetSnapshots,
				tpm_limit: verifiedToken.tpmLimit ?? undefined,
				rpm_limit: verifiedToken.rpmLimit ?? undefined,
				metadata: (verifiedToken.metadata as Record<string, unknown>) ?? undefined,
				blocked: verifiedToken.blocked ?? false,
				permissions: (verifiedToken.permissions as Record<string, unknown>) ?? undefined,
				budget_reset_at: verifiedToken.budgetResetAt?.toISOString() ?? undefined,
				expires: verifiedToken.expires?.toISOString() ?? undefined,
				key_name: verifiedToken.keyName ?? undefined,
				allowed_routes: verifiedToken.allowedRoutes ?? undefined,
				model_spend: (verifiedToken.modelSpend as Record<string, number>) ?? undefined,
				model_max_budget: (verifiedToken.modelMaxBudget as Record<string, number>) ?? undefined,
				budget_id: verifiedToken.budgetId ?? undefined,
				last_active: verifiedToken.lastActive?.toISOString() ?? undefined,
				max_parallel_requests: verifiedToken.maxParallelRequests ?? undefined,
				soft_budget:
					((verifiedToken.metadata as Record<string, unknown> | null)?.soft_budget as number | undefined) ?? teamSoftBudget,

				team_model_aliases: teamModelAliases,
				// GAP 10: 从请求体 user / x-end-user-id header 提取 end_user_id，
				// 对齐 PY get_end_user_id_for_cost_tracking(litellm_params) 路径。
				// 优先级：x-end-user-id header > req.body.user
				end_user_id: endUserId,
			} satisfies UserAPIKeyAuth;

			next();
		} catch (error) {
			if (!(error instanceof ApiError)) {
				logger.error("认证中间件非预期异常", {
					error: error instanceof Error ? error.message : String(error),
					stack: error instanceof Error ? error.stack : undefined,
					method: req.method,
					url: req.originalUrl,
				});
			}
			next(error instanceof ApiError ? error : ApiError.unavailable("认证账务数据暂不可用"));
		}
	};
}

/**
 * 对 cookie-authenticated WebUI 写请求执行 double-submit CSRF 校验。
 * 显式 API key / bearer 客户端没有 webui_session metadata，保持兼容。
 * @param req
 * @param _res
 * @param next
 */
export const webUiCsrfProtection: RequestHandler = (req, _res, next): void => {
	try {
		if (req.auth?.metadata?.webui_session !== true || ["GET", "HEAD", "OPTIONS"].includes(req.method)) {
			next();
			return;
		}
		const cookieToken = parseCookieValue(req.headers.cookie, WEBUI_CSRF_COOKIE_NAME);
		const headerValue = req.headers[WEBUI_CSRF_HEADER_NAME];
		const headerToken = Array.isArray(headerValue) ? headerValue[0] : headerValue;
		if (!cookieToken || typeof headerToken !== "string" || !timingSafeStringEqual(cookieToken, headerToken)) {
			throw ApiError.forbidden("Invalid CSRF token");
		}
		next();
	} catch (error) {
		next(error);
	}
};

function timingSafeStringEqual(left: string, right: string): boolean {
	const leftBuffer = Buffer.from(left, "utf8");
	const rightBuffer = Buffer.from(right, "utf8");
	return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}
