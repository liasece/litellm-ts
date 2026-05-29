/**
 * 访问日志过滤器中间件
 *
 * 仅记录非 2xx 的 HTTP 响应，减少 2xx 成功响应的日志噪音（Patch 8 需求）。
 * 3xx/4xx/5xx 响应记录警告/错误级别的日志，静默跳过 2xx。
 */

import type { Request, Response, NextFunction } from "express";
import { createModuleLogger } from "../core/utils/logger";

const logger = createModuleLogger("HTTP");

/** 2xx 状态码范围上限 */
const STATUS_2XX_MAX = 299;

/** 4xx 状态码范围下限 */
const STATUS_4XX_MIN = 400;

/**
 * 访问日志过滤器中间件
 * 在响应结束时根据状态码级别记录日志
 * @param req
 * @param res
 * @param next
 */
export function accessLogFilter(req: Request, res: Response, next: NextFunction): void {
	const startTime = Date.now();

	// 注册响应结束监听
	res.on("finish", () => {
		const duration = Date.now() - startTime;
		const statusCode = res.statusCode;

		// 2xx — 静默跳过
		if (statusCode <= STATUS_2XX_MAX) {
			return;
		}

		// 3xx — 重定向，记录简要信息
		if (statusCode < STATUS_4XX_MIN) {
			logger.info(`${req.method} ${req.originalUrl} → ${statusCode} (${duration}ms)`);
			return;
		}

		// 4xx — 客户端错误
		if (statusCode < 500) {
			logger.warn(`${req.method} ${req.originalUrl} → ${statusCode} (${duration}ms)`);
			return;
		}

		// 5xx — 服务端错误
		logger.error(`${req.method} ${req.originalUrl} → ${statusCode} (${duration}ms)`);
	});

	next();
}
