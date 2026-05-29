/**
 * UserApiKeyAuth — API 密钥认证中间件
 *
 * 等效于 Python litellm-proxy 的 user_api_key_auth()。
 * 从请求头提取 API 密钥，哈希后在 LiteLLM_VerificationToken 表中查找，
 * 将认证元数据挂载到 req.auth 上供下游使用。
 */

import * as crypto from "node:crypto";
import type { Request, RequestHandler } from "express";
import { ApiError } from "../core/api/ApiError";
import { hashApiKey } from "../core/utils/crypto";
import type { AuthRepository } from "./AuthRepository";
import type { UserAPIKeyAuth } from "../types/auth";
import { JWTHandler } from "./JWTHandler";

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
			const apiKey = extractApiKey(req, customKeyHeaderName);

			if (!apiKey) {
				throw ApiError.unauthorized("缺少 API 密钥");
			}

			// 超级管理员密钥检查（使用 timingSafeEqual 防止时序攻击）
			// PY: 两个分支: 1) 直接比较 2) 哈希后比较 (user_api_key_auth.py:1055-1065)
			if (masterKey && apiKey.length === masterKey.length) {
				try {
					if (crypto.timingSafeEqual(Buffer.from(apiKey), Buffer.from(masterKey))) {
						req.auth = {
							api_key: apiKey,
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
						} satisfies UserAPIKeyAuth;
						next();
						return;
					}
				} catch {
					// 类型不兼容时继续 DB 查找
				}
			}
			// PY: JWT verification (user_api_key_auth.py:680-720)
			if (jwtHandler && JWTHandler.isJwt(apiKey)) {
				const jwtResult = await jwtHandler.verifyJwt(apiKey);
				if (!jwtResult) {
					throw ApiError.unauthorized("JWT 令牌验证失败");
				}
				// JWT validated — construct auth context from claims
				req.auth = {
					api_key: apiKey,
					user_id: (jwtResult.claims.sub as string) ?? (jwtResult.claims.user_id as string) ?? "jwt-user",
					metadata: jwtResult.claims as Record<string, unknown>,
				} satisfies UserAPIKeyAuth;
				next();
				return;
			}

			// 哈希密钥并在数据库中查找
			const tokenHash = hashApiKey(apiKey);
			const token = await repository.findVerificationTokenByHash(tokenHash);

			if (!token) {
				throw ApiError.unauthorized("API 密钥无效或已撤销");
			}
			// TS type narrowing: token is guaranteed non-null after this check
			const verifiedToken: NonNullable<typeof token> = token;

			// 检查令牌是否过期
			// DIFF-AUTH-02: 对齐 PY user_api_key_auth.py:1313-1334 — 用 `datetime.now(timezone.utc)`
			// 做 UTC 显式转换。TS 端 `new Date(verifiedToken.expires).getTime()` 解析 ISO-8601
			// 字符串会返回 epoch 毫秒（时区无关，统一 UTC），与 `Date.now()` 直接比较。
			// 注意：Date.parse 与 Date.UTC 行为不同；本处并未使用 Date.UTC（注释已修正）。
			// 之前注释错把"用 Date.UTC 显式构造 UTC 毫秒"当作实现，实际仍用 epoch 毫秒直接比较。
			if (verifiedToken.expires) {
				const expiryMs = new Date(verifiedToken.expires).getTime();
				const nowMs = Date.now();
				// PY: 严格 < 视为过期。`expiryMs === nowMs` 也应判过期（边界条件）。
				if (expiryMs <= nowMs) {
					throw ApiError.unauthorized("API 密钥已过期");
				}
			}

			// 若关联了端用户，检查端用户是否被阻止
			// 若关联了预算，根据预算设置限制
			let teamSpend: number | undefined;
			let teamMaxBudget: number | undefined;
			let teamModelAliases: Record<string, string> | undefined;
			let teamSoftBudget: number | undefined;
			if (verifiedToken.teamId) {
				const team = await repository.findTeamById(verifiedToken.teamId);
				if (team?.blocked) {
					throw ApiError.unauthorized("所属团队已被禁用");
				}
				teamSpend = team?.spend ?? undefined;
				teamMaxBudget = team?.maxBudget ?? undefined;
				const meta = (team?.metadata as Record<string, unknown> | undefined) ?? {};
				teamModelAliases = meta["model_group_alias"] as Record<string, string> | undefined;
				// PY: soft_budget is a direct column on LiteLLM_TeamTable (types.py:1486, teams.ts:20)
				teamSoftBudget = team?.softBudget ?? (meta["soft_budget"] as number | undefined);
			}

			// 构造认证上下文
			req.auth = {
				api_key: apiKey,
				token: verifiedToken.token,
				user_id: verifiedToken.userId ?? undefined,
				team_id: verifiedToken.teamId ?? undefined,
				organization_id: verifiedToken.organizationId ?? undefined,
				key_alias: verifiedToken.keyAlias ?? undefined,
				models: verifiedToken.models,
				spend: (verifiedToken.spend ?? 0) + (teamSpend ?? 0),
				max_budget: verifiedToken.maxBudget ?? teamMaxBudget,
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
				// eslint-disable-next-line camelcase
				team_model_aliases: teamModelAliases,
				// GAP 10: 从请求体 user / x-end-user-id header 提取 end_user_id，
				// 对齐 PY get_end_user_id_for_cost_tracking(litellm_params) 路径。
				// 优先级：x-end-user-id header > req.body.user
				end_user_id: _extractEndUserId(req),
			} satisfies UserAPIKeyAuth;

			next();
		} catch (error) {
			next(error);
		}
	};
}
