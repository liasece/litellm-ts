/**
 * 请求到达时刻。
 *
 * 记账与 Dashboard 的 TTFT 必须从「下游请求到达代理」开始算：鉴权、授权、脱敏、运行时配置
 * 与费用预留都在 handler 之前，任何在 handler 内部取 `new Date()` 当起点都会把这整段本地
 * 等待排除在外，使 TTFT 系统性偏小，也把「本地排队慢」误读成「上游快」。
 *
 * 这里由应用的第一个中间件把墙钟到达时刻写到请求上，所有需要 startTime 的地方复用同一个值；
 * 观测链路（RequestTrace）有自己的单调时钟起点，两者互不覆盖：trace 负责分解耗时，
 * 到达时刻负责记账口径。
 */

import type { Request, RequestHandler } from "express";

declare global {
	namespace Express {
		interface Request {
			/** 请求到达代理的墙钟毫秒时间戳；由 `requestArrivalMiddleware` 写入。 */
			litellmRequestArrivalAt?: number;
		}
	}
}

/**
 * 记录请求到达时刻。必须是应用的第一个中间件，早于 body 解析、鉴权与任何路由。
 * 重复挂载时保留最早的一次，避免后续中间件把起点推后。
 * @param req - Express 请求，到达时刻写入 `req.litellmRequestArrivalAt`
 * @param _res - 未使用，保持 Express 中间件签名
 * @param next - 继续中间件链
 */
export const requestArrivalMiddleware: RequestHandler = (req, _res, next) => {
	req.litellmRequestArrivalAt ??= Date.now();
	next();
};

/**
 * 读取请求到达时刻。
 * @param req - Express 请求
 * @returns 到达时刻；请求未经过到达中间件（单元测试、内部调用）时退回当前时间
 */
export function requestArrivalTime(req: Pick<Request, "litellmRequestArrivalAt">): Date {
	const at = req.litellmRequestArrivalAt;
	return new Date(typeof at === "number" && Number.isFinite(at) ? at : Date.now());
}
