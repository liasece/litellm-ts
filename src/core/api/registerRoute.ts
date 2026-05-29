/**
 * 轻量级路由注册工厂
 *
 * 将 method + path + handler 映射为 Express 路由处理器，自动处理：
 * 1. handler return 数据 → res.json(result)
 * 2. handler throw ApiError → res.status(code).json({ success: false, message })
 * 3. 未知异常 → 500 + 日志记录
 * 4. handler 已手动调用 res.json() → 通过 headersSent 检测跳过
 */

import type { Router, Request, Response, NextFunction } from "express";
import { ApiError, HTTP_STATUS } from "./ApiError";
import { createModuleLogger, toErrorMessage } from "../utils/logger";

const logger = createModuleLogger("API:Route");

/** HTTP 方法字面量类型 */
export type HttpMethodLiteral = "get" | "post" | "put" | "delete" | "patch";

/** 端点定义 */
export interface EndpointDef {
	/** HTTP 方法 */
	readonly method: HttpMethodLiteral;
	/** 路由路径（如 "/api/keys/:id"） */
	readonly path: string;
}

/** 路由处理器函数签名 */
export type RouteHandler = (req: Request, res: Response) => unknown | Promise<unknown>;

/**
 * 注册路由到 Express Router
 *
 * handler 的返回值自动 res.json()，无需手动调用。
 * handler 可 throw ApiError 触发统一错误响应。
 * 若 handler 已手动调用 res.json() 并返回 undefined，工厂跳过自动序列化。
 * @param router - Express Router 实例
 * @param endpoint - 端点定义（method + path）
 * @param handler - 路由处理器
 */
export function registerRoute(router: Router, endpoint: EndpointDef, handler: RouteHandler): void {
	router[endpoint.method](endpoint.path, async (req: Request, res: Response, _next: NextFunction) => {
		try {
			const result = await handler(req, res);
			// handler 已手动发送响应时跳过
			if (result !== undefined && !res.headersSent) {
				res.json(result);
			}
		} catch (error) {
			if (res.headersSent) {
				return;
			}
			if (error instanceof ApiError) {
				res.status(error.statusCode).json({
					success: false,
					message: error.message,
				});
			} else {
				const message = toErrorMessage(error);
				logger.error(`路由处理异常: ${endpoint.method.toUpperCase()} ${endpoint.path}`, { error: error });
				res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
					success: false,
					message: message,
				});
			}
		}
	});
}
