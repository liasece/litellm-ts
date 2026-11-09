/**
 * 脱敏中间件。
 *
 * 挂在推理路由鉴权之后、业务端点之前，对每个请求做三件事：
 * 1. 解析配置，决定是否启用（总开关 / 密钥级 pii 权限 / 请求头）；
 * 2. 按协议改写请求体里的敏感内容，并把该请求的值↔占位符映射保存在内存上下文里；
 * 3. 装上响应还原写入器，请求结束后异步写入统计。
 *
 * 脱敏自身出错时默认 fail-closed：宁可 503 也不把未脱敏的原文发给上游。
 * 所有统计只写派生信息，原文在请求结束、上下文释放后即不再存在。
 */
import type { Request, RequestHandler, Response } from "express";
import { ApiError } from "../core/api/ApiError";
import type { DrizzleDb } from "../core/db/Database";
import { createModuleLogger } from "../core/utils/logger";
import type { Router as LiteLLMRouter } from "../router/Router";
import { getOrCreateSpendRequestId } from "../spend/SpendTracker";
import { detectPrivacyClient, detectPrivacyProvider } from "./ClientAttribution";
import { getConfiguredSecrets } from "./ConfiguredSecrets";
import { PrivacyContext } from "./PrivacyContext";
import { DEFAULT_PRIVACY_MASKING_SETTINGS, privacySettingsService } from "./PrivacyConfig";
import { installPrivacyResponseWriter } from "./PrivacyResponseWriter";
import { detectPrivacyProtocol, maskRequestBody } from "./RequestBodyMasker";
import { PrivacyStatsRepository } from "./PrivacyStatsRepository";

const logger = createModuleLogger("privacy");

/** 中间件依赖 */
export interface PrivacyMiddlewareDeps {
	/** 路由实例（用于解析提供方与部署凭据） */
	readonly router: LiteLLMRouter;
	/** 数据库实例（用于写入统计） */
	readonly db: DrizzleDb;
}

/**
 * 判断请求是否显式退出脱敏。
 *
 * 只看两个明确的信号：密钥权限里的 `pii: false`，或请求头 `x-litellm-no-pii: true`。
 * 其余情况（头缺失、权限未配置）一律按启用处理，避免「配置漏了就不脱敏」。
 * @param req - Express 请求
 */
function isPrivacyOptedOut(req: Request): boolean {
	const header = req.headers["x-litellm-no-pii"];
	const headerValue = Array.isArray(header) ? header[0] : header;
	if (typeof headerValue === "string" && headerValue.trim().toLowerCase() === "true") {
		return true;
	}
	const permissions = req.auth?.permissions;
	if (permissions !== undefined && permissions["pii"] === false) {
		return true;
	}
	return false;
}

/**
 * 读取请求体里的模型名。
 * @param body - 请求体
 */
function readModel(body: Record<string, unknown>): string {
	const model = body["model"];
	return typeof model === "string" ? model : "";
}

/**
 * 创建脱敏中间件。
 * @param deps - 依赖（Router 与数据库）
 */
export function privacyMaskingMiddleware(deps: PrivacyMiddlewareDeps): RequestHandler {
	const repository = new PrivacyStatsRepository(deps.db);
	return (req: Request, res: Response, next: (error?: unknown) => void): void => {
		void (async () => {
			const settings = await privacySettingsService.getSettings().catch(() => DEFAULT_PRIVACY_MASKING_SETTINGS);
			if (!settings.enabled || isPrivacyOptedOut(req)) {
				next();
				return;
			}
			const body = req.body;
			if (typeof body !== "object" || body === null || Array.isArray(body)) {
				next();
				return;
			}
			const protocol = detectPrivacyProtocol(req.path);
			if (protocol === "skip") {
				next();
				return;
			}
			const payload = body as Record<string, unknown>;
			let context: PrivacyContext;
			try {
				context = new PrivacyContext({
					settings: settings,
					customWords: settings.customWords,
					configuredSecrets: settings.maskConfiguredSecrets ? getConfiguredSecrets(deps.router) : [],
				});
				maskRequestBody(payload, context, protocol);
				installPrivacyResponseWriter(res, context);
			} catch (error) {
				if (settings.failClosed) {
					logger.error("脱敏处理失败，按 fail-closed 拒绝请求", { error: error, path: req.path });
					next(new ApiError(503, "Privacy masking failed; request rejected"));
					return;
				}
				logger.error("脱敏处理失败，按 fail-open 继续转发", { error: error, path: req.path });
				next();
				return;
			}

			const requestId = getOrCreateSpendRequestId(req);
			const client = detectPrivacyClient(req.headers);
			const provider = detectPrivacyProvider(deps.router, payload["model"]);
			const model = readModel(payload);
			const apiKey = req.auth?.token !== undefined && req.auth.token.length > 0 ? req.auth.token : (req.auth?.api_key ?? "");
			const userId = req.auth?.user_id ?? null;
			const teamId = req.auth?.team_id ?? null;
			res.once("finish", () => {
				const stats = context.snapshotStats();
				if (stats.occurrences <= 0) {
					return;
				}
				void repository
					.record({
						requestId: requestId,
						apiKey: apiKey,
						userId: userId,
						teamId: teamId,
						client: client,
						provider: provider,
						model: model,
						kinds: stats.kinds,
						occurrences: stats.occurrences,
						distinctValues: stats.distinctValues,
						action: stats.action,
						durationMs: stats.durationMs,
						unresolved: stats.unresolved,
						values: context.valueStats(),
					}, settings.retentionDays)
					.catch((error: unknown) => {
						logger.error("写入脱敏统计失败", { error: error, requestId: requestId });
					});
			});
			next();
		})().catch((error: unknown) => {
			logger.error("脱敏中间件异常", { error: error, path: req.path });
			next(error);
		});
	};
}
