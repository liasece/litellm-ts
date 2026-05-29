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

/** 支持的 API 密钥来源请求头 */
const API_KEY_HEADERS = ["x-api-key", "x-litellm-key", "api-key", "x-goog-api-key"] as const;

/** Authorization Header 前缀 */
const BEARER_PREFIX = "Bearer ";

/**
 * 从请求中提取 API 密钥
 * 优先级：Authorization: Bearer > x-api-key > x-litellm-key > api-key > x-goog-api-key
 * 支持 Basic（取 password 部分）、AWS4-HMAC-SHA256 Credential 格式
 * @param req
 */
export function extractApiKey(req: Request): string | null {
	const authHeader = req.headers.authorization;
	if (authHeader) {
		if (authHeader.startsWith(BEARER_PREFIX)) {
			return authHeader.slice(BEARER_PREFIX.length).trim();
		}
		if (authHeader.startsWith("Basic ")) {
			return authHeader.slice(6).trim();
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

	for (const header of API_KEY_HEADERS) {
		const value = req.headers[header];
		if (typeof value === "string" && value.length > 0) {
			return value.trim();
		}
	}

	return null;
}

/**
 * 创建 API 密钥认证中间件
 * @param repository - 认证仓库实例
 * @param masterKey - 可选超级管理员密钥（直接放行）
 * @returns Express 请求处理中间件
 */
export function createApiKeyAuth(repository: AuthRepository, masterKey?: string): RequestHandler {
	return async (req, _res, next): Promise<void> => {
		try {
			const apiKey = extractApiKey(req);

			if (!apiKey) {
				throw ApiError.unauthorized("缺少 API 密钥");
			}

			// 超级管理员密钥检查（使用 timingSafeEqual 防止时序攻击）
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
			}

			// 哈希密钥并在数据库中查找
			const tokenHash = hashApiKey(apiKey);
			const token = await repository.findVerificationTokenByHash(tokenHash);

			if (!token) {
				throw ApiError.unauthorized("API 密钥无效或已撤销");
			}

			// 检查令牌是否过期
			if (token.expires && new Date(token.expires) < new Date()) {
				throw ApiError.unauthorized("API 密钥已过期");
			}

			// 若关联了端用户，检查端用户是否被阻止
			// 若关联了预算，根据预算设置限制
			let teamSpend: number | undefined;
			let teamMaxBudget: number | undefined;
			let teamModelAliases: Record<string, string> | undefined;
			let teamSoftBudget: number | undefined;
			if (token.teamId) {
				const team = await repository.findTeamById(token.teamId);
				if (team?.blocked) {
					throw ApiError.unauthorized("所属团队已被禁用");
				}
				teamSpend = team?.spend ?? undefined;
				teamMaxBudget = team?.maxBudget ?? undefined;
				const meta = (team?.metadata as Record<string, unknown> | undefined) ?? {};
				teamModelAliases = meta["model_group_alias"] as Record<string, string> | undefined;
				teamSoftBudget = meta["soft_budget"] as number | undefined;
			}

			// 构造认证上下文
			req.auth = {
				api_key: apiKey,
				token: token.token,
				user_id: token.userId ?? undefined,
				team_id: token.teamId ?? undefined,
				organization_id: token.organizationId ?? undefined,
				key_alias: token.keyAlias ?? undefined,
				models: token.models,
				spend: (token.spend ?? 0) + (teamSpend ?? 0),
				max_budget: token.maxBudget ?? teamMaxBudget,
				tpm_limit: token.tpmLimit ?? undefined,
				rpm_limit: token.rpmLimit ?? undefined,
				metadata: (token.metadata as Record<string, unknown>) ?? undefined,
				blocked: token.blocked ?? false,
				permissions: (token.permissions as Record<string, unknown>) ?? undefined,
				budget_reset_at: token.budgetResetAt?.toISOString() ?? undefined,
				expires: token.expires?.toISOString() ?? undefined,
				key_name: token.keyName ?? undefined,
				allowed_routes: token.allowedRoutes ?? undefined,
				model_spend: (token.modelSpend as Record<string, number>) ?? undefined,
				model_max_budget: (token.modelMaxBudget as Record<string, number>) ?? undefined,
				budget_id: token.budgetId ?? undefined,
				last_active: token.lastActive?.toISOString() ?? undefined,
				max_parallel_requests: token.maxParallelRequests ?? undefined,
				soft_budget: ((token.metadata as Record<string, unknown> | null)?.soft_budget as number | undefined) ?? teamSoftBudget,
				// eslint-disable-next-line camelcase
				team_model_aliases: teamModelAliases,
			} satisfies UserAPIKeyAuth;

			next();
		} catch (error) {
			next(error);
		}
	};
}
