/**
 * Express 全局错误处理中间件
 *
 * 集中处理所有未捕获的请求错误，响应体对齐 Python litellm ProxyException 格式：
 * { error: { message, type, param, code } }（code 为状态码字符串）
 * - ApiError / LitellmError → 经 mapToApiError 映射对应状态码
 * - SyntaxError (JSON parse failure) → 400 invalid_request_error
 * - 客户端在请求体读完前断开 → 400 invalid_request_error，仅 warn 记录（不是服务端缺陷）
 * - 其他错误 → 500 + 日志记录
 */

import type { Request, Response, NextFunction } from "express";
import { ApiError, HTTP_STATUS } from "../core/api/ApiError";
import { mapToApiError } from "../core/api/ErrorResponseMapper";
import { sendProtocolError } from "../core/api/ProtocolErrorResponse";
import { createModuleLogger } from "../core/utils/logger";

const logger = createModuleLogger("ErrorHandler");

/** body-parser / raw-body 在客户端中断请求体时写入错误的 type 字段。 */
const REQUEST_ABORTED_ERROR_TYPE = "request.aborted";

/** 连接级中断错误的典型消息：raw-body 的 "request aborted"，Node 流的 "aborted" / "Premature close"。 */
const ABORTED_MESSAGE_PATTERN = /^(?:request aborted|aborted|premature close|socket hang up)$/i;

/**
 * 判断异常是否来自「客户端在请求体传完之前断开」。
 *
 * raw-body 的 onAborted 会抛出 `BadRequestError: request aborted`
 * （status 400、code ECONNABORTED、type request.aborted）：请求还没被处理，
 * 断开方是客户端，按 500 + 堆栈记录会把每次客户端取消/超时都写成服务端错误。
 * 只有消息形似中断、且请求连接确实已中断时才算，避免把恰好同时发生的真实故障降级；
 * 业务异常（ApiError）有自己的状态语义，不参与改判。
 * @param err - 捕获到的异常
 * @param req - 当前请求；连接级中断时 Node 会把 req.aborted 置为 true
 */
export function isRequestAbortedError(err: unknown, req: Request): boolean {
	if (err instanceof ApiError) {
		return false;
	}
	const candidate = (typeof err === "object" && err !== null ? err : {}) as { type?: unknown; message?: unknown };
	if (candidate.type === REQUEST_ABORTED_ERROR_TYPE) {
		return true;
	}
	const message = typeof candidate.message === "string" ? candidate.message : "";
	if (!ABORTED_MESSAGE_PATTERN.test(message)) {
		return false;
	}
	return (req as Request & { aborted?: boolean }).aborted === true;
}

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
	const isClientAbort = isRequestAbortedError(err, req);

	if (isClientAbort) {
		logger.warn("客户端在请求体传输中断开", {
			method: req.method,
			url: req.originalUrl,
			error: err.message,
		});
	} else if (isJsonParseError) {
		logger.warn("请求体 JSON 解析失败", {
			method: req.method,
			url: req.originalUrl,
			error: err.message,
		});
	} else if (err instanceof ApiError) {
		// 4xx 已由 accessLogFilter 在响应结束时记录（含 method/url/status/耗时），
		// 这里再记一条会让同一个客户端错误出现两次：生产日志里 401 因此被双写到
		// 1,120 + 1,121 条，warn 级别彻底失去信噪比。
		// 仅当响应不是通过本中间件正常写出（例如 headersSent 已为真）时才补记，
		// 保证"确实发生了 4xx 但没人记录"的情况仍然可见。
		const isClientError = err.statusCode >= 400 && err.statusCode < 500;
		if (!isClientError || res.headersSent) {
			logger.warn("API 错误", {
				method: req.method,
				url: req.originalUrl,
				statusCode: err.statusCode,
				message: err.message,
			});
		}
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

	if (isClientAbort) {
		// 客户端已断开：套接字通常也写不回去了，这里只把状态码对齐到 400，
		// 让访问日志与指标不再把「客户端取消」记成 200/500；连接仍可写时才真正回包。
		res.statusCode = HTTP_STATUS.BAD_REQUEST;
		if (!res.writableEnded && !res.destroyed) {
			sendProtocolError(
				req,
				res,
				new ApiError(
					HTTP_STATUS.BAD_REQUEST,
					"Client closed request before the request body was fully received",
					"invalid_request_error",
					"request_body",
				),
			);
		}
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
