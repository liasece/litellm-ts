/**
 * HTTP Upgrade（WebSocket 握手）阶段的 Express 适配。
 *
 * Node 的 `upgrade` 事件给的是原始 `IncomingMessage`，拿不到 Express 的解析结果。
 * 这里把请求补成最小可用的 Express Request，并允许复用既有中间件做鉴权与授权，
 * 使 WebSocket 端点的安全边界与同一前缀的 HTTP 端点完全一致。
 */

import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ApiError } from "../api/ApiError";

/**
 * 把裸 IncomingMessage 补成 Express 可用的 Request。
 * @param req - 握手请求
 * @param path - 路径名（不含查询串）
 * @param query - 解析后的查询参数
 */
export function expressRequest(req: IncomingMessage, path: string, query: URLSearchParams): Request {
	const expressReq = req as unknown as Request;
	Object.defineProperties(expressReq, {
		path: { configurable: true, value: path },
		originalUrl: { configurable: true, value: req.url ?? path },
		query: { configurable: true, value: Object.fromEntries(query.entries()) },
		body: { configurable: true, writable: true, value: {} },
	});
	return expressReq;
}

/**
 * 在握手阶段运行一个 Express 中间件，任一错误直接抛出给调用方。
 * @param middleware - 待执行的中间件
 * @param req - 已适配的请求
 */
export async function runMiddleware(middleware: RequestHandler, req: Request): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const next: NextFunction = (error?: unknown): void => {
			if (error) {
				reject(error);
				return;
			}
			resolve();
		};
		Promise.resolve(middleware(req, {} as Response, next)).catch(reject);
	});
}

/**
 * 为握手阶段的裸 socket 挂一个错误兜底。
 *
 * `upgrade` 事件把连接交给应用后，Node 不再替我们处理该 socket 的错误；
 * 客户端在鉴权/握手完成前断开（浏览器关标签、探测扫描、RST）会发出没有
 * 监听器的 `error` 事件，直接终结进程。升级成功前先兜住它。
 * @param socket - 握手阶段的底层连接
 */
export function guardUpgradeSocket(socket: Duplex): void {
	socket.on("error", () => {
		// 客户端提前断开：无需清理，连接本身已进入销毁流程。
	});
}

/**
 * 在无法升级为 WebSocket 时，用普通 HTTP 响应说明原因后关闭连接。
 * @param socket - 底层连接
 * @param error - 鉴权/参数错误
 * @param fallbackMessage - 非 ApiError 时的默认说明
 */
export function writeUpgradeError(socket: Duplex, error: unknown, fallbackMessage: string): void {
	const apiError = error instanceof ApiError ? error : ApiError.unavailable(fallbackMessage);
	const body = Buffer.from(JSON.stringify(apiError.toErrorBody()));
	socket.write(
		`HTTP/1.1 ${apiError.statusCode} WebSocket Error\r\n` +
			"Connection: close\r\n" +
			"Content-Type: application/json\r\n" +
			`Content-Length: ${body.length}\r\n\r\n`,
	);
	socket.end(body);
}
