/**
 * 控制器路由注册器 — 扫描装饰器元数据并将控制器方法注册为 Express 路由
 *
 * registerController(router, controller, options) 扫描 controller 原型链上
 * 被 get/post/put/patch/del 装饰的方法，读取参数装饰器元数据，
 * 自动完成参数提取、响应序列化和统一错误处理。
 */

import type { Router, Request, Response, NextFunction, RequestHandler } from "express";
import { ApiError, HTTP_STATUS } from "./ApiError";
import { createModuleLogger, toErrorMessage } from "../utils/logger";
import { getMethodMeta, getMiddleware, getParamMeta, isNoAuth, isRawResponse, ParamKind } from "./decorators";
import type { ParamMeta } from "./decorators";

const logger = createModuleLogger("API:Controller");

/** registerController 配置选项 */
export interface RegisterControllerOptions {
	/** 认证中间件，应用到所有路由（noAuth 标记的路由除外） */
	requireAuth?: RequestHandler;
	/** 路由前缀，拼接到每个方法的 path 前面（如 "/api/keys"） */
	prefix?: string;
}

/**
 * 统一路由错误处理 — ApiError 转对应状态码，unknown Error 转 500 并记录日志
 * @param error - 捕获的异常
 * @param res - Express 响应对象
 * @param methodName - 出错的方法名（用于日志）
 */
function handleRouteError(error: unknown, res: Response, methodName: string): void {
	if (error instanceof ApiError) {
		res.status(error.statusCode).json({ success: false, message: error.message });
	} else {
		const message = toErrorMessage(error);
		logger.error(`路由处理异常: ${methodName}`, { error: error });
		res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ success: false, message: message });
	}
}

/**
 * 将控制器实例的装饰方法注册为 Express 路由
 *
 * 扫描原型链上所有方法，跳过无装饰器的方法。
 * 对每个装饰方法：
 * 1. 拼接 prefix + method path 得到完整路由路径
 * 2. 读取参数装饰器元数据，构建参数提取逻辑
 * 3. rawResponse 方法直接传入 (req, res)；其余方法提取参数后自动 res.json(result)
 * 4. 统一 catch：ApiError 转对应状态码，unknown Error 转 500 + 日志
 * @template T - 控制器类型
 * @param router - Express Router 实例
 * @param controller - 控制器实例（含装饰方法）
 * @param options - 注册选项（prefix、requireAuth）
 */
export function registerController<T extends object>(router: Router, controller: T, options?: RegisterControllerOptions): void {
	const prefix = options?.prefix ?? "";
	const requireAuth = options?.requireAuth;
	const prototype = Object.getPrototypeOf(controller);

	for (const propertyKey of Object.getOwnPropertyNames(prototype)) {
		if (propertyKey === "constructor") {
			continue;
		}
		const descriptor = Object.getOwnPropertyDescriptor(prototype, propertyKey);
		if (descriptor === undefined || typeof descriptor.value !== "function") {
			continue;
		}

		const method = descriptor.value;
		const meta = getMethodMeta(method);
		if (meta === undefined) {
			continue;
		}

		const fullPath = `${prefix}${meta.path}`;
		const paramMeta = getParamMeta(prototype.constructor as abstract new (...args: unknown[]) => unknown, propertyKey) ?? [];

		const handler = isRawResponse(method)
			? buildRawHandler(controller, method, propertyKey, paramMeta)
			: buildJsonHandler(controller, method, propertyKey, paramMeta);

		const extraMiddleware = getMiddleware(method) ?? [];
		if (isNoAuth(method) || requireAuth === undefined) {
			router[meta.httpMethod](fullPath, ...extraMiddleware, handler);
		} else {
			router[meta.httpMethod](fullPath, requireAuth, ...extraMiddleware, handler);
		}

		logger.debug(`注册路由: ${meta.httpMethod.toUpperCase()} ${fullPath}${isNoAuth(method) ? " (免认证)" : ""}`);
	}
}

/**
 * 构建 JSON 响应处理器 — 从 req 提取参数，调用方法，自动 res.json(result)
 * @param controller - 控制器实例
 * @param method - 被装饰的方法引用
 * @param methodName - 方法名（用于错误日志）
 * @param paramMeta - 参数装饰器元数据列表
 */
function buildJsonHandler(
	controller: object,
	method: (...args: unknown[]) => unknown,
	methodName: string,
	paramMeta: ParamMeta[],
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
	return async (req: Request, res: Response, _next: NextFunction) => {
		try {
			const args = extractArguments(req, paramMeta, method.length);
			const result = await method.apply(controller, args);
			if (result !== undefined && !res.headersSent) {
				res.json(result);
			}
		} catch (error) {
			if (res.headersSent) {
				return;
			}
			handleRouteError(error, res, methodName);
		}
	};
}

/**
 * 构建原始响应处理器 — 提取装饰器参数，末尾注入 (req, res)，跳过自动 res.json()
 * @param controller - 控制器实例
 * @param method - 被装饰的方法引用
 * @param methodName - 方法名（用于错误日志）
 * @param paramMeta - 参数装饰器元数据列表
 */
function buildRawHandler(
	controller: object,
	method: (...args: unknown[]) => unknown,
	methodName: string,
	paramMeta: ParamMeta[],
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
	return async (req: Request, res: Response, _next: NextFunction) => {
		try {
			const args = extractArguments(req, paramMeta, method.length);
			// 未被装饰器覆盖的末尾槽位依次填充 req、res
			for (let i = args.length - 1; i >= 1; i--) {
				if (args[i] === undefined && args[i - 1] === undefined) {
					args[i] = res;
					args[i - 1] = req;
					break;
				}
			}
			await method.apply(controller, args);
		} catch (error) {
			if (res.headersSent) {
				return;
			}
			handleRouteError(error, res, methodName);
		}
	};
}

/**
 * 根据 ParamMeta 从 Express req 提取方法参数
 * @param req - Express 请求对象
 * @param paramMeta - 参数装饰器元数据列表
 * @param methodLength - 方法参数数量（用于预分配数组）
 */
function extractArguments(req: Request, paramMeta: ParamMeta[], methodLength: number): unknown[] {
	const args: unknown[] = new Array(methodLength).fill(undefined);

	for (const param of paramMeta) {
		if (param.index >= methodLength) {
			continue;
		}

		switch (param.kind) {
			case ParamKind.Param:
				args[param.index] = req.params[param.name];
				break;
			case ParamKind.Query:
				args[param.index] = param.name !== undefined ? req.query[param.name] : req.query;
				break;
			case ParamKind.Body:
				args[param.index] = req.body;
				break;
			case ParamKind.Request:
				args[param.index] = req;
				break;
			default:
				break;
		}
	}

	return args;
}
