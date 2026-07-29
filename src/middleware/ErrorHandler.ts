/**
 * Express 全局错误处理中间件
 *
 * 集中处理所有未捕获的请求错误，响应体对齐 Python litellm ProxyException 格式：
 * { error: { message, type, param, code } }（code 为状态码字符串）
 * - ApiError / LitellmError → 经 mapToApiError 映射对应状态码
 * - SyntaxError (JSON parse failure) → 400 invalid_request_error
 * - 其他错误 → 500 + 日志记录
 */

import type { Request, Response, NextFunction } from "express";
import { ApiError, HTTP_STATUS } from "../core/api/ApiError";
import { mapToApiError } from "../core/api/ErrorResponseMapper";
import { sendProtocolError } from "../core/api/ProtocolErrorResponse";
import { createModuleLogger } from "../core/utils/logger";

const logger = createModuleLogger("ErrorHandler");

/**
 * Express 全局错误处理中间件
 * Express 4.x 要求 4 个参数签名
 * @param err
 * @param req
 * @param res
 * @param _next
 */
export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
	// JSON 解析错误检测
	const bodyParserErr = err as Error & { status?: number; body?: unknown };
	const isJsonParseError = err instanceof SyntaxError && "body" in bodyParserErr && bodyParserErr.status === 400;

	if (isJsonParseError) {
		logger.warn("请求体 JSON 解析失败", {
			method: req.method,
			url: req.originalUrl,
			error: err.message,
		});
	} else if (err instanceof ApiError) {
		logger.warn("API 错误", {
			method: req.method,
			url: req.originalUrl,
			statusCode: err.statusCode,
			message: err.message,
		});
	} else {
		logger.error("未处理的请求错误", {
			method: req.method,
			url: req.originalUrl,
			error: err.message,
			stack: err.stack,
		});
	}

	if (res.headersSent) {
		return;
	}

	if (isJsonParseError) {
		// PY 实测：{ "error": { "message": "Invalid JSON payload: ...", "type": "invalid_request_error", "param": "request_body", "code": "400" } }
		const invalidJsonError = new ApiError(
			HTTP_STATUS.BAD_REQUEST,
			`Invalid JSON payload: ${err.message}`,
			"invalid_request_error",
			"request_body",
		);
		sendProtocolError(req, res, invalidJsonError);
		return;
	}

	const apiError = mapToApiError(err);
	sendProtocolError(req, res, apiError);
}
