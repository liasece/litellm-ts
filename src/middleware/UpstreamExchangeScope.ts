import type { NextFunction, Request, Response } from "express";
import { runWithUpstreamExchangeScope } from "../router/UpstreamExchange";

/**
 * 为每个 HTTP 请求建立独立的上游交换旁路作用域。
 *
 * 传输层在真正发出上游请求时写入，SpendLog 构建时读取；两者之间无论隔着能力循环、
 * fallback 还是结果对象重建，记录都不会丢。必须在任何会发起上游调用的路由之前注册。
 * @param _req - Express 请求（作用域由调用链隐式携带）
 * @param _res - Express 响应
 * @param next - 下一个中间件
 */
export function upstreamExchangeScope(_req: Request, _res: Response, next: NextFunction): void {
	runWithUpstreamExchangeScope(() => next());
}
